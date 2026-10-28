import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type { HandoffConfig } from './config.ts'
import { HandoffError } from './errors.ts'
import { generateHandoff } from './generate.ts'
import { parseLatestPointer } from './markdown.ts'
import { listDocuments, readDocument, resolveOutputDir } from './store.ts'
import { firstUserLine } from './transcript.ts'

/**
 * URL prefix of this plugin's small HTTP surface.
 *
 * Exact routes live under the Host's `/api` channel: the Connection registry
 * validates every path against it and refuses anything outside.
 */
const PREFIX = '/api/dsh-handoff'

/** One exact route as the Host connection registry expects it. */
interface ExactRoute {
  readonly path: string
  readonly methods: readonly string[]
  readonly requestBody: 'buffered'
  readonly fetch: (request: Request) => Promise<Response>
}

/**
 * The slice of the Host connection service used here.
 *
 * `registerFetchRoute(owner, route)` is the current API; the older
 * `fetch.register(route)` shape is kept as a fallback so the plugin spans both
 * core lines. Both register on the calling fiber and return its disposer.
 */
interface ConnectionLike {
  readonly registerFetchRoute?: (owner: unknown, route: ExactRoute) => () => void
  readonly fetch?: {
    readonly register?: (route: ExactRoute) => () => void
  }
}

/** JSON envelope every route answers with, matching the Host's own style. */
function ok(value: unknown): Response {
  return Response.json({ ok: true, value }, { headers: { 'cache-control': 'no-store' } })
}

function fail(code: string, message: string): Response {
  return Response.json({ ok: false, error: { code, message } }, { headers: { 'cache-control': 'no-store' } })
}

/** Read one required string field from a JSON body. */
async function bodyOf(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = (await request.json()) as unknown
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('not an object')
    return value as Record<string, unknown>
  } catch {
    throw new HandoffError('BAD_REQUEST', '请求体不是 JSON 对象。')
  }
}

/** One live session, as the panel's picker needs it. */
interface SessionSummary {
  readonly id: string
  readonly cwd: string
  readonly title: string
  readonly messages: number
}

/**
 * Mount the panel's HTTP surface.
 *
 * Every route is an exact Host route: the request carries the browser's
 * authenticated cookie, so nothing here is readable from another origin.
 */
export function mountRoutes(ctx: Context, config: HandoffConfig): void {
  ctx.inject(['connection', 'sessions'], (scoped) => {
    const connection = scoped.get('connection') as ConnectionLike | undefined
    if (connection === undefined) return
    const current = connection.registerFetchRoute
    const legacy = connection.fetch?.register

    const sessions = scoped.sessions
    const sessionOf = (id: string): Session => {
      if (id === '') throw new HandoffError('BAD_REQUEST', '缺少 sessionId。')
      const session = sessions.get(id as never)
      if (session === undefined) throw new HandoffError('NO_SESSION', `找不到会话 ${id}（只列出当前进程里活着的会话）。`)
      return session
    }
    const outputDirOf = (session: Session): string =>
      resolveOutputDir(session.header.cwd ?? process.cwd(), config.outputDir)

    const route = (path: string, methods: readonly string[], handler: (request: Request) => Promise<Response>, label: string): void => {
      const exact: ExactRoute = { path: `${PREFIX}${path}`, methods, requestBody: 'buffered', fetch: handler }
      if (typeof current === 'function') {
        current.call(connection, scoped, exact)
        return
      }
      if (typeof legacy === 'function') {
        scoped.effect(() => legacy.call(connection.fetch, exact), label)
      }
    }

    route('/config', ['GET'], async () => {
      return ok({ config })
    }, 'dsh-handoff: config route')

    route('/sessions', ['GET'], async () => {
      const value: SessionSummary[] = sessions.list().map((session) => {
        try {
          const messages = session.deriveMessages()
          return {
            id: String(session.id),
            cwd: session.header.cwd ?? '',
            title: firstUserLine(messages) || String(session.id),
            messages: messages.length,
          }
        } catch {
          return { id: String(session.id), cwd: session.header.cwd ?? '', title: String(session.id), messages: 0 }
        }
      })
      return ok({ sessions: value })
    }, 'dsh-handoff: sessions route')

    route('/docs', ['GET'], async (request) => {
      try {
        const url = new URL(request.url)
        const session = sessionOf(url.searchParams.get('sessionId') ?? '')
        const dir = outputDirOf(session)
        const docs = await listDocuments(dir)
        // The pointer, not the mtime, decides which document is newest: a
        // manually edited old file would otherwise steal the badge.
        let latest: string | undefined
        try {
          latest = parseLatestPointer(await readDocument(dir, 'latest.md'))
        } catch {
          latest = undefined
        }
        return ok({ dir, latest, docs })
      } catch (error) {
        return errorResponse(error)
      }
    }, 'dsh-handoff: docs route')

    route('/doc', ['GET'], async (request) => {
      try {
        const url = new URL(request.url)
        const session = sessionOf(url.searchParams.get('sessionId') ?? '')
        const name = url.searchParams.get('name') ?? ''
        return ok({ name, content: await readDocument(outputDirOf(session), name) })
      } catch (error) {
        return errorResponse(error)
      }
    }, 'dsh-handoff: doc route')

    route('/generate', ['POST'], async (request) => {
      try {
        const body = await bodyOf(request)
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
        const focus = typeof body.focus === 'string' ? body.focus.trim() : ''
        const session = sessionOf(sessionId)
        const result = await generateHandoff({ ctx: scoped, session, config, focus })
        return ok({
          path: result.relativePath,
          version: result.version,
          messages: result.stats.messages,
          chars: result.stats.chars,
          model: `${result.route.provider}/${result.route.model}`,
          truncated: result.stats.truncated,
        })
      } catch (error) {
        return errorResponse(error)
      }
    }, 'dsh-handoff: generate route')
  })
}

/** Map a thrown value onto the shared JSON envelope. */
function errorResponse(error: unknown): Response {
  if (error instanceof HandoffError) return fail(error.code, error.message)
  if (error instanceof Error) return fail('INTERNAL', error.message)
  return fail('INTERNAL', String(error))
}
