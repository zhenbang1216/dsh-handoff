// Integration check: mount the REAL 0.2.1-rc.3 session and command services in a
// real Cordis app, then load this plugin and drive it through them (not stubs).
//
//   node --expose-internals scripts/integration.mjs
//
// `tools` and `llm` are provided as minimal services here: the registry and the
// model provider are the two seams a headless harness would own, and both are
// already covered by the unit tests and the apply smoke test. What this script
// adds is the plugin's own wiring against the real `ctx.effect`, `ctx.inject`
// and `CommandRuntime` — including the durable command lifecycle it appends.
process.noAsar = true
import { readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import * as sessionModule from '@deepseek-ai/dsh-session'
import * as commandModule from '@deepseek-ai/dsh-commands'
import * as handoff from '../lib/index.js'

const pluginOf = (module) => module.default ?? module
const report = (label, value) => console.log(`${label}: ${value}`)

const registered = []
const ctx = new Context()
ctx.provide('tools', { register: (definition) => (registered.push(definition.name), () => {}) })
ctx.provide('llm', {
  stream: () =>
    (async function* () {
      yield { type: 'text-delta', index: 0, text: '## 任务\n集成验证\n## 已完成\n- 加载插件' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })(),
})
ctx.plugin(pluginOf(sessionModule), {})
ctx.plugin(pluginOf(commandModule), {})
await new Promise((resolve) => setTimeout(resolve, 50))

const session = ctx.get('sessions').create('session-integration', { meta: { cwd: process.cwd() } })
const injected = []
const agent = { id: 'session-integration', session, inject: (input) => injected.push(input) }
session.append(
  'user/message',
  { role: 'user', content: [{ type: 'text', text: '重构登录模块' }], source: { kind: 'user' } },
  { surfaceOp: 'append' },
)

const outputDir = join(tmpdir(), 'dsh-handoff-integration')
ctx.plugin(handoff, { provider: 'test', model: 'test-model', outputDir })
await new Promise((resolve) => setTimeout(resolve, 100))

report('tools registered by the plugin', registered.join(',') || '(none)')
report('sessions service', typeof ctx.get('sessions'))
report('commands service', typeof ctx.get('commands'))
report('handoff command discovered', ctx.get('commands').find(agent, 'handoff') !== undefined)

const execution = await ctx.get('commands').execute(agent, '/handoff 集成', [], new AbortController().signal)
console.log('command result:', JSON.stringify(execution?.result))

const events = session.snapshotEvents().map((event) => event.type)
report('log has command/run', events.includes('command/run'))
report('log has command/done', events.includes('command/done'))
report('no turn was opened', !events.includes('turn/start'))

const written = await readdir(outputDir).catch(() => [])
report('documents written', written.join(',') || '(none)')

// Second half of the product: hand the document to the next session.
const resumed = await ctx.get('commands').execute(agent, '/handoff resume', [], new AbortController().signal)
console.log('resume result:', JSON.stringify(resumed?.result))
report('injected one context', injected.length === 1)
const injectedText = injected[0]?.content?.[0]?.text ?? ''
report('injected the document', injectedText.includes('<handoff>') && injectedText.includes('## 任务'))
report('injected source is the plugin', injected[0]?.source?.kind === 'dsh-handoff')

// A named document can be injected instead of latest.md.
const named = written.find((name) => name.startsWith('handoff-') && name.endsWith('.md'))
if (named !== undefined) {
  const picked = await ctx.get('commands').execute(agent, `/handoff resume ${named}`, [], new AbortController().signal)
  report('named resume names the file', String(picked?.result?.text ?? '').includes(named))
}

await rm(outputDir, { recursive: true, force: true })
