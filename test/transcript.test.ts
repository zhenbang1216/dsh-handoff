import { describe, expect, it } from 'vitest'
import type { Message } from '@deepseek-ai/dsh-llm'
import { buildTranscript, dominantLanguage, firstUserLine } from '../src/transcript.ts'

function user(text: string, kind: 'user' | 'plugin' = 'user'): Message {
  return {
    id: `u-${text.slice(0, 8)}` as never,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind } as never,
  } as unknown as Message
}

function assistant(content: Message['content']): Message {
  return {
    id: 'a-1' as never,
    role: 'assistant',
    content,
    source: { kind: 'model', provider: 'p', model: 'm' },
  } as unknown as Message
}

function toolResult(text: string, callId = 'call-1'): Message {
  return {
    id: 't-1' as never,
    role: 'tool',
    content: [{ type: 'text', text }],
    source: { kind: 'tool', callId },
    toolCallId: callId,
  } as unknown as Message
}

function system(text: string): Message {
  return { id: 's-1' as never, role: 'system', content: [{ type: 'text', text }], source: { kind: 'system-prompt' } } as unknown as Message
}

const options = { maxChars: 48_000, includeToolResults: true, includeInjectedContext: false, includeReasoning: false }

describe('buildTranscript', () => {
  it('renders user and assistant turns with role tags', () => {
    const transcript = buildTranscript([user('修复登录 bug'), assistant([{ type: 'text', text: '我来看看' }])], options)
    expect(transcript.text).toContain('[用户] 修复登录 bug')
    expect(transcript.text).toContain('[助手] 我来看看')
    expect(transcript.stats.truncated).toBe(false)
  })

  it('skips the system prompt and, by default, injected user-role context', () => {
    const transcript = buildTranscript([system('SECRET PROMPT'), user('<skill>', 'plugin'), user('真正的问题')], options)
    expect(transcript.text).not.toContain('SECRET PROMPT')
    expect(transcript.text).not.toContain('<skill>')
    expect(transcript.text).toContain('[用户] 真正的问题')
  })

  it('keeps injected context visible when asked to', () => {
    const transcript = buildTranscript([user('<skill>', 'plugin')], { ...options, includeInjectedContext: true })
    expect(transcript.text).toContain('[上下文] <skill>')
  })

  it('pairs tool results with their call name', () => {
    const messages = [
      user('列目录'),
      assistant([{ type: 'tool-call', id: 'call-1' as never, name: 'pwsh', arguments: '{"command":"ls"}' }]),
      toolResult('a.txt\nb.txt'),
    ]
    const transcript = buildTranscript(messages, options)
    expect(transcript.text).toContain('[调用] pwsh {"command":"ls"}')
    expect(transcript.text).toContain('[结果] ← pwsh a.txt')
  })

  it('marks failing tool results', () => {
    const messages = [
      assistant([{ type: 'tool-call', id: 'call-1' as never, name: 'pwsh', arguments: '{}' }]),
      { ...toolResult('boom'), isError: true } as Message,
    ]
    expect(buildTranscript(messages, options).text).toContain('[结果] ✗ pwsh boom')
  })

  it('omits tool results when disabled', () => {
    const messages = [
      assistant([{ type: 'tool-call', id: 'call-1' as never, name: 'pwsh', arguments: '{}' }]),
      toolResult('noise'),
    ]
    const transcript = buildTranscript(messages, { ...options, includeToolResults: false })
    expect(transcript.text).not.toContain('noise')
  })

  it('keeps the head and the tail while dropping the middle under budget', () => {
    const messages: Message[] = [user('TASK-START')]
    for (let index = 0; index < 200; index++) messages.push(assistant([{ type: 'text', text: `step ${index} `.repeat(60) }]))
    messages.push(user('TASK-END'))
    const transcript = buildTranscript(messages, { ...options, maxChars: 6_000 })
    expect(transcript.stats.truncated).toBe(true)
    expect(transcript.stats.omitted).toBeGreaterThan(0)
    expect(transcript.text).toContain('TASK-START')
    expect(transcript.text).toContain('TASK-END')
    expect(transcript.text).toContain('会话中段省略')
    expect(transcript.text.length).toBeLessThan(7_500)
  })
})

describe('firstUserLine / dominantLanguage', () => {
  it('uses the first user line as a title anchor', () => {
    expect(firstUserLine([system('x'), user('  帮我重构  登录模块 '), user('第二句')])).toBe('帮我重构 登录模块')
  })

  it('ignores injected context when picking a title', () => {
    expect(firstUserLine([user('AVAILABLE SKILLS: office, pptx', 'plugin'), user('真正的问题')])).toBe('真正的问题')
  })

  it('detects Chinese and English sessions', () => {
    expect(dominantLanguage([user('请帮我修复这个问题')])).toBe('zh')
    expect(dominantLanguage([user('please fix the failing test')])).toBe('en')
  })

  it('does not let injected English context flip the language of a Chinese session', () => {
    const english = user('AVAILABLE SKILLS: office, pptx, docx. Use the skill tool before acting. '.repeat(20), 'plugin')
    expect(dominantLanguage([english, user('把这个插件装好并验证')])).toBe('zh')
  })

  it('falls back to every user-role message when the session has no human message', () => {
    expect(dominantLanguage([user('the only message is injected', 'plugin')])).toBe('en')
  })
})
