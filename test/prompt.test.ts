import { describe, expect, it } from 'vitest'
import { buildPrompt, expectedSections } from '../src/prompt.ts'

const base = {
  language: 'zh' as const,
  cwd: 'C:\\ws',
  sessionId: 'session-1',
  createdAt: '2026-10-25T22:00:00+08:00',
  model: 'deepseek-account/deepseek-flash',
  messageCount: 12,
  focus: '',
  extraInstructions: '',
  transcript: '[用户] 修登录\n[助手] 看下代码',
  truncated: false,
}

describe('buildPrompt', () => {
  it('names every required section in order', () => {
    const prompt = buildPrompt(base)
    const sections = expectedSections('zh')
    let cursor = -1
    for (const section of sections) {
      const index = prompt.system.indexOf(section)
      expect(index).toBeGreaterThan(cursor)
      cursor = index
    }
  })

  it('uses the English contract for an English session', () => {
    const prompt = buildPrompt({ ...base, language: 'en' })
    expect(prompt.system).toContain('## Opening message for the next session')
    expect(prompt.system).not.toContain('## 给下一个会话的开场白')
  })

  it('carries session facts and the transcript into the user message', () => {
    const prompt = buildPrompt(base)
    expect(prompt.user).toContain('C:\\ws')
    expect(prompt.user).toContain('session-1')
    expect(prompt.user).toContain('deepseek-account/deepseek-flash')
    expect(prompt.user).toContain('[用户] 修登录')
    expect(prompt.user).toContain('记录是否被截断：否')
  })

  it('adds the focus and extra instructions only when present', () => {
    const plain = buildPrompt(base)
    expect(plain.user).not.toContain('关注点')
    expect(plain.user).not.toContain('额外要求')

    const focused = buildPrompt({ ...base, focus: '重点写测试', extraInstructions: '少于 800 字' })
    expect(focused.user).toContain('本次关注点：重点写测试')
    expect(focused.user).toContain('额外要求：少于 800 字')
  })

  it('says so when the transcript was truncated', () => {
    expect(buildPrompt({ ...base, truncated: true }).user).toContain('记录是否被截断：是')
  })

  it('wraps the transcript in its own delimiters', () => {
    const prompt = buildPrompt(base)
    expect(prompt.user).toContain('<会话记录>')
    expect(prompt.user).toContain('</会话记录>')
  })
})
