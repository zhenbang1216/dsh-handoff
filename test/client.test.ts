import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { apply, inject, name } from '../src/client/index.ts'

/** Minimal stand-in for the Host's slot service. */
function mount() {
  const registered = new Map<string, (props?: unknown) => unknown>()
  const injections: string[] = []
  const ctx = {
    slots: {
      inject(slot: string, callback: () => void) {
        injections.push(slot)
        callback()
      },
      register(meta: Record<string, unknown>, render: (props?: unknown) => unknown) {
        registered.set(`${String(meta.name)}:${String(meta.key ?? meta.id)}`, render)
        return () => {}
      },
    },
  }
  apply(ctx as never)
  return { registered, injections }
}

const render = (component: (props?: unknown) => unknown, props?: unknown): string =>
  renderToStaticMarkup(createElement(component as never, props as never))

describe('client half', () => {
  it('declares its identity and service dependency', () => {
    expect(name).toBe('dsh-handoff')
    expect(inject).toEqual(['slots'])
  })

  it('waits for the slots it renders into', () => {
    const { injections } = mount()
    expect(injections).toEqual(['sidebar.panellist', 'plugins.bundle.config'])
  })

  it('registers the page, the sidebar row and the config card', () => {
    const { registered } = mount()
    expect([...registered.keys()]).toEqual([
      'main:dsh-handoff',
      'sidebar.panellist:dsh-handoff',
      'plugins.bundle.config:dsh-handoff',
    ])
  })

  it('renders the page chrome before any data arrives', () => {
    const { registered } = mount()
    const html = render(registered.get('main:dsh-handoff') as never)
    expect(html).toContain('交接文档')
    expect(html).toContain('生成交接文档')
    expect(html).toContain('还没有文档')
  })

  it('renders the sidebar glyph as an svg', () => {
    const { registered } = mount()
    const html = render(registered.get('sidebar.panellist:dsh-handoff') as never, { size: 16 })
    expect(html.startsWith('<svg')).toBe(true)
    expect(html).toContain('width="16"')
  })

  it('renders a summary line for the plugin list and the card for the page', () => {
    const { registered } = mount()
    const card = registered.get('plugins.bundle.config:dsh-handoff') as never
    const summary = render(card, { view: 'summary' })
    expect(summary).not.toContain('cordis.patch.yml')
    expect(summary).toContain('交接文档')

    const page = render(card, { view: 'page' })
    expect(page).toContain('cordis.patch.yml')
  })
})
