/** Front-matter values are written as plain YAML scalars. */
export interface DocumentMeta {
  readonly title: string
  readonly sessionId: string
  readonly cwd: string
  readonly createdAt: string
  readonly provider: string
  readonly model: string
  readonly messages: number
  readonly focus?: string
  readonly generator: string
}

function yamlString(value: string): string {
  if (/^[\w./-]+$/u.test(value)) return value
  return JSON.stringify(value)
}

/** Render the complete document: YAML front matter, title, and model-written body. */
export function renderDocument(meta: DocumentMeta, body: string): string {
  const fields: [string, string | number][] = [
    ['title', yamlString(meta.title)],
    ['session', yamlString(meta.sessionId)],
    ['cwd', yamlString(meta.cwd)],
    ['created', yamlString(meta.createdAt)],
    ['provider', yamlString(meta.provider)],
    ['model', yamlString(meta.model)],
    ['messages', meta.messages],
  ]
  if (meta.focus !== undefined && meta.focus !== '') fields.push(['focus', yamlString(meta.focus)])
  fields.push(['generator', yamlString(meta.generator)])

  const front = ['---', ...fields.map(([key, value]) => `${key}: ${value}`), '---'].join('\n')
  return `${front}\n\n# 交接文档 · ${meta.title}\n\n${body.trim()}\n`
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
