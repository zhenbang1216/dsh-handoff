/**
 * Browser half of dsh-handoff.
 *
 * Registers one sidebar page (a `main` panel beside the Host's own pages) that
 * lists generated handoff documents, previews them, and can generate a new one
 * for any live session; plus a card on this bundle's configuration page.
 *
 * Written with `createElement` and structural service types on purpose: the
 * bundle resolves `react` and the primitives through the Host's shared module
 * table, so it must not depend on monorepo-internal type packages at runtime.
 */
import { createElement as h, useCallback, useEffect, useState } from 'react'
import type { CSSProperties, ChangeEvent } from 'react'

const NS = 'dsh-handoff'
const API = '/api/dsh-handoff'

interface SlotsService {
  inject(slot: string, register: () => void): void
  register(meta: Record<string, unknown>, render: (props?: unknown) => unknown): unknown
}

interface ClientContext {
  slots: SlotsService
}

export const name = 'dsh-handoff'
export const inject = ['slots']

/** One live session offered by the picker. */
interface SessionSummary {
  id: string
  cwd: string
  title: string
  messages: number
}

/** One generated document. */
interface DocEntry {
  name: string
  path: string
  size: number
  modifiedAt: number
}

interface Envelope<T> {
  ok?: boolean
  value?: T
  error?: { code?: string; message?: string }
}

/** Call one plugin route and unwrap its envelope. */
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: 'no-store', ...init })
  let body: Envelope<T>
  try {
    body = (await response.json()) as Envelope<T>
  } catch {
    throw new Error(`HTTP ${response.status}`)
  }
  if (body.ok !== true) throw new Error(body.error?.message ?? `HTTP ${response.status}`)
  return body.value as T
}

const border = '1px solid color-mix(in srgb, currentColor 16%, transparent)'
const soft = 'color-mix(in srgb, currentColor 5%, transparent)'

const S: Record<string, CSSProperties> = {
  page: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, padding: 20, gap: 14, boxSizing: 'border-box' },
  header: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' },
  title: { fontSize: 18, fontWeight: 600 },
  subtitle: { fontSize: 12, opacity: 0.65, marginTop: 4 },
  actions: { display: 'flex', alignItems: 'center', gap: 8 },
  input: { padding: '6px 10px', borderRadius: 8, border, background: 'transparent', color: 'inherit', fontSize: 13, width: 220 },
  button: { padding: '7px 14px', borderRadius: 8, border, background: soft, color: 'inherit', fontSize: 13, cursor: 'pointer' },
  buttonDisabled: { padding: '7px 14px', borderRadius: 8, border, background: soft, color: 'inherit', fontSize: 13, opacity: 0.5, cursor: 'default' },
  toolbar: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 },
  label: { opacity: 0.65 },
  select: { padding: '5px 8px', borderRadius: 8, border, background: 'transparent', color: 'inherit', fontSize: 12, maxWidth: 420 },
  note: { opacity: 0.7, marginLeft: 8 },
  body: { display: 'flex', gap: 16, flex: 1, minHeight: 0 },
  list: { width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto', paddingRight: 4 },
  listTitle: { fontSize: 12, opacity: 0.6, marginBottom: 2 },
  item: { textAlign: 'left', padding: '8px 10px', borderRadius: 8, border, background: 'transparent', color: 'inherit', cursor: 'pointer' },
  itemActive: { textAlign: 'left', padding: '8px 10px', borderRadius: 8, border, background: soft, color: 'inherit', cursor: 'pointer' },
  itemName: { fontSize: 12, wordBreak: 'break-all' },
  itemMeta: { fontSize: 11, opacity: 0.55, marginTop: 3 },
  preview: { flex: 1, minWidth: 0, border, borderRadius: 10, overflow: 'auto', padding: 14, background: soft },
  pre: { margin: 0, fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
  empty: { fontSize: 12, opacity: 0.55, padding: 8 },
  card: { display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12 },
  row: { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '4px 0', borderBottom: '1px solid color-mix(in srgb, currentColor 8%, transparent)' },
  key: { opacity: 0.6 },
  value: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', wordBreak: 'break-all', textAlign: 'right' },
}

/** Sidebar row glyph. */
function Icon(props?: unknown) {
  const size = (props as { size?: number } | undefined)?.size ?? 16
  return h(
    'svg',
    { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' },
    h('path', { d: 'M3 2.5h6.5L13 6v7.5H3z' }),
    h('path', { d: 'M9 2.5V6h4' }),
    h('path', { d: 'M5.5 9h5M5.5 11.5h3' }),
  )
}

/** The sidebar page: docs list, preview, generate. */
function Page() {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [sessionId, setSessionId] = useState('')
  const [docs, setDocs] = useState<DocEntry[]>([])
  const [activeName, setActiveName] = useState('')
  const [content, setContent] = useState('')
  const [focus, setFocus] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    let cancelled = false
    void call<{ sessions: SessionSummary[] }>(`${API}/sessions`)
      .then((value) => {
        if (cancelled) return
        setSessions(value.sessions)
        const newest = value.sessions[value.sessions.length - 1]
        if (newest !== undefined) setSessionId(newest.id)
      })
      .catch((error: unknown) => {
        if (!cancelled) setNote(`会话列表读取失败：${String(error)}`)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const loadDocs = useCallback(async (id: string): Promise<DocEntry[]> => {
    const value = await call<{ docs: DocEntry[] }>(`${API}/docs?sessionId=${encodeURIComponent(id)}`)
    setDocs(value.docs)
    return value.docs
  }, [])

  useEffect(() => {
    if (sessionId === '') return
    let cancelled = false
    setActiveName('')
    setContent('')
    void loadDocs(sessionId).catch((error: unknown) => {
      if (!cancelled) setNote(`文档列表读取失败：${String(error)}`)
    })
    return () => {
      cancelled = true
    }
  }, [sessionId, loadDocs])

  const openDoc = useCallback(
    async (documentName: string) => {
      setActiveName(documentName)
      setContent('')
      try {
        const value = await call<{ content: string }>(
          `${API}/doc?sessionId=${encodeURIComponent(sessionId)}&name=${encodeURIComponent(documentName)}`,
        )
        setContent(value.content)
      } catch (error) {
        setContent(`读取失败：${String(error)}`)
      }
    },
    [sessionId],
  )

  const generate = useCallback(async () => {
    if (sessionId === '') return
    setBusy(true)
    setNote('')
    try {
      const value = await call<{ path: string; model: string }>(`${API}/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, focus }),
      })
      setNote(`已生成 ${value.path}（${value.model}）`)
      await loadDocs(sessionId)
      const created = value.path.split('/').pop()
      if (created !== undefined && created !== '') await openDoc(created)
    } catch (error) {
      setNote(`生成失败：${String(error)}`)
    } finally {
      setBusy(false)
    }
  }, [sessionId, focus, loadDocs, openDoc])

  const onSession = (event: ChangeEvent<HTMLSelectElement>): void => {
    setSessionId(event.target.value)
  }

  return h(
    'div',
    { style: S.page },
    h(
      'div',
      { style: S.header },
      h(
        'div',
        null,
        h('div', { style: S.title }, '交接文档'),
        h('div', { style: S.subtitle }, '把当前会话写成下一个会话能直接接手的 markdown。'),
      ),
      h(
        'div',
        { style: S.actions },
        h('input', {
          style: S.input,
          placeholder: '关注点（可省略）',
          value: focus,
          onChange: (event: ChangeEvent<HTMLInputElement>) => setFocus(event.target.value),
        }),
        h(
          'button',
          { style: busy ? S.buttonDisabled : S.button, disabled: busy || sessionId === '', onClick: () => void generate() },
          busy ? '生成中…' : '生成交接文档',
        ),
      ),
    ),
    h(
      'div',
      { style: S.toolbar },
      h('span', { style: S.label }, '会话'),
      h(
        'select',
        { style: S.select, value: sessionId, onChange: onSession },
        sessions.length === 0
          ? h('option', { value: '' }, '没有活动会话')
          : sessions.map((session) => h('option', { key: session.id, value: session.id }, `${session.title}（${session.messages} 条）`)),
      ),
      note === '' ? null : h('span', { style: S.note }, note),
    ),
    h(
      'div',
      { style: S.body },
      h(
        'div',
        { style: S.list },
        h('div', { style: S.listTitle }, `历史文档（${docs.length}）`),
        docs.length === 0
          ? h('div', { style: S.empty }, '还没有文档。点右上角生成第一份。')
          : docs.map((doc) =>
              h(
                'button',
                {
                  key: doc.name,
                  style: doc.name === activeName ? S.itemActive : S.item,
                  title: doc.name,
                  onClick: () => void openDoc(doc.name),
                },
                h('div', { style: S.itemName }, doc.name),
                h('div', { style: S.itemMeta }, `${new Date(doc.modifiedAt).toLocaleString()} · ${Math.max(1, Math.round(doc.size / 1024))} KB`),
              ),
            ),
      ),
      h(
        'div',
        { style: S.preview },
        content === ''
          ? h('div', { style: S.empty }, activeName === '' ? '选一份文档预览。' : '读取中…')
          : h('pre', { style: S.pre }, content),
      ),
    ),
  )
}

/** The configuration card on this bundle's page. */
function SettingsCard(props?: unknown) {
  const view = (props as { view?: string } | undefined)?.view
  const [config, setConfig] = useState<Record<string, unknown> | null>(null)
  const [note, setNote] = useState('')

  useEffect(() => {
    let cancelled = false
    void call<{ config: Record<string, unknown> }>(`${API}/config`)
      .then((value) => {
        if (!cancelled) setConfig(value.config)
      })
      .catch((error: unknown) => {
        if (!cancelled) setNote(`读取配置失败：${String(error)}`)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // The plugin page renders `summary` under the title and `page` in the body.
  if (view === 'summary') return h('div', null, '把当前会话整理成交接文档，写给下一个会话。')

  const rows =
    config === null
      ? []
      : Object.entries(config).map(([key, value]) =>
          h('div', { style: S.row, key }, h('span', { style: S.key }, key), h('span', { style: S.value }, String(value))),
        )

  return h(
    'div',
    { style: S.card },
    h(
      'div',
      null,
      '这些值来自 profile 里的插件配置（cordis.patch.yml 的 dsh-handoff 条目）。改完后重新加载插件或重启 Harness 生效；下面的值是当前这次运行实际使用的。',
    ),
    note === '' ? null : h('div', { style: S.empty }, note),
    ...rows,
  )
}

/** Register the page, its sidebar row, and the bundle's configuration card. */
export function apply(ctx: ClientContext): void {
  // `inject` is the slot's prop factory; these surfaces read only owner props,
  // so it supplies nothing. Passing it keeps the registration shape identical
  // to the shipped third-party plugins' (the slot contract expects the field).
  const noProps = (): Record<string, never> => ({})

  ctx.slots.inject('sidebar.panellist', () => {
    ctx.slots.register({ name: 'main', key: NS, inject: noProps }, Page)
    ctx.slots.register({ name: 'sidebar.panellist', id: NS, order: 30, label: () => '交接文档', inject: noProps }, Icon)
  })

  ctx.slots.inject('plugins.bundle.config', () => {
    ctx.slots.register({ name: 'plugins.bundle.config', key: NS, inject: noProps }, SettingsCard)
  })
}
