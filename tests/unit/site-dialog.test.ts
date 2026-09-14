// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { alertDialog, chooseDialog, confirmDialog, promptDialog } from '../../src/scripts/site-dialog'

const options = { title: '继续操作', message: '请确认这次操作。' }
const dialog = () => document.querySelector<HTMLDialogElement>('[data-site-dialog]')!
const accept = () => dialog().querySelector<HTMLButtonElement>('[data-site-dialog-confirm]')!.click()
const cancel = () => dialog().querySelector<HTMLButtonElement>('[data-site-dialog-cancel]')!.click()

beforeEach(() => {
  // jsdom does not implement the top-layer API; browser coverage checks its native focus trap.
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: vi.fn(function (this: HTMLDialogElement) { this.open = true }) })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: vi.fn(function (this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event('close')) }) })
  document.body.replaceChildren()
})
afterEach(() => { window.dispatchEvent(new Event('pagehide')); document.body.replaceChildren(); vi.restoreAllMocks() })

describe('shared site dialogs', () => {
  it('lazily opens a named, described modal and restores focus after destructive cancellation', async () => {
    expect(dialog()).toBeNull()
    const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus()
    const result = confirmDialog({ ...options, danger: true, confirmLabel: '丢弃草稿', cancelLabel: '继续编辑' })
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledOnce()
    expect(dialog().open).toBe(true)
    expect(document.getElementById(dialog().getAttribute('aria-labelledby')!)?.textContent).toBe(options.title)
    expect(document.getElementById(dialog().getAttribute('aria-describedby')!)?.textContent).toBe(options.message)
    expect(document.activeElement?.textContent).toBe('继续编辑')
    cancel()
    expect(await result).toBe(false)
    expect(dialog()).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('serializes dialogs and settles queued cancellation without disrupting the active one', async () => {
    const first = confirmDialog({ ...options, title: '第一个' })
    const abort = new AbortController()
    const second = promptDialog({ ...options, title: '第二个', label: '原因', signal: abort.signal })
    const third = confirmDialog({ ...options, title: '第三个' })
    expect(document.querySelectorAll('dialog')).toHaveLength(1)
    abort.abort(); expect(await second).toBeNull()
    expect(dialog().textContent).toContain('第一个')
    accept(); expect(await first).toBe(true)
    expect(dialog().textContent).toContain('第三个')
    cancel(); expect(await third).toBe(false)
    expect(dialog()).toBeNull()
  })

  it('supports signals aborted before enqueue and during an active prompt', async () => {
    const already = new AbortController(); already.abort()
    expect(await confirmDialog({ ...options, signal: already.signal })).toBe(false)
    expect(dialog()).toBeNull()
    const abort = new AbortController()
    const first = promptDialog({ ...options, label: '原因', signal: abort.signal })
    const next = confirmDialog(options)
    abort.abort(); expect(await first).toBeNull()
    expect(dialog()?.dataset.siteDialog).toBe('confirm')
    accept(); expect(await next).toBe(true)
  })

  it.each(['astro:before-swap', 'pagehide'])('settles every active and queued request on %s', async eventName => {
    const first = confirmDialog(options)
    const second = promptDialog({ ...options, label: '原因' })
    const third = alertDialog(options)
    ;(eventName === 'pagehide' ? window : document).dispatchEvent(new Event(eventName))
    expect(await first).toBe(false); expect(await second).toBeNull(); expect(await third).toBeUndefined()
    expect(document.querySelectorAll('dialog')).toHaveLength(0)
    const later = confirmDialog(options); accept(); expect(await later).toBe(true)
  })

  it('focuses prompt input and validates blank or overlong text in the site UI', async () => {
    const completed = vi.fn()
    const result = promptDialog({ ...options, label: '退回原因', maxLength: 8 })
    void result.then(completed)
    const input = dialog().querySelector('input')!
    expect(document.activeElement).toBe(input)
    expect(input.labels?.[0]?.textContent).toBe('退回原因')
    input.value = '   '; accept(); await Promise.resolve()
    expect(completed).not.toHaveBeenCalled()
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(dialog().querySelector('[role=status]')?.textContent).toBe('请填写内容后再确认。')
    expect(document.activeElement).toBe(input)
    input.value = '123456789'; accept(); await Promise.resolve()
    expect(completed).not.toHaveBeenCalled()
    expect(dialog().querySelector('[role=status]')?.textContent).toContain('8')
    input.value = '  修改说明  '; input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(input.hasAttribute('aria-invalid')).toBe(false)
    accept(); expect(await result).toBe('修改说明')
  })

  it('treats title, message, label and button copy as text', async () => {
    const unsafe = '<img src=x onerror=alert(1)><script>bad()</script>'
    const result = promptDialog({ title: unsafe, message: unsafe, label: unsafe, confirmLabel: unsafe })
    expect(dialog().querySelectorAll('img,script')).toHaveLength(0)
    expect(dialog().textContent).toContain(unsafe)
    cancel(); expect(await result).toBeNull()
  })

  it('cancels on Escape and only on a complete outside click, not dialog padding or drag-out', async () => {
    const escape = confirmDialog(options)
    dialog().dispatchEvent(new Event('cancel', { cancelable: true }))
    expect(await escape).toBe(false)
    const result = confirmDialog(options)
    vi.spyOn(dialog(), 'getBoundingClientRect').mockReturnValue({ left: 10, top: 10, right: 110, bottom: 110 } as DOMRect)
    dialog().dispatchEvent(new MouseEvent('pointerdown', { clientX: 20, clientY: 20 }))
    dialog().dispatchEvent(new MouseEvent('click', { clientX: 0, clientY: 0 }))
    expect(dialog()).not.toBeNull()
    dialog().dispatchEvent(new MouseEvent('pointerdown', { clientX: 0, clientY: 0 }))
    dialog().dispatchEvent(new MouseEvent('click', { clientX: 0, clientY: 0 }))
    expect(await result).toBe(false)
  })

  it('settles external close and showModal failures without leaving a pending promise', async () => {
    const result = promptDialog({ ...options, label: '原因' })
    dialog().close(); expect(await result).toBeNull()
    vi.mocked(HTMLDialogElement.prototype.showModal).mockImplementationOnce(() => { throw new Error('not available') })
    expect(await confirmDialog(options)).toBe(false)
    expect(dialog()).toBeNull()
  })

  it('restores the original trigger after queued dialogs and tolerates removed triggers', async () => {
    const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus()
    const first = confirmDialog(options), second = confirmDialog(options)
    accept(); expect(await first).toBe(true)
    cancel(); expect(await second).toBe(false)
    expect(document.activeElement).toBe(trigger)
    const removed = confirmDialog(options); trigger.remove(); cancel()
    expect(await removed).toBe(false)
    expect(dialog()).toBeNull()
  })

  it('keeps explicit choices distinct from cancellation, Escape and abort', async () => {
    const choiceOptions = { ...options, choices: [{ value: 'reuse', label: '继续草稿' }, { value: 'restart', label: '重新开始', danger: true }] }
    const first = chooseDialog(choiceOptions)
    expect(document.activeElement).toBe(dialog().querySelector('[data-site-dialog-cancel]'))
    dialog().querySelector<HTMLButtonElement>('[data-site-dialog-choice=reuse]')!.click()
    expect(await first).toBe('reuse')
    const second = chooseDialog(choiceOptions)
    dialog().querySelector<HTMLButtonElement>('[data-site-dialog-choice=restart]')!.click()
    expect(await second).toBe('restart')
    const third = chooseDialog(choiceOptions); cancel(); expect(await third).toBeNull()
    const fourth = chooseDialog(choiceOptions)
    dialog().dispatchEvent(new Event('cancel', { cancelable: true })); expect(await fourth).toBeNull()
    const abort = new AbortController()
    const fifth = chooseDialog({ ...choiceOptions, signal: abort.signal }); abort.abort(); expect(await fifth).toBeNull()
  })

  it('wraps Tab and Shift+Tab at the current focusable boundaries', async () => {
    const result = promptDialog({ ...options, label: '原因' })
    const input = dialog().querySelector('input')!
    const confirm = dialog().querySelector<HTMLButtonElement>('[data-site-dialog-confirm]')!
    const cancelButton = dialog().querySelector<HTMLButtonElement>('[data-site-dialog-cancel]')!
    const tab = (shiftKey = false) => {
      const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true })
      document.activeElement!.dispatchEvent(event)
      return event
    }
    input.focus(); expect(tab(true).defaultPrevented).toBe(true); expect(document.activeElement).toBe(confirm)
    expect(tab().defaultPrevented).toBe(true); expect(document.activeElement).toBe(input)
    cancelButton.focus(); expect(tab().defaultPrevented).toBe(false)
    // Recompute boundaries: a disabled action must never receive wrapped focus.
    confirm.disabled = true
    input.focus(); expect(tab(true).defaultPrevented).toBe(true); expect(document.activeElement).toBe(cancelButton)
    expect(tab().defaultPrevented).toBe(true); expect(document.activeElement).toBe(input)
    cancel(); expect(await result).toBeNull()
  })
})
