import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, normalize, resolve } from 'node:path'
import { HandoffError } from './errors.ts'

const DEFAULT_DIR = '.dsh/handoff'

/** Resolve the configured output directory against the session working directory. */
export function resolveOutputDir(cwd: string, configured: string): string {
  const value = configured.trim() === '' ? DEFAULT_DIR : configured.trim()
  return isAbsolute(value) ? normalize(value) : resolve(cwd, value)
}

/** One generated document, as listed for the UI. */
export interface DocumentEntry {
  readonly name: string
  readonly path: string
  readonly size: number
  readonly modifiedAt: number
}

/**
 * Accept one bare file name, on any platform.
 *
 * Both separators are rejected explicitly: on POSIX a name like
 * `..\escape.md` contains no `/` and would otherwise pass a `basename` check
 * while still being a Windows path traversal on the other side.
 */
function assertBareName(name: string): void {
  if (
    name === '' ||
    name === '.' ||
    name === '..' ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('\0')
  ) {
    throw new HandoffError('BAD_NAME', `非法的文件名：${name}`)
  }
}

/** Write one document, creating the directory when needed. */
export async function writeDocument(dir: string, name: string, content: string): Promise<string> {
  assertBareName(name)
  await mkdir(dir, { recursive: true })
  const target = join(dir, name)
  await writeFile(target, content, 'utf8')
  return target
}

/** Newest documents first, without the `latest.md` convenience copy. */
export async function listDocuments(dir: string, limit = 50): Promise<DocumentEntry[]> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const entries: DocumentEntry[] = []
  for (const name of names) {
    if (!name.endsWith('.md') || name === 'latest.md') continue
    const path = join(dir, name)
    // One unreadable entry (a race with deletion, a broken link) must not
    // take the whole listing down.
    let info: Awaited<ReturnType<typeof stat>>
    try {
      info = await stat(path)
    } catch {
      continue
    }
    if (!info.isFile()) continue
    entries.push({ name, path, size: info.size, modifiedAt: info.mtimeMs })
  }
  entries.sort((a, b) => b.modifiedAt - a.modifiedAt)
  return entries.slice(0, limit)
}

/** Read one document by bare file name. */
export async function readDocument(dir: string, name: string): Promise<string> {
  assertBareName(name)
  return readFile(join(dir, name), 'utf8')
}
