import { describe, expect, it } from 'vitest'
import {
  documentFileName,
  localTimestamp,
  normalizeBody,
  parseDocumentVersion,
  parseLatestPointer,
  readableTime,
  renderDocument,
  renderLatestPointer,
  slugify,
  type DocumentMeta,
} from '../src/markdown.ts'

const meta: DocumentMeta = {
  title: '修复登录',
  sessionId: 'session-1',
  cwd: 'C:\\ws',
  createdAt: '2026-10-25T21:40:05+08:00',
  updatedAt: '2026-10-25T21:40:05+08:00',
  version: 3,
  previous: 'handoff-20261025-210000-旧.md',
  sessionActivityAt: '2026-10-25T21:39:50+08:00',
  provider: 'deepseek-account',
  model: 'deepseek-flash',
  messages: 12,
  generator: 'dsh-handoff@0.2.0',
}

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
  it('writes the version, timestamps, and predecessor into the document', () => {
    const document = renderDocument(meta, '## 任务\n修好了')
    expect(document.startsWith('---\n')).toBe(true)
    expect(document).toContain('session: session-1')
    expect(document).toContain('version: 3')
    expect(document).toContain('updated: "2026-10-25T21:40:05+08:00"')
    expect(document).toContain('session-activity: "2026-10-25T21:39:50+08:00"')
    expect(document).toContain('previous: "handoff-20261025-210000-旧.md"')
    expect(document).toContain('generator: dsh-handoff@0.2.0')
    expect(document).toContain('# 交接文档 · 修复登录')
    expect(document).toContain('## 任务\n修好了')
    expect(document.endsWith('\n')).toBe(true)
  })

  it('states the version and freshness in a visible line under the title', () => {
    const document = renderDocument(meta, 'body')
    expect(document).toContain('> v3 · 生成于 2026-10-25 21:40:05 +08:00 · 会话最后活动 2026-10-25 21:39:50 +08:00')
    expect(document).toContain('上一份 `handoff-20261025-210000-旧.md`')
  })

  it('omits the predecessor for the first version', () => {
    const { previous: _predecessor, ...first } = meta
    const document = renderDocument({ ...first, version: 1 }, 'body')
    expect(document).not.toContain('previous:')
    expect(document).not.toContain('上一份')
  })

  it('quotes values that are not plain scalars', () => {
    const document = renderDocument({ ...meta, title: 'fix: login', cwd: 'C:\\my ws' }, 'body')
    expect(document).toContain('title: "fix: login"')
    expect(document).toContain('cwd: "C:\\\\my ws"')
  })
})

describe('latest pointer', () => {
  it('renders a pointer that names the newest document', () => {
    const pointer = renderLatestPointer({ name: 'handoff-20261026-085833-x.md', version: 4, updatedAt: '2026-10-26T08:58:33+08:00' })
    expect(pointer).toContain('kind: latest-pointer')
    expect(pointer).toContain('latest: handoff-20261026-085833-x.md')
    expect(pointer).toContain('v4')
    expect(pointer).toContain('2026-10-26 08:58:33 +08:00')
  })

  it('round-trips through the parser', () => {
    const pointer = renderLatestPointer({ name: 'a.md', version: 1, updatedAt: '2026-10-26T08:58:33+08:00' })
    expect(parseLatestPointer(pointer)).toBe('a.md')
  })

  it('returns undefined for a legacy full copy', () => {
    expect(parseLatestPointer(renderDocument(meta, 'body'))).toBeUndefined()
  })

  it('reads the version back out of a document', () => {
    expect(parseDocumentVersion(renderDocument(meta, 'body'))).toBe(3)
    expect(parseDocumentVersion('no front matter')).toBeUndefined()
  })
})

describe('readableTime', () => {
  it('formats an ISO timestamp for the visible line', () => {
    expect(readableTime('2026-10-26T08:58:33+08:00')).toBe('2026-10-26 08:58:33 +08:00')
  })

  it('passes anything unexpected through unchanged', () => {
    expect(readableTime('not a timestamp')).toBe('not a timestamp')
  })
})

describe('localTimestamp', () => {
  it('renders an offset-bearing local timestamp', () => {
    const value = localTimestamp(new Date(2026, 9, 25, 21, 40, 5))
    expect(value).toMatch(/^2026-10-25T21:40:05[+-]\d{2}:\d{2}$/u)
  })
})
