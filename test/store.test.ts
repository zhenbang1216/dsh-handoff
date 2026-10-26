import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { HandoffError } from '../src/errors.ts'
import { listDocuments, readDocument, resolveOutputDir, writeDocument } from '../src/store.ts'

const dirs: string[] = []

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'handoff-store-'))
  dirs.push(dir)
  return dir
}

describe('resolveOutputDir', () => {
  // Platform-neutral on purpose: the CI job runs on Linux, where a literal
  // `C:\ws` would be relative rather than absolute. Expectations are built with
  // `join`, so the same assertions hold on every separator.
  const cwd = join(tmpdir(), 'handoff-ws')

  it('resolves a relative directory against the session cwd', () => {
    expect(resolveOutputDir(cwd, '.dsh/handoff')).toBe(join(cwd, '.dsh', 'handoff'))
  })

  it('falls back to the default when configured empty', () => {
    expect(resolveOutputDir(cwd, '  ')).toBe(join(cwd, '.dsh', 'handoff'))
  })

  it('keeps an absolute directory', () => {
    const absolute = join(tmpdir(), 'handoff-notes')
    expect(resolveOutputDir(cwd, absolute)).toBe(absolute)
  })
})

describe('documents', () => {
  it('creates the directory and writes the file', async () => {
    const root = await tempDir()
    const dir = join(root, 'nested', 'handoff')
    const path = await writeDocument(dir, 'a.md', 'hello')
    expect(path).toBe(join(dir, 'a.md'))
    expect(await readDocument(dir, 'a.md')).toBe('hello')
  })

  it('lists newest first and hides latest.md', async () => {
    const root = await tempDir()
    await writeDocument(root, 'one.md', '1')
    await new Promise((resolve) => setTimeout(resolve, 10))
    await writeDocument(root, 'two.md', '2')
    await writeDocument(root, 'latest.md', '2')
    await writeDocument(root, 'notes.txt', 'not markdown')
    const docs = await listDocuments(root)
    expect(docs.map((doc) => doc.name)).toEqual(['two.md', 'one.md'])
    expect(docs[0]?.size).toBe(1)
  })

  it('returns an empty list for a missing directory', async () => {
    expect(await listDocuments(join(await tempDir(), 'absent'))).toEqual([])
  })

  it('refuses a name that is not a bare file name', async () => {
    const root = await tempDir()
    await expect(writeDocument(root, '../escape.md', 'x')).rejects.toThrowError(HandoffError)
    await expect(readDocument(root, '..\\escape.md')).rejects.toThrowError(HandoffError)
  })
})
