/** Front-matter values are written as plain YAML scalars. */
export interface DocumentMeta {
  readonly title: string
  readonly sessionId: string
  readonly cwd: string
  readonly createdAt: string
  /** Time this document (or the newest edit of it) was last written. */
  readonly updatedAt: string
  /** 1-based sequence within the output directory; the handoff chain. */
  readonly version: number
  /** File name of the version this one supersedes. */
  readonly previous?: string
  /** Last activity in the session this document describes. */
  readonly sessionActivityAt: string
  readonly provider: string
  readonly model: string
  readonly messages: number
  readonly focus?: string
  /** Generator identity, including the plugin version. */
  readonly generator: string
}

function yamlString(value: string): string {
  if (/^[\w./@-]+$/u.test(value)) return value
  return JSON.stringify(value)
}

/** `2026-10-26 15:36:12 +08:00` — readable, unambiguous, sortable. */
export function readableTime(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})([+-]\d{2}:\d{2})$/u.exec(iso)
  return match === null ? iso : `${match[1]} ${match[2]} ${match[3]}`
}

/** One line under the title: version, freshness, and the version it replaces. */
function metaLine(meta: DocumentMeta): string {
  const parts = [`v${meta.version}`, `生成于 ${readableTime(meta.createdAt)}`, `会话最后活动 ${readableTime(meta.sessionActivityAt)}`]
  if (meta.previous !== undefined && meta.previous !== '') parts.push(`上一份 \`${meta.previous}\``)
  return `> ${parts.join(' · ')}`
}

/** Render the complete document: YAML front matter, title, meta line, and model-written body. */
export function renderDocument(meta: DocumentMeta, body: string): string {
  const fields: [string, string | number][] = [
    ['title', yamlString(meta.title)],
    ['session', yamlString(meta.sessionId)],
    ['cwd', yamlString(meta.cwd)],
    ['created', yamlString(meta.createdAt)],
    ['updated', yamlString(meta.updatedAt)],
    ['version', meta.version],
    ['session-activity', yamlString(meta.sessionActivityAt)],
  ]
  if (meta.previous !== undefined && meta.previous !== '') fields.push(['previous', yamlString(meta.previous)])
  fields.push(['provider', yamlString(meta.provider)])
  fields.push(['model', yamlString(meta.model)])
  fields.push(['messages', meta.messages])
  if (meta.focus !== undefined && meta.focus !== '') fields.push(['focus', yamlString(meta.focus)])
  fields.push(['generator', yamlString(meta.generator)])

  const front = ['---', ...fields.map(([key, value]) => `${key}: ${value}`), '---'].join('\n')
  return `${front}\n\n# 交接文档 · ${meta.title}\n\n${metaLine(meta)}\n\n${body.trim()}\n`
}

/** Input for the `latest.md` pointer that always names the newest document. */
export interface LatestPointerMeta {
  readonly name: string
  readonly version: number
  readonly updatedAt: string
}

/**
 * Render `latest.md` as a pointer rather than a duplicate.
 *
 * A full copy made "which file is newest" ambiguous (two identical files with
 * the same mtime). The pointer states the answer and keeps `latest.md` cheap;
 * `/handoff resume` follows it to the real document.
 */
export function renderLatestPointer(meta: LatestPointerMeta): string {
  const front = [
    '---',
    'kind: latest-pointer',
    `latest: ${yamlString(meta.name)}`,
    `version: ${meta.version}`,
    `updated: ${yamlString(meta.updatedAt)}`,
    '---',
  ].join('\n')
  const body = [
    '# 最新交接文档',
    '',
    `最新一份是 \`${meta.name}\`（v${meta.version}，${readableTime(meta.updatedAt)}）。`,
    '',
    '直接打开它；或者在新会话里运行 `/handoff resume`，会自动跟上这里指向的文件。',
  ].join('\n')
  return `${front}\n\n${body}\n`
}

/** Read `latest: <name>` out of a pointer document; `undefined` for a legacy full copy. */
export function parseLatestPointer(content: string): string | undefined {
  const front = /^---\n([\s\S]*?)\n---/u.exec(content)
  if (front === null) return undefined
  const field = /^latest:\s*"?([^"\n]+)"?\s*$/mu.exec(front[1] ?? '')
  return field?.[1]?.trim()
}

/** Read the `version:` counter out of an existing document. */
export function parseDocumentVersion(content: string): number | undefined {
  const field = /^version:\s*(\d+)\s*$/mu.exec(content)
  if (field === null) return undefined
  const value = Number(field[1])
  return Number.isSafeInteger(value) && value > 0 ? value : undefined
}

/**
 * Clean model output: drop an accidental whole-document fence, a duplicated
 * front matter block, or a top-level heading the prompt asked it not to add.
 */
export function normalizeBody(raw: string): string {
  let body = raw.trim()

  const fence = /^```[a-zA-Z]*\n([\s\S]*?)\n```$/u.exec(body)
  if (fence?.[1] !== undefined) body = fence[1].trim()

  if (body.startsWith('---\n')) {
    const end = body.indexOf('\n---', 4)
    if (end !== -1) body = body.slice(end + 4).trim()
  }

  body = body.replace(/^# [^\n]*\n+/u, '')
  return body.trim()
}

/** File-name-safe slug that keeps CJK characters. */
export function slugify(text: string, maxChars = 28): string {
  const slug = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{Script=Han}\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, maxChars)
    .replace(/-+$/u, '')
  return slug === '' ? 'session' : slug
}

/** `20261025-2140` in the host's local time, sortable as a file name. */
function stamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

/** Build the timestamped document file name. */
export function documentFileName(prefix: string, date: Date, slug: string): string {
  const safePrefix = slugify(prefix, 24)
  return `${safePrefix}-${stamp(date)}-${slug}.md`
}

/** ISO-ish local timestamp for front matter and prompts. */
export function localTimestamp(date: Date): string {
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const pad = (value: number): string => String(Math.trunc(Math.abs(value))).padStart(2, '0')
  const iso = new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 19)
  return `${iso}${sign}${pad(offset / 60)}:${pad(offset % 60)}`
}
