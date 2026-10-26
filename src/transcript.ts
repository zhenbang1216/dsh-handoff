import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'

/** What the transcript builder is allowed to spend and include. */
export interface TranscriptOptions {
  /** Total character budget for the rendered transcript. */
  readonly maxChars: number
  /** Render tool-result entries. */
  readonly includeToolResults: boolean
  /** Render assistant reasoning blocks. */
  readonly includeReasoning: boolean
  /**
   * Render user-role messages the harness injected (skill catalogs, workspace
   * notes, plugin notices). Off by default: they repeat boilerplate that the
   * next session already receives from the harness, and they crowd out the
   * conversation inside the character budget.
   */
  readonly includeInjectedContext: boolean
}

export interface TranscriptStats {
  /** Messages derived from the session. */
  readonly messages: number
  /** Messages that made it into the rendered transcript. */
  readonly included: number
  /** Rendered transcript length in characters. */
  readonly chars: number
  /** Whether the middle of the conversation was dropped to respect the budget. */
  readonly truncated: boolean
  /** Messages dropped from the middle. */
  readonly omitted: number
}

export interface Transcript {
  readonly text: string
  readonly stats: TranscriptStats
}

/** One rendered line group, before budgeting. */
interface Entry {
  readonly kind: 'user' | 'context' | 'assistant' | 'tool-call' | 'tool-result' | 'reasoning'
  readonly text: string
  /** The call id this entry answers, for tool results. */
  readonly callId?: string
}

const ENTRY_LIMIT = 4_000
const ENTRY_HEAD = 2_600
const ENTRY_TAIL = 1_200
const CALL_ARGS_LIMIT = 500

function clip(text: string, limit = ENTRY_LIMIT): string {
  if (text.length <= limit) return text
  const omitted = text.length - ENTRY_HEAD - ENTRY_TAIL
  return `${text.slice(0, ENTRY_HEAD)}\n…（此处截断 ${omitted} 字符）…\n${text.slice(text.length - ENTRY_TAIL)}`
}

/** Flatten content blocks into readable text, skipping images and files. */
function contentText(blocks: readonly ContentBlock[], includeReasoning: boolean): string {
  const parts: string[] = []
  for (const block of blocks) {
    if (block.type === 'text') parts.push(block.text)
    else if (block.type === 'reasoning' && includeReasoning) parts.push(`[思考] ${block.text}`)
    else if (block.type === 'image') parts.push('[图片]')
    else if (block.type === 'file') parts.push('[文件]')
  }
  return parts.join('\n').trim()
}

/** Pretty-print raw tool arguments without inventing content. */
function argumentsText(raw: string): string {
  let text = raw.trim()
  try {
    text = JSON.stringify(JSON.parse(text))
  } catch {
    // Keep the raw string: a malformed argument is itself information.
  }
  return text.length > CALL_ARGS_LIMIT ? `${text.slice(0, CALL_ARGS_LIMIT)}…` : text
}

function toolNameOf(message: Message, names: ReadonlyMap<string, string>): string {
  if (message.role !== 'tool') return 'tool'
  return names.get(String(message.source.callId)) ?? 'tool'
}

/** Collect `callId → tool name` so results can name their call. */
function collectToolNames(messages: readonly Message[]): Map<string, string> {
  const names = new Map<string, string>()
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const block of message.content) {
      if (block.type === 'tool-call') names.set(String(block.id), block.name)
    }
  }
  return names
}

function toEntries(messages: readonly Message[], options: TranscriptOptions): Entry[] {
  const names = collectToolNames(messages)
  const entries: Entry[] = []
  for (const message of messages) {
    switch (message.role) {
      case 'system':
      case 'developer':
        // Prompt text and tool-update bookkeeping add tokens, not handoff signal.
        break
      case 'user': {
        const injected = message.source.kind !== 'user'
        if (injected && !options.includeInjectedContext) break
        const text = contentText(message.content, options.includeReasoning)
        if (text === '') break
        entries.push({ kind: injected ? 'context' : 'user', text: clip(text) })
        break
      }
      case 'assistant': {
        const text = contentText(message.content, options.includeReasoning)
        if (text !== '') entries.push({ kind: 'assistant', text: clip(text) })
        for (const block of message.content) {
          if (block.type !== 'tool-call') continue
          entries.push({
            kind: 'tool-call',
            callId: String(block.id),
            text: clip(`→ ${block.name} ${argumentsText(block.arguments)}`, 900),
          })
        }
        break
      }
      case 'tool': {
        if (!options.includeToolResults) break
        const text = contentText(message.content, false)
        const name = toolNameOf(message, names)
        const label = message.isError === true ? `✗ ${name}` : `← ${name}`
        entries.push({ kind: 'tool-result', callId: String(message.source.callId), text: clip(`${label} ${text}`, 1_200) })
        break
      }
    }
  }
  return entries
}

function renderEntry(entry: Entry): string {
  switch (entry.kind) {
    case 'user':
      return `[用户] ${entry.text}`
    case 'context':
      return `[上下文] ${entry.text}`
    case 'assistant':
      return `[助手] ${entry.text}`
    case 'tool-call':
      return `[调用] ${entry.text.replace(/^→ /u, '')}`
    case 'tool-result':
      return `[结果] ${entry.text}`
    case 'reasoning':
      return `[思考] ${entry.text}`
  }
}

/**
 * Render the conversation into a compact transcript under a character budget.
 *
 * The budget keeps the beginning (the task statement) and the newest entries
 * (where the work actually is), dropping the middle with an explicit marker so
 * the summarizer knows the record is incomplete instead of silently missing it.
 */
export function buildTranscript(messages: readonly Message[], options: TranscriptOptions): Transcript {
  const entries = toEntries(messages, options)
  const budget = Math.max(2_000, options.maxChars)
  const rendered = entries.map(renderEntry)
  const total = rendered.reduce((sum, text) => sum + text.length + 2, 0)

  if (total <= budget) {
    const text = rendered.join('\n\n')
    return {
      text,
      stats: { messages: messages.length, included: entries.length, chars: text.length, truncated: false, omitted: 0 },
    }
  }

  const headBudget = Math.floor(budget * 0.35)
  const tailBudget = Math.max(1_000, budget - headBudget - 240)
  const head: string[] = []
  let headChars = 0
  for (const text of rendered) {
    if (headChars + text.length + 2 > headBudget) break
    head.push(text)
    headChars += text.length + 2
  }
  const tail: string[] = []
  let tailChars = 0
  for (let index = rendered.length - 1; index >= head.length; index--) {
    const text = rendered[index] as string
    if (tailChars + text.length + 2 > tailBudget) break
    tail.unshift(text)
    tailChars += text.length + 2
  }
  const omitted = entries.length - head.length - tail.length
  const marker = `…（会话中段省略 ${omitted} 条消息，约 ${Math.max(0, total - headChars - tailChars)} 字符未展示）…`
  const text = [...head, marker, ...tail].join('\n\n')
  return {
    text,
    stats: { messages: messages.length, included: head.length + tail.length, chars: text.length, truncated: true, omitted },
  }
}

/**
 * The user's own messages, in order.
 *
 * Injected context (skills, workspace notes, plugin notices) also rides in
 * user-role messages, but it is not the human's language and must not decide
 * the document language or the title. Falls back to every user-role message
 * when a session has none of its own.
 */
function humanMessages(messages: readonly Message[]): Message[] {
  const own = messages.filter((message) => message.role === 'user' && message.source.kind === 'user')
  return own.length > 0 ? own : messages.filter((message) => message.role === 'user')
}

/** First non-empty user line — a cheap title anchor, never a substitute for the task section. */
export function firstUserLine(messages: readonly Message[], maxChars = 60): string {
  for (const message of humanMessages(messages)) {
    const text = contentText(message.content, false).replace(/\s+/gu, ' ').trim()
    if (text !== '') return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text
  }
  return ''
}

/** Heuristic for `language: auto`: CJK characters in the user's own words. */
export function dominantLanguage(messages: readonly Message[]): 'zh' | 'en' {
  let cjk = 0
  let latin = 0
  for (const message of humanMessages(messages)) {
    const text = contentText(message.content, false)
    for (const char of text) {
      if (/\p{Script=Han}/u.test(char)) cjk++
      else if (/[A-Za-z]/u.test(char)) latin++
    }
  }
  return cjk >= latin / 3 && cjk > 0 ? 'zh' : 'en'
}
