import '../styles/site-dialog.css'

export interface DialogOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  signal?: AbortSignal
}
export interface PromptDialogOptions extends DialogOptions { label: string; maxLength?: number }
export interface ChoiceDialogOptions extends DialogOptions { choices: Array<{ value: string; label: string; danger?: boolean }> }
type Result = boolean | string | null
type Task = {
  kind: 'confirm' | 'prompt' | 'alert' | 'choose'
  options: DialogOptions | PromptDialogOptions | ChoiceDialogOptions
  returnFocus: HTMLElement | null
  resolve: (value: Result) => void
  abort: () => void
  settled: boolean
}
type ActiveDialog = { task: Task; element: HTMLDialogElement; finish: (value: Result, restoreFocus?: boolean) => void }

const queue: Task[] = []
let active: ActiveDialog | null = null
let bound = false
let cancelling = false
let sequence = 0

function cancelled(task: Task): Result { return task.kind === 'prompt' || task.kind === 'choose' ? null : false }
function resolveTask(task: Task, value: Result) {
  if (task.settled) return
  task.settled = true
  task.options.signal?.removeEventListener('abort', task.abort)
  task.resolve(value)
}
function cancelAll() {
  // Empty the queue before closing the active modal, so close cannot reveal the next one.
  cancelling = true
  for (const task of queue.splice(0)) resolveTask(task, cancelled(task))
  if (active) active.finish(cancelled(active.task), false)
  for (const task of queue.splice(0)) resolveTask(task, cancelled(task))
  cancelling = false
}
function bindNavigation() {
  if (bound) return
  bound = true
  document.addEventListener('astro:before-swap', cancelAll)
  window.addEventListener('pagehide', cancelAll)
}
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (text !== undefined) node.textContent = text
  return node
}
function showNext() {
  if (active || cancelling) return
  const task = queue.shift()
  if (!task) return
  if (task.options.signal?.aborted) { resolveTask(task, cancelled(task)); showNext(); return }

  const { options } = task
  const dialog = element('dialog')
  const id = `site-dialog-${++sequence}`
  dialog.className = 'site-dialog'
  dialog.dataset.siteDialog = task.kind
  if (options.danger) dialog.dataset.danger = 'true'
  dialog.setAttribute('aria-labelledby', `${id}-title`)
  dialog.setAttribute('aria-describedby', `${id}-message`)
  const form = element('form')
  form.noValidate = true
  const title = element('h2', options.title); title.id = `${id}-title`
  const message = element('p', options.message); message.id = `${id}-message`; message.className = 'site-dialog-message'
  form.append(title, message)

  let input: HTMLInputElement | undefined
  let error: HTMLParagraphElement | undefined
  if (task.kind === 'prompt') {
    const prompt = options as PromptDialogOptions
    const label = element('label', prompt.label); label.htmlFor = `${id}-input`
    input = element('input'); input.id = `${id}-input`; input.type = 'text'; input.autocomplete = 'off'
    if (Number.isSafeInteger(prompt.maxLength) && prompt.maxLength! > 0) input.maxLength = prompt.maxLength!
    error = element('p'); error.id = `${id}-error`; error.className = 'site-dialog-error'; error.hidden = true
    error.setAttribute('role', 'status'); error.setAttribute('aria-live', 'polite')
    input.setAttribute('aria-describedby', `${id}-error`)
    form.append(label, input, error)
  }
  const actions = element('div'); actions.className = 'site-dialog-actions'
  const cancel = element('button', options.cancelLabel || '取消'); cancel.type = 'button'; cancel.dataset.siteDialogCancel = ''
  const confirm = element('button', options.confirmLabel || (task.kind === 'alert' ? '知道了' : '确认'))
  confirm.type = 'submit'; confirm.className = 'site-dialog-confirm'; confirm.dataset.siteDialogConfirm = ''
  if (task.kind !== 'alert') actions.append(cancel)
  const choiceButtons: Array<{ button: HTMLButtonElement; value: string }> = []
  if (task.kind === 'choose') {
    for (const choice of (options as ChoiceDialogOptions).choices) {
      const button = element('button', choice.label); button.type = 'button'; button.dataset.siteDialogChoice = choice.value
      if (choice.danger) button.dataset.danger = 'true'
      choiceButtons.push({ button, value: choice.value }); actions.append(button)
    }
  } else actions.append(confirm)
  form.append(actions); dialog.append(form)

  const listeners = new AbortController()
  const finish = (value: Result, restoreFocus = true) => {
    if (task.settled) return
    listeners.abort()
    if (active?.task === task) active = null
    try { if (dialog.open) dialog.close() } catch { /* Removal still releases the modal when close is unavailable. */ }
    dialog.remove()
    try { if (restoreFocus && task.returnFocus?.isConnected) task.returnFocus.focus({ preventScroll: true }) } catch { /* A disappearing trigger must not strand the request. */ }
    resolveTask(task, value)
    showNext()
  }
  active = { task, element: dialog, finish }
  const listenerOptions = { signal: listeners.signal }
  cancel.addEventListener('click', () => finish(cancelled(task)), listenerOptions)
  for (const choice of choiceButtons) choice.button.addEventListener('click', () => finish(choice.value), listenerOptions)
  dialog.addEventListener('cancel', event => { event.preventDefault(); finish(cancelled(task)) }, listenerOptions)
  dialog.addEventListener('close', () => finish(cancelled(task)), listenerOptions)
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Tab' || event.ctrlKey || event.metaKey || event.altKey) return
    const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]')).filter(control => {
      const style = getComputedStyle(control)
      return control.tabIndex >= 0 && !control.matches(':disabled') && !control.closest('[hidden], [inert]') && style.display !== 'none' && style.visibility !== 'hidden'
    })
    const first = controls[0], last = controls.at(-1)
    if (!first || !last) { event.preventDefault(); dialog.tabIndex = -1; dialog.focus(); return }
    const focused = document.activeElement
    if (event.shiftKey && (focused === first || !controls.includes(focused as HTMLElement))) {
      event.preventDefault(); last.focus()
    } else if (!event.shiftKey && (focused === last || !controls.includes(focused as HTMLElement))) {
      event.preventDefault(); first.focus()
    }
  }, listenerOptions)
  let outsideDown = false
  const outside = (event: MouseEvent) => {
    const rect = dialog.getBoundingClientRect()
    return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom
  }
  dialog.addEventListener('pointerdown', event => { outsideDown = event.target === dialog && outside(event) }, listenerOptions)
  dialog.addEventListener('click', event => {
    if (outsideDown && event.target === dialog && outside(event)) finish(cancelled(task))
    outsideDown = false
  }, listenerOptions)
  form.addEventListener('submit', event => {
    event.preventDefault()
    if (task.kind === 'choose') return
    if (!input) { finish(true); return }
    const value = input.value.trim()
    const maxLength = (options as PromptDialogOptions).maxLength
    if (!value || (maxLength && value.length > maxLength)) {
      error!.textContent = !value ? '请填写内容后再确认。' : `内容不能超过 ${maxLength} 个字符。`
      error!.hidden = false; input.setAttribute('aria-invalid', 'true'); input.focus(); return
    }
    finish(value)
  }, listenerOptions)
  input?.addEventListener('input', () => { error!.hidden = true; input!.removeAttribute('aria-invalid') }, listenerOptions)

  document.body.append(dialog)
  try {
    dialog.showModal()
    ;(input || (task.kind === 'choose' || options.danger && task.kind !== 'alert' ? cancel : confirm)).focus({ preventScroll: true })
  } catch { finish(cancelled(task)) }
}

function request(kind: Task['kind'], options: DialogOptions | PromptDialogOptions | ChoiceDialogOptions): Promise<Result> {
  if (typeof document === 'undefined' || !document.body || options.signal?.aborted) return Promise.resolve(kind === 'prompt' || kind === 'choose' ? null : false)
  bindNavigation()
  return new Promise(resolve => {
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const task: Task = {
      kind, options: { ...options }, returnFocus: active?.element.contains(focused) ? active.task.returnFocus : focused,
      resolve, settled: false, abort: () => {
        if (active?.task === task) active.finish(cancelled(task))
        else { const index = queue.indexOf(task); if (index >= 0) queue.splice(index, 1); resolveTask(task, cancelled(task)) }
      },
    }
    options.signal?.addEventListener('abort', task.abort, { once: true })
    queue.push(task)
    showNext()
  })
}

export async function confirmDialog(options: DialogOptions): Promise<boolean> { return await request('confirm', options) === true }
export async function promptDialog(options: PromptDialogOptions): Promise<string | null> {
  const value = await request('prompt', options)
  return typeof value === 'string' ? value : null
}
export async function alertDialog(options: DialogOptions): Promise<void> { await request('alert', options) }
export async function chooseDialog(options: ChoiceDialogOptions): Promise<string | null> {
  const value = await request('choose', { ...options, choices: options.choices.map(choice => ({ ...choice })) })
  return typeof value === 'string' ? value : null
}
