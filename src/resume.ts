import type { Session } from '@deepseek-ai/dsh-session'
import type { HandoffConfig } from './config.ts'
import { HandoffError } from './errors.ts'
import { listDocuments, readDocument, resolveOutputDir } from './store.ts'

/** Injected context is bounded: a handoff is a brief, not a transcript. */
const MAX_INJECTED_CHARS = 30_000

/** One document loaded for injection. */
export interface ResumeResult {
  readonly name: string
  readonly content: string
  /** The document was longer than the injection budget. */
  readonly truncated: boolean
}

/**
 * Load the document a new session should continue from.
 *
 * `latest.md` wins because it is the file the generator maintains for exactly
 * this purpose; a directory that only has timestamped files falls back to the
 * newest one. An explicit name is used verbatim (and must be a bare file name).
 */
export async function loadHandoffForResume(
  session: Session,
  config: HandoffConfig,
  requested: string,
): Promise<ResumeResult> {
  const dir = resolveOutputDir(session.header.cwd ?? process.cwd(), config.outputDir)
  const name = await pickDocument(dir, requested)
  const raw = await readDocument(dir, name)
  const truncated = raw.length > MAX_INJECTED_CHARS
  const content = truncated
    ? `${raw.slice(0, MAX_INJECTED_CHARS)}\n\n…（文档超过 ${MAX_INJECTED_CHARS} 字符，以上为前半部分）…`
    : raw
  return { name, content, truncated }
}

async function pickDocument(dir: string, requested: string): Promise<string> {
  if (requested !== '') return requested
  try {
    await readDocument(dir, 'latest.md')
    return 'latest.md'
  } catch {
    // No convenience copy: fall through to the newest timestamped document.
  }
  const documents = await listDocuments(dir)
  const newest = documents[0]
  if (newest === undefined) {
    throw new HandoffError('NO_DOCUMENT', `还没有交接文档（目录 ${dir}）。先运行 /handoff 生成一份。`)
  }
  return newest.name
}

/** Frame the document as model-facing context rather than a bare dump. */
export function frameForInjection(result: ResumeResult): string {
  const tail = result.truncated ? '\n\n（文档已截断，需要时可以读取原文件补全。）' : ''
  return [
    `以下是上一个会话留下的交接文档（${result.name}）。请把它当作当前任务的已有上下文：先读它，再决定下一步。`,
    '',
    '<handoff>',
    result.content.trimEnd(),
    '</handoff>',
    tail,
  ].join('\n')
}
