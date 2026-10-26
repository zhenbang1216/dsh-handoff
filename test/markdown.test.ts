import { describe, expect, it } from 'vitest'
import { documentFileName, localTimestamp, normalizeBody, renderDocument, slugify } from '../src/markdown.ts'

describe('normalizeBody', () => {
  it('strips a whole-document code fence', () => {
    expect(normalizeBody('```markdown\n## 任务\n做事\n```')).toBe('## 任务\n做事')
  })

  it('strips a duplicated front matter block', () => {
    expect(normalizeBody('---\ntitle: x\n---\n## 任务\n做事')).toBe('## 任务\n做事')
  })

  it('strips a top-level heading the prompt forbids', () => {
    expect(normalizeBody('# 交接文档\n\n## 任务\n做事')).toBe('## 任务\n做事')
  })

  it('leaves a clean body untouched', () => {
    expect(normalizeBody('## 任务\n做事')).toBe('## 任务\n做事')
  })
})

describe('slugify / documentFileName', () => {
  it('keeps CJK characters and drops punctuation', () => {
    expect(slugify('重构：登录模块 / 测试')).toBe('重构-登录模块-测试')
  })

  it('falls back to session for an empty slug', () => {
    expect(slugify('!!!')).toBe('session')
  })

  it('builds a sortable timestamped name', () => {
    const name = documentFileName('handoff', new Date(2026, 9, 25, 21, 40, 5), '登录模块')
    expect(name).toBe('handoff-20261025-214005-登录模块.md')
  })

  it('sanitizes the prefix', () => {
    expect(documentFileName('my prefix!', new Date(2026, 0, 2, 3, 4, 5), 'x')).toBe('my-prefix-20260102-030405-x.md')
  })
})

describe('renderDocument', () => {
  it('writes front matter, a title, and the body', () => {
    const document = renderDocument(
      {
        title: '修复登录',
        sessionId: 'session-1',
        cwd: 'C:\\ws',
        createdAt: '2026-10-25T21:40:05+08:00',
        provider: 'deepseek-account',
        model: 'deepseek-flash',
        messages: 12,
        generator: 'dsh-handoff',
      },
      '## 任务\n修好了',
    )
    expect(document.startsWith('---\n')).toBe(true)
    expect(document).toContain('session: session-1')
    expect(document).toContain('messages: 12')
    expect(document).toContain('# 交接文档 · 修复登录')
    expect(document).toContain('## 任务\n修好了')
    expect(document.endsWith('\n')).toBe(true)
  })

  it('quotes values that are not plain scalars', () => {
    const document = renderDocument(
      {
        title: 'fix: login',
        sessionId: 's',
        cwd: 'C:\\my ws',
        createdAt: '2026-10-25T21:40:05+08:00',
        provider: 'p',
        model: 'm',
        messages: 1,
        generator: 'dsh-handoff',
      },
      'body',
    )
    expect(document).toContain('title: "fix: login"')
    expect(document).toContain('cwd: "C:\\\\my ws"')
  })
})

describe('localTimestamp', () => {
  it('renders an offset-bearing local timestamp', () => {
    const value = localTimestamp(new Date(2026, 9, 25, 21, 40, 5))
    expect(value).toMatch(/^2026-10-25T21:40:05[+-]\d{2}:\d{2}$/u)
  })
})
