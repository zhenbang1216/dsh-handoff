import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Session } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it } from 'vitest'
import type { HandoffConfig } from '../src/config.ts'
import { HandoffError } from '../src/errors.ts'
import { renderLatestPointer } from '../src/markdown.ts'
import { frameForInjection, loadHandoffForResume } from '../src/resume.ts'
import { writeDocument } from '../src/store.ts'

const dirs: string[] = []

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

const config: HandoffConfig = {
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

async function sessionIn(cwd: string): Promise<Session> {
  return { id: 's', header: { cwd }, deriveMessages: () => [] } as unknown as Session
}

async function workspace(): Promise<{ cwd: string; dir: string }> {
  const cwd = await mkdtemp(join(tmpdir(), 'handoff-resume-'))
  dirs.push(cwd)
  const dir = join(cwd, '.dsh', 'handoff')
  return { cwd, dir }
}

describe('loadHandoffForResume', () => {
  it('treats a legacy full-copy latest.md as the document itself', async () => {
    const { cwd, dir } = await workspace()
    await writeDocument(dir, 'old.md', 'old body')
    await writeDocument(dir, 'latest.md', 'latest body')
    const resumed = await loadHandoffForResume(await sessionIn(cwd), config, '')
    expect(resumed.name).toBe('latest.md')
    expect(resumed.content).toBe('latest body')
    expect(resumed.truncated).toBe(false)
  })

  it('follows the latest pointer to the real document', async () => {
    const { cwd, dir } = await workspace()
    await writeDocument(dir, 'handoff-20261026-085833-x.md', 'newest body')
    await writeDocument(
      dir,
      'latest.md',
      renderLatestPointer({ name: 'handoff-20261026-085833-x.md', version: 4, updatedAt: '2026-10-26T08:58:33+08:00' }),
    )
    const resumed = await loadHandoffForResume(await sessionIn(cwd), config, '')
    expect(resumed.name).toBe('handoff-20261026-085833-x.md')
    expect(resumed.content).toBe('newest body')
  })

  it('reports a pointer whose target is gone', async () => {
    const { cwd, dir } = await workspace()
    await writeDocument(dir, 'latest.md', renderLatestPointer({ name: 'missing.md', version: 2, updatedAt: '2026-10-26T08:58:33+08:00' }))
    await expect(loadHandoffForResume(await sessionIn(cwd), config, '')).rejects.toThrowError(/BROKEN_POINTER|不存在/u)
  })

  it('falls back to the newest timestamped document when there is no latest.md', async () => {
    const { cwd, dir } = await workspace()
    await writeDocument(dir, 'handoff-20260101-000000-a.md', 'a')
    await new Promise((resolve) => setTimeout(resolve, 10))
    await writeDocument(dir, 'handoff-20260102-000000-b.md', 'b')
    const resumed = await loadHandoffForResume(await sessionIn(cwd), config, '')
    expect(resumed.name).toBe('handoff-20260102-000000-b.md')
    expect(resumed.content).toBe('b')
  })

  it('honours an explicit file name', async () => {
    const { cwd, dir } = await workspace()
    await writeDocument(dir, 'latest.md', 'latest')
    await writeDocument(dir, 'pick-me.md', 'chosen')
    const resumed = await loadHandoffForResume(await sessionIn(cwd), config, 'pick-me.md')
    expect(resumed.content).toBe('chosen')
  })

  it('explains what to do when nothing has been generated', async () => {
    const { cwd } = await workspace()
    await expect(loadHandoffForResume(await sessionIn(cwd), config, '')).rejects.toThrowError(HandoffError)
  })

  it('caps a document that is too large to inject', async () => {
    const { cwd, dir } = await workspace()
    await writeDocument(dir, 'latest.md', 'x'.repeat(31_000))
    const resumed = await loadHandoffForResume(await sessionIn(cwd), config, '')
    expect(resumed.truncated).toBe(true)
    expect(resumed.content.length).toBeLessThan(30_400)
    expect(resumed.content).toContain('以上为前半部分')
  })

  it('refuses a path instead of a bare file name', async () => {
    const { cwd } = await workspace()
    await expect(loadHandoffForResume(await sessionIn(cwd), config, '../secret.md')).rejects.toThrowError(HandoffError)
  })
})

describe('frameForInjection', () => {
  it('wraps the document and names it', () => {
    const framed = frameForInjection({ name: 'latest.md', content: '## 任务\n修登录', truncated: false })
    expect(framed).toContain('latest.md')
    expect(framed).toContain('<handoff>')
    expect(framed).toContain('## 任务')
    expect(framed).not.toContain('已截断')
  })

  it('says when the document was truncated', () => {
    const framed = frameForInjection({ name: 'latest.md', content: 'body', truncated: true })
    expect(framed).toContain('文档已截断')
  })
})
