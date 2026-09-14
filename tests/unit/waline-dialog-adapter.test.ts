// @vitest-environment jsdom
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { adaptWalineDialogs, walineDialogPlugin } from '../../scripts/waline-dialog-plugin.mjs'
import { createWalineDialogs } from '../../src/lib/comments/waline-dialogs'
import { createWalineProvider } from '../../src/lib/comments/waline'

const require = createRequire(import.meta.url)
const entry = require.resolve('@waline/client')
const source = readFileSync(entry, 'utf8')
const dependencyRequire = createRequire(entry)
let sequence = 0
// Execute the actual adapted vendor module (and its actual Vue/API dependencies),
// resolving its private pnpm dependencies without modifying node_modules.
async function loadClient() {
  const transformed = adaptWalineDialogs(source).replace(/from"([^"]+)"/g, (_: string, specifier: string) =>
    `from${JSON.stringify(pathToFileURL(dependencyRequire.resolve(specifier)).href)}`)
  const url = `data:text/javascript;base64,${Buffer.from(`${transformed}\n// fixture ${sequence++}`).toString('base64')}`
  return import(/* @vite-ignore */ url)
}

let instance: { destroy(): void } | undefined
let controller: AbortController
const fetchMock = vi.fn()
const mutations = () => fetchMock.mock.calls.filter(([, options]) => ['DELETE', 'POST', 'PUT'].includes(options?.method))
const click = (selector: string) => document.querySelector<HTMLButtonElement>(selector)!.click()
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); document.body.innerHTML = '<div id="comments"></div>'
  controller = new AbortController()
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.open = true } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.open = false } })
  vi.spyOn(window, 'alert').mockImplementation(() => { throw new Error('Native alert forbidden') })
  vi.spyOn(window, 'confirm').mockImplementation(() => { throw new Error('Native confirm forbidden') })
  fetchMock.mockReset().mockImplementation(async (_url, options) => ({
    ok: true, json: async () => options?.method === 'DELETE' ? { errno: 0 } : {
      errno: 0, data: { count: 1, totalPages: 1, data: [{
        objectId: 'comment-1', user_id: 'admin-1', nick: 'Reviewer', comment: '<p>Test comment</p>',
        time: '2026-09-14T00:00:00Z', children: [], status: 'approved'
      }] }
    }
  }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  controller.abort(); instance?.destroy(); instance = undefined
  window.dispatchEvent(new Event('pagehide'))
  vi.unstubAllGlobals(); vi.restoreAllMocks()
})

async function mount(admin = true, extra = {}) {
  if (admin) localStorage.setItem('WALINE_USER', JSON.stringify({ objectId: 'admin-1', type: 'administrator', token: 'test-only' }))
  const client = await loadClient()
  instance = client.init({
    el: '#comments', serverURL: 'https://comments.invalid', path: '/fixture/', lang: 'zh-CN',
    emoji: false, search: false, highlighter: null, texRenderer: null, imageUploader: null,
    requiredMeta: ['nick'], __blogDialogs: createWalineDialogs(controller.signal), ...extra
  })
  await vi.waitFor(() => expect(document.querySelector('.wl-card')).not.toBeNull())
}

describe('reviewed Waline module dialog adapter', () => {
  it('is restricted to the locked slim module and prevents prebundling bypass', () => {
    const plugin = walineDialogPlugin()
    expect(plugin.config().optimizeDeps.exclude).toEqual(['@waline/client'])
    expect(plugin.transform(source, '/other/slim.js')).toBeUndefined()
    expect(plugin.transform(source, entry)?.code).toContain('if(!await d.value.__blogDialogs.confirm(__blogIdentity,__blogSameUser)||!d.value.__blogDialogs.isActive()||!d.value.__blogDialogs.isCurrentUser(__blogIdentity)||!__blogSameUser())return')
    expect(() => adaptWalineDialogs(`${source}\n`)).toThrow('reviewed 3.15.2')
    expect(adaptWalineDialogs(source)).not.toMatch(/(?<!\.)\b(?:alert|confirm|prompt)\(/)
  })

  it('does not delete before confirmation or after cancellation, and deletes only after acceptance', async () => {
    await mount()
    click('.wl-delete'); await flush()
    expect(document.querySelector('[data-site-dialog="confirm"]')).not.toBeNull()
    expect(mutations()).toHaveLength(0)
    click('[data-site-dialog-cancel]'); await flush()
    expect(mutations()).toHaveLength(0)
    expect(document.querySelector('.wl-card')).not.toBeNull()
    click('.wl-delete'); await flush()
    click('[data-site-dialog-confirm]')
    await vi.waitFor(() => expect(mutations()).toHaveLength(1))
    expect(mutations()[0][0]).toBe('https://comments.invalid/api/comment/comment-1?lang=zh-CN')
    expect(mutations()[0][1].method).toBe('DELETE')
    expect(window.confirm).not.toHaveBeenCalled()
  })

  it.each(['dispose', 'navigation', 'accept-dispose-race'])('cannot delete after %s', async reason => {
    await mount(); click('.wl-delete'); await flush()
    if (reason === 'navigation') document.dispatchEvent(new Event('astro:before-swap'))
    else {
      if (reason === 'accept-dispose-race') click('[data-site-dialog-confirm]')
      controller.abort(); instance?.destroy(); instance = undefined
    }
    await flush()
    expect(mutations()).toHaveLength(0)
    expect(document.querySelector('[data-site-dialog]')).toBeNull()
  })

  it('rechecks disposal between adapter resolution and the vendor delete continuation', async () => {
    const adapter = createWalineDialogs(controller.signal)
    const originalConfirm = adapter.confirm
    adapter.confirm = (...args) => {
      const pending = originalConfirm(...args)
      void pending.then(() => controller.abort())
      return pending
    }
    await mount(true, { __blogDialogs: adapter })
    click('.wl-delete'); await flush(); click('[data-site-dialog-confirm]'); await flush()
    expect(mutations()).toHaveLength(0)
  })

  it.each(['storage', 'focus', 'visibilitychange', 'silent'])('cannot delete under a changed login (%s)', async event => {
    await mount(); click('.wl-delete'); await flush()
    const accept = document.querySelector<HTMLButtonElement>('[data-site-dialog-confirm]')!
    const oldValue = localStorage.getItem('WALINE_USER')
    const newValue = JSON.stringify({ token: 'another-test-token', objectId: 'admin-2', type: 'administrator' })
    localStorage.setItem('WALINE_USER', newValue)
    if (event === 'storage') window.dispatchEvent(new StorageEvent('storage', { key: 'WALINE_USER', oldValue, newValue, storageArea: localStorage }))
    if (event === 'focus') window.dispatchEvent(new Event('focus'))
    if (event === 'visibilitychange') document.dispatchEvent(new Event('visibilitychange'))
    await flush()
    if (event !== 'silent') expect(document.querySelector('[data-site-dialog]')).toBeNull()
    accept.click(); await flush()
    expect(mutations()).toHaveLength(0)
  })

  it('rejects a changed Vue login even when stored credentials have not caught up', async () => {
    await mount(); click('.wl-delete'); await flush()
    const accept = document.querySelector<HTMLButtonElement>('[data-site-dialog-confirm]')!
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'WALINE_USER', storageArea: localStorage,
      newValue: JSON.stringify({ token: 'tab-only-test-token', objectId: 'admin-2', type: 'administrator' })
    }))
    await flush(); accept.click(); await flush()
    expect(mutations()).toHaveLength(0)
  })

  it.each(['token', 'objectId'])('binds confirmation to the original %s independently', async field => {
    await mount(); click('.wl-delete'); await flush()
    const changed = { token: 'test-only', objectId: 'admin-1', [field]: 'changed-test-value' }
    localStorage.setItem('WALINE_USER', JSON.stringify(changed))
    click('[data-site-dialog-confirm]'); await flush()
    expect(mutations()).toHaveLength(0)
  })

  it('rechecks identity between adapter resolution and the vendor delete continuation', async () => {
    const adapter = createWalineDialogs(controller.signal)
    const originalConfirm = adapter.confirm
    adapter.confirm = (...args) => {
      const pending = originalConfirm(...args)
      void pending.then(() => localStorage.setItem('WALINE_USER', JSON.stringify({ token: 'changed-after-confirm', objectId: 'admin-2' })))
      return pending
    }
    await mount(true, { __blogDialogs: adapter })
    click('.wl-delete'); await flush(); click('[data-site-dialog-confirm]'); await flush()
    expect(mutations()).toHaveLength(0)
  })

  it('shows missing-nickname validation inline without submitting or calling native alert', async () => {
    await mount(false)
    const textarea = document.querySelector<HTMLTextAreaElement>('textarea')!
    textarea.value = 'A comment'; textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await flush(); click('.wl-btn.primary'); await flush()
    expect(document.querySelector('[data-site-dialog="alert"]')).not.toBeNull()
    expect(mutations()).toHaveLength(0)
    expect(window.alert).not.toHaveBeenCalled()
  })

  it.each(['mail', 'wordLimit'])('adapts %s validation without submitting', async validation => {
    await mount(false, validation === 'wordLimit' ? { wordLimit: [10, 20] } : {})
    for (const [selector, value] of [
      ['.wl-nick', 'Reader'], ['.wl-mail', validation === 'mail' ? 'invalid-mail' : ''], ['textarea', '短评']
    ]) {
      const input = document.querySelector<HTMLInputElement>(selector)!
      input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    await flush(); click('.wl-btn.primary'); await flush()
    expect(document.querySelector('[data-site-dialog="alert"]')).not.toBeNull()
    expect(mutations()).toHaveLength(0)
    expect(window.alert).not.toHaveBeenCalled()
  })

  it('uses a fixed error notice without echoing a private server response', async () => {
    await mount()
    fetchMock.mockImplementation(async () => ({ json: async () => ({ errno: 1, errmsg: 'private-server-value' }) }))
    const textarea = document.querySelector<HTMLTextAreaElement>('textarea')!
    textarea.value = 'A comment'; textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await flush(); click('.wl-btn.primary'); await flush()
    expect(document.querySelector('[data-site-dialog="alert"]')?.textContent).toContain('评论提交未完成')
    expect(document.body.textContent).not.toContain('private-server-value')
    expect(window.alert).not.toHaveBeenCalled()
  })

  it('does not mount a stale client after provider disposal during load', async () => {
    let resolve!: (value: any) => void
    const init = vi.fn()
    const provider = createWalineProvider({ probe: async () => {}, load: () => new Promise(done => { resolve = done }) })
    const pending = provider.mount(document.querySelector('#comments')!, '/old/')
    await flush(); provider.dispose(); resolve({ init }); await pending
    expect(init).not.toHaveBeenCalled()
  })

  it('provider disposal aborts the dialog adapter passed into its instance', async () => {
    const identity = { token: 'test-only', objectId: 'admin-1' }
    localStorage.setItem('WALINE_USER', JSON.stringify(identity))
    const init = vi.fn((_options: { __blogDialogs: ReturnType<typeof createWalineDialogs> }) => ({ destroy: vi.fn() }))
    const provider = createWalineProvider({ probe: async () => {}, load: async () => ({ init }) })
    await provider.mount(document.querySelector('#comments')!, '/fixture/')
    const adapter = init.mock.calls[0][0].__blogDialogs
    const accepted = adapter.confirm(identity)
    expect(document.querySelector('[data-site-dialog="confirm"]')).not.toBeNull()
    provider.dispose()
    expect(await accepted).toBe(false)
    expect(await adapter.confirm(identity)).toBe(false)
  })
})
