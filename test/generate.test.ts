import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, Message, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it } from 'vitest'
import type { HandoffConfig as ConfigShape } from '../src/config.ts'
import { HandoffError } from '../src/errors.ts'
import { generateHandoff, resolveRoute } from '../src/generate.ts'
import { parseLatestPointer } from '../src/markdown.ts'

const created: string[] = []

afterEach(async () => {
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true })
})

function userMessage(text: string): Message {
  return { id: 'u' as never, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } } as unknown as Message
}

function assistantMessage(text: string, provider = 'deepseek-account', model = 'deepseek-flash'): Message {
  return {
    id: 'a' as never,
    role: 'assistant',
    content: [{ type: 'text', text }],
    source: { kind: 'model', provider, model },
  } as unknown as Message
}

function fakeSession(messages: readonly Message[], cwd: string): Session {
  return {
    id: 'session-test',
    header: { cwd },
    deriveMessages: () => [...messages],
  } as unknown as Session
}

async function* streamOf(chunks: StreamChunk[]): AsyncIterable<StreamChunk> {
  for (const chunk of chunks) yield chunk
}

function fakeContext(text: string, captured: GenerateOptions[] = []): Context {
  return {
    llm: {
      stream(options: GenerateOptions) {
        captured.push(options)
        return streamOf([
          { type: 'text-delta', index: 0, text },
          { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
          { type: 'finish', reason: { kind: 'stop' } },
        ])
      },
    },
  } as unknown as Context
}

const config: ConfigShape = {
  outputDir: '.dsh/handoff',
  filenamePrefix: 'handoff',
  writeLatest: true,
  provider: '',
  model: '',
  maxInputChars: 48_000,
  maxOutputTokens: 4_096,
  includeToolResults: true,
  includeInjectedContext: false,
  includeReasoning: false,
  language: 'auto',
  extraInstructions: '',
}

describe('resolveRoute', () => {
  it('inherits the newest assistant route', () => {
    const route = resolveRoute([userMessage('hi'), assistantMessage('ok', 'p1', 'm1')], config)
    expect(route).toEqual({ provider: 'p1', model: 'm1' })
  })

  it('prefers an explicit pair', () => {
    const route = resolveRoute([assistantMessage('ok')], { ...config, provider: 'p2', model: 'm2' })
    expect(route).toEqual({ provider: 'p2', model: 'm2' })
  })

  it('rejects a half-configured route', () => {
    expect(() => resolveRoute([assistantMessage('ok')], { ...config, provider: 'p2' })).toThrowError(HandoffError)
  })

  it('fails when the session has no model reply to learn from', () => {
    expect(() => resolveRoute([userMessage('hi')], config)).toThrowError(/NO_ROUTE|还没有模型回复/u)
  })
})

describe('generateHandoff', () => {
  it('writes a front-mattered document and returns its relative path', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'handoff-test-'))
    created.push(cwd)
    const captured: GenerateOptions[] = []
    const result = await generateHandoff({
      ctx: fakeContext('## 任务\n修登录\n## 已完成\n- 定位到 bug', captured),
      session: fakeSession([userMessage('修复登录 bug'), assistantMessage('已修复')], cwd),
      config,
      focus: '',
    })

    expect(result.relativePath.startsWith('.dsh/handoff/handoff-')).toBe(true)
    expect(result.route).toEqual({ provider: 'deepseek-account', model: 'deepseek-flash' })

    const written = await readFile(result.path, 'utf8')
    expect(written).toContain('session: session-test')
    expect(written).toContain('version: 1')
    expect(written).toContain('# 交接文档 · 修复登录 bug')
    expect(written).toContain('## 任务')
    expect(result.version).toBe(1)

    // latest.md is a pointer now, not a duplicate of the document.
    const latest = await readFile(join(cwd, '.dsh', 'handoff', 'latest.md'), 'utf8')
    expect(latest).toContain('kind: latest-pointer')
    expect(parseLatestPointer(latest)).toBe(result.relativePath.split('/').pop())
    expect(latest).not.toContain('## 任务')

    const request = captured[0]
    expect(request?.provider).toBe('deepseek-account')
    expect(request?.system).toContain('交接文档')
    expect(request?.messages).toHaveLength(1)
    expect(request?.maxTokens).toBe(config.maxOutputTokens)
  })

  it('honours a configured output directory and prefix', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'handoff-test-'))
    created.push(cwd)
    const result = await generateHandoff({
      ctx: fakeContext('body'),
      session: fakeSession([userMessage('hello'), assistantMessage('hi')], cwd),
      config: { ...config, outputDir: 'notes', filenamePrefix: 'brief', writeLatest: false },
      focus: '登录',
    })
    expect(result.relativePath.startsWith('notes/brief-')).toBe(true)
    expect(result.relativePath).toContain('登录')
  })

  it('rejects an empty session', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'handoff-test-'))
    created.push(cwd)
    await expect(
      generateHandoff({ ctx: fakeContext('x'), session: fakeSession([], cwd), config, focus: '' }),
    ).rejects.toThrowError(/还没有任何消息/u)
  })

  it('surfaces provider failures with their code', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'handoff-test-'))
    created.push(cwd)
    const ctx = {
      llm: {
        stream: () =>
          streamOf([{ type: 'finish', reason: { kind: 'error', failure: { code: 'RATE_LIMIT', message: 'slow down' } } }]),
      },
    } as unknown as Context
    await expect(
      generateHandoff({ ctx, session: fakeSession([userMessage('a'), assistantMessage('b')], cwd), config, focus: '' }),
    ).rejects.toThrowError(/RATE_LIMIT|slow down/u)
  })

  it('rejects an empty model answer', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'handoff-test-'))
    created.push(cwd)
    await expect(
      generateHandoff({ ctx: fakeContext('   '), session: fakeSession([userMessage('a'), assistantMessage('b')], cwd), config, focus: '' }),
    ).rejects.toThrowError(/空文档/u)
  })
})
