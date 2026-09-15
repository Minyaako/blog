import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { getMomentReactions, MomentReactionController, reactionStorageKey, readReactionRecord, ReactionRejected, updateMomentReaction } from '../../src/lib/moment-reactions'
import { installMomentReactions } from '../../src/scripts/moment-reactions'

const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string, options: { url: string }) => { window: Window & typeof globalThis }
}
const id = '20260913-184922-63863825'
const counts = [7, 2, 0, 1, 0, 0]
const result = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
const cleanup: (() => void)[] = []
afterEach(() => { cleanup.splice(0).forEach(dispose => dispose()) })

function fixture() {
  const saved = new Map<string, string>()
  const storage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key, value) } }
  const read = vi.fn(async (_id: string, _signal: AbortSignal) => [...counts])
  const update = vi.fn(async (_id: string, index: number, action: 'inc' | 'desc') => counts[index]! + (action === 'inc' ? 1 : -1))
  const dependencies = { storage, read, update }
  const controller = new MomentReactionController(id, dependencies)
  return { controller, saved, dependencies, storage, read, update }
}
const load = (model: MomentReactionController) => model.load(new AbortController().signal)

describe('Waline moment reaction contract', () => {
  it('reads all six real counters using the stable moment id without cookies', async () => {
    const request = vi.fn<typeof fetch>(async () => result({ errno: 0, data: [{ reaction0: 7, reaction1: 2, reaction2: 0, reaction3: 1, reaction4: 0, reaction5: 0 }] }))
    expect(await getMomentReactions(id, new AbortController().signal, request)).toEqual(counts)
    const url = new URL(String(request.mock.calls[0]![0]))
    expect(url.searchParams.get('path')).toBe(id)
    expect(url.searchParams.get('type')).toBe('reaction0,reaction1,reaction2,reaction3,reaction4,reaction5')
    expect(request.mock.calls[0]![1]?.credentials).toBe('omit')
  })
  it('uses the confirmed POST count, even when it differs from a local increment', async () => {
    const request = vi.fn<typeof fetch>(async () => result({ errno: 0, data: [{ reaction1: 99 }] }))
    expect(await updateMomentReaction(id, 1, 'inc', request)).toBe(99)
    expect(JSON.parse(String(request.mock.calls[0]![1]?.body))).toEqual({ path: id, type: 'reaction1', action: 'inc' })
  })
  it.each([{}, { errno: 0, data: [] }, { errno: 0, data: [null] }, { errno: 0, data: [{ reaction0: -1 }] }, { errno: 0, data: [{ reaction0: '7' }] }])('rejects malformed counts rather than substituting zero: %j', async body => {
    await expect(getMomentReactions(id, new AbortController().signal, vi.fn(async () => result(body)))).rejects.toThrow()
  })
  it('distinguishes an explicit server rejection from an uncertain network outcome', async () => {
    await expect(updateMomentReaction(id, 0, 'inc', vi.fn(async () => result({ errno: 403, errmsg: 'Forbidden' })))).rejects.toBeInstanceOf(ReactionRejected)
    await expect(updateMomentReaction(id, 0, 'inc', vi.fn(async () => result({ errno: 0, data: [{ reaction0: 8 }] }, 503)))).rejects.not.toBeInstanceOf(ReactionRejected)
  })
})

describe('confirmed anonymous reaction choices', () => {
  it('loads without adding a vote, adds one choice, and cancels it on the second click', async () => {
    const f = fixture()
    await load(f.controller)
    expect(f.update).not.toHaveBeenCalled()
    await f.controller.choose(0)
    expect(f.controller.state).toMatchObject({ phase: 'ready', selected: 0, counts: [8, 2, 0, 1, 0, 0] })
    await f.controller.choose(0)
    expect(f.controller.state.selected).toBeNull()
    expect(f.update.mock.calls.map(call => call.slice(1))).toEqual([[0, 'inc'], [0, 'desc']])
    expect(readReactionRecord(f.storage, id)).toEqual({ selected: null, pending: false })
  })
  it('switches by confirming removal before adding the next choice', async () => {
    const f = fixture()
    f.saved.set(reactionStorageKey(id), JSON.stringify({ selected: 0, pending: false }))
    await load(f.controller)
    await f.controller.choose(1)
    expect(f.update.mock.calls.map(call => call.slice(1))).toEqual([[0, 'desc'], [1, 'inc']])
    expect(f.controller.state).toMatchObject({ selected: 1, counts: [6, 3, 0, 1, 0, 0] })
    expect(readReactionRecord(f.storage, id)).toEqual({ selected: 1, pending: false })
  })
  it('preserves a successful removal if the replacement is explicitly rejected', async () => {
    const f = fixture()
    f.saved.set(reactionStorageKey(id), JSON.stringify({ selected: 0, pending: false }))
    f.update.mockResolvedValueOnce(6).mockRejectedValueOnce(new ReactionRejected('denied'))
    await load(f.controller)
    await f.controller.choose(1)
    expect(f.controller.state).toMatchObject({ phase: 'ready', selected: null, counts: [6, 2, 0, 1, 0, 0] })
    expect(f.controller.state.message).toContain('原回应已取消')
    expect(readReactionRecord(f.storage, id)).toEqual({ selected: null, pending: false })
  })
  it('keeps a durable pending marker after uncertain POST failure and never automatically repeats it', async () => {
    const f = fixture()
    f.update.mockRejectedValueOnce(new TypeError('connection lost'))
    await load(f.controller)
    await f.controller.choose(0)
    await f.controller.choose(0)
    expect(f.update).toHaveBeenCalledOnce()
    expect(f.controller.state.phase).toBe('uncertain')
    expect(readReactionRecord(f.storage, id)).toEqual({ selected: null, pending: true })
    const reloaded = new MomentReactionController(id, f.dependencies)
    await load(reloaded)
    await reloaded.choose(1)
    expect(reloaded.state.phase).toBe('uncertain')
    expect(f.update).toHaveBeenCalledOnce()
  })
  it('prevents two pending taps from generating two increments', async () => {
    const f = fixture()
    let finish!: (count: number) => void
    f.update.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await load(f.controller)
    const first = f.controller.choose(0)
    await f.controller.choose(1)
    expect(f.update).toHaveBeenCalledOnce()
    finish(8)
    await first
    expect(f.controller.state.selected).toBe(0)
  })
  it('does not send when local storage is blocked, but can still show server counts', async () => {
    const f = fixture()
    f.storage.setItem = () => { throw new Error('quota') }
    await load(f.controller)
    await f.controller.choose(0)
    expect(f.controller.state).toMatchObject({ phase: 'unavailable', counts })
    expect(f.update).not.toHaveBeenCalled()
  })
  it('does not mistake a GET failure for zero reactions and permits a read retry', async () => {
    const f = fixture()
    f.read.mockRejectedValueOnce(new Error('offline'))
    await load(f.controller)
    expect(f.controller.state).toMatchObject({ phase: 'error', counts: null })
    await load(f.controller)
    expect(f.controller.state).toMatchObject({ phase: 'ready', counts })
  })
  it('ignores an older read response after a newer refresh has completed', async () => {
    const f = fixture()
    let finish!: (counts: number[]) => void
    f.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const older = load(f.controller)
    await load(f.controller)
    finish([0, 0, 0, 0, 0, 0])
    await older
    expect(f.controller.state.counts).toEqual(counts)
  })
  it('shows a retryable error for the read deadline while ignoring a disposed-page abort', async () => {
    for (const reason of ['TimeoutError', 'AbortError']) {
      const f = fixture()
      f.read.mockImplementationOnce((_id, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason))
      }))
      const lifecycle = new AbortController()
      const pending = f.controller.load(lifecycle.signal)
      lifecycle.abort(new DOMException('Stopped', reason))
      await pending
      expect(f.controller.state.phase).toBe(reason === 'TimeoutError' ? 'error' : 'loading')
      if (reason === 'TimeoutError') {
        await load(f.controller)
        expect(f.controller.state.phase).toBe('ready')
      }
    }
  })
})

const markup = (preview = false) => `<div data-moment-page-items><div data-moment-reactions data-reaction-id="${id}" data-preview="${preview}"><div>${counts.map((_, i) => `<button data-reaction-index="${i}" disabled><span data-reaction-count>—</span></button>`).join('')}</div><button data-reaction-toggle aria-expanded="false">+</button><div data-reaction-picker hidden tabindex="-1">${counts.map((_, i) => `<button data-reaction-choice="${i}" disabled>选择</button>`).join('')}</div><span data-reaction-status></span><button data-reaction-retry hidden>重试</button></div></div>`
function domFixture(origin = 'https://gsk.minyako.top', preview = false) {
  const f = fixture()
  const dom = new JSDOM(markup(preview), { url: `${origin}/moments/` })
  cleanup.push(installMomentReactions(dom.window.document, dom.window, f.dependencies), () => dom.window.close())
  return { ...f, dom, doc: dom.window.document }
}

describe('moment reaction UI lifecycle', () => {
  it('collapses zero-count choices and restores focus when the last reaction is cancelled', async () => {
    const f = domFixture()
    await vi.waitFor(() => expect(f.doc.querySelector('[data-reaction-state="ready"]')).not.toBeNull())
    const summary = f.doc.querySelector<HTMLButtonElement>('[data-reaction-index="2"]')!
    const toggle = f.doc.querySelector<HTMLButtonElement>('[data-reaction-toggle]')!
    const picker = f.doc.querySelector<HTMLElement>('[data-reaction-picker]')!
    const choice = picker.querySelector<HTMLButtonElement>('[data-reaction-choice="2"]')!
    expect(summary.hidden).toBe(true)
    expect(picker.hidden).toBe(true)
    toggle.click()
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(picker.hidden).toBe(false)
    choice.click()
    await vi.waitFor(() => expect(summary.hidden).toBe(false))
    expect(picker.hidden).toBe(true)
    expect(f.doc.activeElement).toBe(toggle)
    summary.focus()
    summary.click()
    await vi.waitFor(() => expect(summary.hidden).toBe(true))
    expect(f.doc.activeElement).toBe(toggle)
    expect(f.update.mock.calls.map(call => call.slice(1))).toEqual([[2, 'inc'], [2, 'desc']])
  })
  it('closes the picker with Escape or an outside click without sending a reaction', async () => {
    const f = domFixture()
    await vi.waitFor(() => expect(f.doc.querySelector('[data-reaction-state="ready"]')).not.toBeNull())
    const toggle = f.doc.querySelector<HTMLButtonElement>('[data-reaction-toggle]')!
    const picker = f.doc.querySelector<HTMLElement>('[data-reaction-picker]')!
    toggle.click()
    picker.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(picker.hidden).toBe(true)
    expect(f.doc.activeElement).toBe(toggle)
    toggle.click()
    f.doc.body.click()
    expect(picker.hidden).toBe(true)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(f.update).not.toHaveBeenCalled()
  })
  it.each([['http://localhost:4321', false], ['https://preview.gsk.minyako.top', false], ['https://gsk.minyako.top', true]] as const)('does not read or write production counters from %s (preview=%s)', async (origin, preview) => {
    const f = domFixture(origin, preview)
    expect(f.doc.querySelector('[data-reaction-state="disabled"]')).not.toBeNull()
    expect(f.read).not.toHaveBeenCalled()
    expect(f.update).not.toHaveBeenCalled()
  })
  it('renders server counts, initializes once and keeps buttons accessible', async () => {
    const f = domFixture()
    installMomentReactions(f.doc, f.dom.window, f.dependencies)
    f.doc.dispatchEvent(new f.dom.window.Event('astro:page-load'))
    await vi.waitFor(() => expect(f.doc.querySelector('[data-reaction-state="ready"]')).not.toBeNull())
    expect(f.read).toHaveBeenCalledOnce()
    const button = f.doc.querySelector<HTMLButtonElement>('[data-reaction-index="0"]')!
    expect(button.getAttribute('aria-label')).toContain('7 次回应')
    button.click()
    await vi.waitFor(() => expect(button.getAttribute('aria-pressed')).toBe('true'))
    expect(button.textContent).toBe('8')
  })
  it('mounts reactions in appended moments and after client navigation without duplicate writes', async () => {
    const f = domFixture()
    await vi.waitFor(() => expect(f.read).toHaveBeenCalledOnce())
    f.doc.dispatchEvent(new f.dom.window.Event('astro:before-swap'))
    f.doc.body.innerHTML = markup()
    f.doc.dispatchEvent(new f.dom.window.Event('astro:page-load'))
    await vi.waitFor(() => expect(f.read).toHaveBeenCalledTimes(2))
    const extra = f.doc.createElement('div')
    extra.innerHTML = markup().replaceAll(id, '20260909-043750-dc777de5')
    f.doc.querySelector('[data-moment-page-items]')!.append(extra)
    await vi.waitFor(() => expect(f.read).toHaveBeenCalledTimes(3))
    expect(f.update).not.toHaveBeenCalled()
  })
})
