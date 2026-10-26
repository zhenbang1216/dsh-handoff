import type { Context } from '@deepseek-ai/cordis'
import type { FinishReason, GenerateOptions, Message, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import { relative } from 'node:path'
import type { HandoffConfig } from './config.ts'
import { HandoffError } from './errors.ts'
import { documentFileName, localTimestamp, normalizeBody, renderDocument, slugify } from './markdown.ts'
import { buildPrompt } from './prompt.ts'
import { resolveOutputDir, writeDocument } from './store.ts'
import { buildTranscript, dominantLanguage, firstUserLine, type TranscriptStats } from './transcript.ts'

/** One resolved provider/model route. */
export interface Route {
  readonly provider: string
  readonly model: string
}

/** Input for one handoff generation. */
export interface GenerateInput {
  readonly ctx: Context
  readonly session: Session
  readonly config: HandoffConfig
  /** Optional user focus, appended to the prompt. */
  readonly focus: string
  /** Caller cancellation, forwarded to the provider call. */
  readonly signal?: AbortSignal
}

/** What the caller needs after a successful generation. */
export interface GenerateResult {
  /** Absolute path of the written document. */
  readonly path: string
  /** Path relative to the session working directory, forward-slashed. */
  readonly relativePath: string
  readonly markdown: string
  readonly route: Route
  readonly stats: TranscriptStats
  readonly usage?: TokenUsage
}

/** Generator identity recorded in every document. */
const GENERATOR = 'dsh-handoff'

/**
 * Pick the route for the auxiliary call.
 *
 * An explicit `provider`/`model` pair wins. Otherwise the newest assistant
 * message's own source names the route the conversation is actually using, so
 * the handoff is written by the same model the user has been talking to.
 */
export function resolveRoute(messages: readonly Message[], config: HandoffConfig): Route {
  const provider = config.provider.trim()
  const model = config.model.trim()
  if (provider !== '' && model !== '') return { provider, model }
  if (provider !== '' || model !== '') {
    throw new HandoffError('BAD_ROUTE_CONFIG', 'provider 与 model 必须同时配置，或都留空以沿用会话模型。')
  }
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message?.role !== 'assistant') continue
    const source = message.source
    if (source.provider !== '' && source.model !== '') return { provider: source.provider, model: source.model }
  }
  throw new HandoffError('NO_ROUTE', '这个会话还没有模型回复，无法推断模型；请先在插件配置里填写 provider/model。')
}

/** Collect assistant text from one stream, rejecting every non-success terminal state. */
async function streamText(
  stream: AsyncIterable<StreamChunk>,
): Promise<{ text: string; usage?: TokenUsage; finish: FinishReason }> {
  let text = ''
  let usage: TokenUsage | undefined
  let finish: FinishReason | undefined
  for await (const chunk of stream) {
    switch (chunk.type) {
      case 'text-delta':
        text += chunk.text
        break
      case 'usage':
        usage = chunk.usage
        break
      case 'finish':
        finish = chunk.reason
        break
      default:
        break
    }
  }
  if (finish === undefined) throw new HandoffError('NO_FINISH', '模型流没有返回结束原因。')
  switch (finish.kind) {
    case 'error':
      throw new HandoffError(finish.failure.code, finish.failure.message)
    case 'aborted':
      throw new HandoffError('ABORTED', '生成被取消。')
    case 'tool-calls':
      throw new HandoffError('TOOL_CALLS', '模型选择了调用工具而不是写文档，请重试。')
    default:
      break
  }
  return usage === undefined ? { text, finish } : { text, usage, finish }
}

/**
 * Generate one handoff document and write it to disk.
 *
 * The transcript never leaves the Host except as the summarizer request; the
 * conversation itself is untouched (this is an auxiliary call, not a turn).
 */
export async function generateHandoff(input: GenerateInput): Promise<GenerateResult> {
  const { ctx, session, config } = input
  const messages = session.deriveMessages()
  if (messages.length === 0) throw new HandoffError('EMPTY_SESSION', '当前会话还没有任何消息。')

  const route = resolveRoute(messages, config)
  const language = config.language === 'auto' ? dominantLanguage(messages) : config.language
  const transcript = buildTranscript(messages, {
    maxChars: config.maxInputChars,
    includeToolResults: config.includeToolResults,
    includeInjectedContext: config.includeInjectedContext,
    includeReasoning: config.includeReasoning,
  })
  const now = new Date()
  const createdAt = localTimestamp(now)
  const cwd = session.header.cwd ?? process.cwd()
  const title = firstUserLine(messages) || (language === 'zh' ? '未命名会话' : 'Untitled session')

  const prompt = buildPrompt({
    language,
    cwd,
    sessionId: String(session.id),
    createdAt,
    model: `${route.provider}/${route.model}`,
    messageCount: messages.length,
    focus: input.focus,
    extraInstructions: config.extraInstructions,
    transcript: transcript.text,
    truncated: transcript.stats.truncated,
  })

  const options: GenerateOptions = {
    provider: route.provider,
    model: route.model,
    system: prompt.system,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt.user }] }],
    maxTokens: config.maxOutputTokens,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  }

  const { text, usage } = await streamText(ctx.llm.stream(options))
  const body = normalizeBody(text)
  if (body === '') throw new HandoffError('EMPTY_DOCUMENT', '模型返回了空文档。')

  const markdown = renderDocument(
    {
      title,
      sessionId: String(session.id),
      cwd,
      createdAt,
      provider: route.provider,
      model: route.model,
      messages: messages.length,
      ...(input.focus === '' ? {} : { focus: input.focus }),
      generator: GENERATOR,
    },
    body,
  )

  const dir = resolveOutputDir(cwd, config.outputDir)
  const fileName = documentFileName(config.filenamePrefix, now, slugify(input.focus === '' ? title : input.focus))
  const path = await writeDocument(dir, fileName, markdown)
  if (config.writeLatest) await writeDocument(dir, 'latest.md', markdown)

  return {
    path,
    relativePath: relative(cwd, path).split('\\').join('/'),
    markdown,
    route,
    stats: transcript.stats,
    ...(usage === undefined ? {} : { usage }),
  }
}
