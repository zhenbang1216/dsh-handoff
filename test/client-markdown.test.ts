import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { markdownBody } from '../src/client/index.ts'

/** Render one markdown source through the panel's preview renderer. */
const render = (src: string): string => renderToStaticMarkup(h('div', null, ...markdownBody(src)))

describe('client markdown renderer', () => {
  // A full document in the shape the prompt contract produces. This is the
  // path the mount-time tests never exercise — and the path that once pinned
  // the renderer when a branch forgot to advance the line cursor.
  const document = [
    '---',
    'title: "重构登录模块"',
    'version: 2',
    '---',
    '',
    '# 交接文档 · 重构登录模块',
    '',
    '> v2 · 生成于 2026-10-26 08:58:33 +08:00 · 上一份 `handoff-20261026-085801-….md`',
    '',
    '## 任务',
    '',
    '把 `src/auth/login.ts` 的回调式登录改写成 Promise 流程，并补齐单测。',
    '',
    '## 已完成',
    '',
    '- 登录主流程已迁移到 `loginWithPromise()`',
    '- **完成** 9/12 个用例',
    '',
    '## 下一步',
    '',
    '1. 给 `refreshExpiresAt` 注入假时钟',
    '2. 跑 `pnpm test` 直到全绿',
    '',
    '## 踩坑与规避',
    '',
    '- 拦截器里不能直接 `await`，会吞掉 401 重试',
    '',
    '```ts',
    'pnpm test',
    '```',
    '',
  ].join('\n')

  it('renders the handoff section contract', () => {
    const html = render(document)
    expect(html).toContain('<h1>交接文档 · 重构登录模块</h1>')
    expect(html).toContain('<blockquote>v2 · 生成于')
    expect(html).toContain('<h2>任务</h2>')
    expect(html).toContain('<code>loginWithPromise()</code>')
    expect(html).toContain('<strong>完成</strong>')
    expect(html).toContain('<ol>')
    expect(html).toContain('<pre><code>pnpm test</code></pre>')
  })

  it('keeps every branch of the parser advancing', () => {
    const samples = [
      '## 任务',
      '## a\n## b\n## c',
      '#\n## \n### x',
      '```ts\nnever closed',
      '- a\n  continued\n1. b',
      '> quote\n## heading after quote',
      '---\n***\n___',
      '\n\n\n',
      '[链接](https://example.com) 与 `代码` 与 **加粗**',
    ]
    for (const sample of samples) expect(render(sample).length).toBeGreaterThan(0)
  })
})
