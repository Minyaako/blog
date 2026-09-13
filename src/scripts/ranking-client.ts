import { RANKING_BODY_LIMIT, rankingCategories, validateSubmissionInput, type RankingPayload, type RankingSource, type RankingSubmission, type RankingUser, type SubmissionInput } from '../lib/ranking'
import { DraftConflict, RankingDraftStore, parseDraftImport, type RankingDraft } from './ranking-draft'
import { rankingSort } from './ranking-sort'
import { clearWalineCredential, readWalineCredential, receiveWalineLogin, reserveWalinePopup, storeWalineCredential, walineFingerprint, WALINE_USER_KEY, type WalineCredential } from './ranking-waline'

type Session = { user: RankingUser | null; csrfToken: string | null; isAdmin: boolean; login: { label: string; url: string; serverURL: string } | null }
type EditorConfig = { payload: RankingPayload; source?: RankingSource; ownerId?: string; current: boolean; start: boolean; resume?: { rankingId: string; baseVersionId?: string; derivedFrom?: RankingSource } }
class RequestError extends Error { constructor(public status: number, message: string) { super(message) } }
const clone = <T>(value: T): T => structuredClone(value)
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; return element }

export function initRanking(): () => void {
  const root = document.querySelector<HTMLElement>('.ranking-app')
  if (!root) return () => {}
  const lifecycle = new AbortController(), signal = lifecycle.signal
  const q = <T extends HTMLElement = HTMLElement>(selector: string) => root.querySelector<T>(selector)
  let session: Session = { user: null, csrfToken: null, isAdmin: false, login: null }
  let editor: ReturnType<typeof createEditor> | undefined
  let sessionKnown = false
  let identityChanged = false, fingerprint: string | null | undefined, explicitLogin = false
  let syncing: Promise<Session> | undefined
  const readSession = async () => {
    const response = await fetch('/api/ranking/auth/session/', { cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) })
    const result = await response.json()
    if (!response.ok) throw new RequestError(response.status, result.error || '登录状态暂时不可用')
    return result.data as Session
  }
  const post = async <T>(url: string, body: unknown, csrfToken?: string): Promise<T> => {
    const timeout = new AbortController()
    const abort = () => timeout.abort()
    signal.addEventListener('abort', abort, { once: true })
    const timer = window.setTimeout(abort, 20000)
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) }, body: JSON.stringify(body), signal: timeout.signal })
      const result = await response.json().catch(() => ({ error: '服务器响应无法确认，请重试查询结果。' }))
      if (!response.ok) throw new RequestError(response.status, result.error || '操作失败，请稍后重试')
      return result.data as T
    } finally { window.clearTimeout(timer); signal.removeEventListener('abort', abort) }
  }
  const exchange = (credential: WalineCredential) => {
    if (!session.login || new URL(session.login.url, location.origin).origin !== location.origin) throw new Error('登录暂不可用')
    return post<Session>(session.login.url, { token: credential.token, remember: credential.remember })
  }
  const syncIdentity = (): Promise<Session> => {
    if (syncing) return syncing
    syncing = (async () => {
      const stored = readWalineCredential(), current = await walineFingerprint(stored.credential)
      let fresh: Session
      if (stored.credential && current !== fingerprint) fresh = await exchange(stored.credential)
      else if (stored.readable && !stored.credential && session.user) {
        // Waline's comment logout only changes browser storage. Revoke our independent session too.
        if (session.csrfToken) await post('/api/ranking/auth/logout/', {}, session.csrfToken)
        fresh = await readSession()
      } else fresh = await readSession()
      fingerprint = current
      return fresh
    })().finally(() => { syncing = undefined })
    return syncing
  }
  const hidePrivateContent = () => {
    if (!root.hasAttribute('data-ranking-rendered-user')) return
    for (const child of Array.from(root.children)) if (!child.matches('.ranking-nav')) child.remove()
  }
  const offerRefresh = () => {
    const refresh = node('button', '刷新页面'); refresh.type = 'button'
    refresh.addEventListener('click', async () => { if (!editor || await editor.beforeLeave()) location.reload() }, { signal })
    q('[data-ranking-account]')!.append(' ', refresh)
  }
  const freezeIdentity = async () => {
    identityChanged = true
    await editor?.suspend()
    hidePrivateContent()
    q('[data-ranking-account]')!.textContent = '账号已变化，旧草稿保留在原身份下。请刷新页面继续；也可先下载草稿。'
    if (root.hasAttribute('data-ranking-rendered-user') && editor?.hasDraft()) {
      const backup = node('button', '下载切换前的本地草稿'); backup.type = 'button'
      backup.addEventListener('click', () => editor?.exportDraft(), { signal })
      q('[data-ranking-account]')!.append(' ', backup)
    }
    offerRefresh()
  }
  const write = async <T>(url: string, body: unknown): Promise<T> => {
    if (identityChanged || explicitLogin) throw new RequestError(401, '请刷新页面后继续；当前草稿仍保留。')
    // Reconcile both Waline's shared browser identity and the server session before every write.
    let fresh: Session
    try { fresh = await syncIdentity() }
    catch (error) { if (error instanceof RequestError && error.status === 401) await freezeIdentity(); throw error }
    if (fresh.user?.id !== session.user?.id || !fresh.user || !fresh.csrfToken) {
      await freezeIdentity()
      throw new RequestError(401, '登录已过期或账号已切换。请先下载草稿，再刷新页面。')
    }
    session = fresh
    return post<T>(url, body, session.csrfToken!)
  }
  const renderAccount = () => {
    const account = q('[data-ranking-account]')!
    account.replaceChildren()
    if (session.user) {
      account.append(document.createTextNode(session.user.displayName + ' '))
      const logout = node('button', '退出')
      logout.type = 'button'
      logout.addEventListener('click', async () => {
        if (explicitLogin) return
        // Serialize with any already-started token exchange so its response cannot log us
        // back in after logout. Block new reconciliation while the draft is being saved.
        explicitLogin = true; logout.disabled = true
        try {
          if (editor && !await editor.beforeLeave()) return
          const reconciled = await syncing?.catch(() => undefined)
          if (reconciled) session = reconciled
          // Do not revalidate upstream here: an expired or unreachable Waline must not prevent logout.
          await post('/api/ranking/auth/logout/', {}, session.csrfToken || undefined)
          if (!clearWalineCredential()) { await freezeIdentity(); account.textContent = '本站已退出，但浏览器阻止了清理评论登录。请清除本站浏览器数据后刷新；草稿仍可下载。'; return }
          location.reload()
        }
        catch (e) { account.append(document.createTextNode(e instanceof Error ? e.message : '退出失败')) }
        finally { explicitLogin = false; logout.disabled = false }
      }, { signal })
      account.append(logout)
    } else if (session.login) {
      account.append(document.createTextNode('访客 · '))
      const login = node('button', session.login.label); login.type = 'button'
      login.addEventListener('click', async () => {
        // Reserve while user activation is live; draft persistence may await IndexedDB.
        const popup = reserveWalinePopup()
        if (!popup) { account.append(document.createTextNode(' 请允许登录弹窗后重试，草稿仍保留。')); return }
        login.disabled = true; explicitLogin = true
        try {
          if (editor && !await editor.beforeLeave()) { popup.close(); return }
          const credential = await receiveWalineLogin(popup, session.login!.serverURL, signal)
          if (editor && !await editor.beforeLeave()) return
          // A focus reconciliation started just before this gesture must finish first.
          await syncing?.catch(() => undefined)
          const fresh = await exchange(credential)
          fingerprint = await walineFingerprint(credential)
          const saved = storeWalineCredential(credential)
          if (!saved) {
            session = fresh; await freezeIdentity()
            account.textContent = '本站登录成功，但浏览器阻止了保存评论登录。当前草稿仍保留，请下载备份后刷新；评论登录不会自动同步。'
            return
          }
          await editor?.flush(); location.reload()
        } catch (e) { if (!signal.aborted) account.append(document.createTextNode(` ${e instanceof Error ? e.message : '登录失败，请重试。'}`)) }
        finally { popup.close(); login.disabled = false; explicitLogin = false }
      }, { signal })
      account.append(login)
    } else account.textContent = '登录暂不可用 · 仍可编辑并下载草稿'
    const admin = q('[data-ranking-admin]'); if (admin) admin.hidden = !session.isAdmin
  }
  const ready = (async () => {
    try { session = await readSession(); session = await syncIdentity(); sessionKnown = true; renderAccount() }
    catch (error) {
      if (signal.aborted) return
      if (error instanceof RequestError && error.status === 401 && session.login) {
        // A stale WALINE_USER must not remove the only way to log in again.
        session = { ...session, user: null, csrfToken: null, isAdmin: false }
        fingerprint = await walineFingerprint(readWalineCredential().credential)
        sessionKnown = true; renderAccount()
        q('[data-ranking-account]')!.append(document.createTextNode(' 评论登录已过期，请重新登录。'))
      } else q('[data-ranking-account]')!.textContent = '登录状态暂不可用 · 仍可编辑并下载草稿'
    }
    if (signal.aborted) return
    // Private SSR HTML belongs to the identity that rendered it, not necessarily the
    // token now found in browser storage. Never mount that payload as a different user's draft.
    if (root.hasAttribute('data-ranking-rendered-user') && (!sessionKnown || root.dataset.rankingRenderedUser !== (session.user?.id || ''))) {
      identityChanged = true
      hidePrivateContent()
      q('[data-ranking-account]')!.textContent = '登录身份已变化或暂时无法确认。请刷新页面重新载入个人内容。'
      offerRefresh()
      return
    }
    const element = q<HTMLElement>('[data-ranking-editor]')
    if (element) editor = createEditor(element, () => session, () => sessionKnown, write, signal)
  })()
  let checkingIdentity = false
  const checkIdentity = async () => {
    await ready
    if (checkingIdentity || !sessionKnown || document.hidden || signal.aborted || explicitLogin || identityChanged) return
    checkingIdentity = true
    try {
      const fresh = await syncIdentity()
      if (fresh.user?.id !== session.user?.id) await freezeIdentity()
      else session = fresh
    } catch (error) {
      if (error instanceof RequestError && error.status === 401) await freezeIdentity()
      // A transient network failure is not evidence that the identity changed.
    }
    finally { checkingIdentity = false }
  }
  window.addEventListener('focus', () => void checkIdentity(), { signal })
  document.addEventListener('visibilitychange', () => void checkIdentity(), { signal })
  window.addEventListener('storage', event => { if (event.key === WALINE_USER_KEY || event.key === null) void checkIdentity() }, { signal })

  root.addEventListener('click', async event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-ranking-action]')
    if (!button || button.disabled) return
    await ready
    const status = q('[data-action-status]')!
    const action = button.dataset.rankingAction!, id = button.dataset.id!
    let path: string, body: object
    if (action === 'withdraw') {
      if (!confirm('撤回这条待审投稿？撤回后可继续修改。')) return
      path = `/api/ranking/submissions/${id}/withdraw/`; body = {}
    } else if (action === 'approve' || action === 'reject') {
      const reason = q<HTMLTextAreaElement>('[data-review-reason]')?.value.trim() || ''
      if (action === 'reject' && !reason) { status.textContent = '请填写退回原因。'; q('[data-review-reason]')?.focus(); return }
      if (action === 'approve' && !confirm('审核通过后将立即公开这份内容。确认发布？')) return
      path = `/api/ranking/manage/submissions/${id}/review/`; body = { decision: action, reason }
    } else {
      const reason = prompt(action === 'hide' ? '填写下架原因（仅管理端记录）：' : '填写恢复原因（仅管理端记录）：')?.trim()
      if (!reason) return
      path = `/api/ranking/manage/rankings/${id}/visibility/`; body = { hidden: action === 'hide', reason }
    }
    button.disabled = true; status.textContent = '正在处理…'
    try { await write(path, body); location.reload() }
    catch (e) { status.textContent = e instanceof Error ? e.message : '操作失败，请重试。'; button.disabled = false }
  }, { signal })

  // Intercept links before Astro's router; a real navigation starts only after the draft transaction.
  document.addEventListener('click', async event => {
    const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]')
    if (!editor || !anchor || anchor.target === '_blank' || anchor.hasAttribute('download') || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0 || anchor.hash && anchor.pathname === location.pathname) return
    event.preventDefault(); event.stopImmediatePropagation()
    if (await editor.beforeLeave()) location.assign(anchor.href)
  }, { capture: true, signal })
  document.addEventListener('astro:before-preparation', (event: Event) => {
    const navigation = event as Event & { loader?: () => Promise<unknown> }
    if (!editor || !navigation.loader) return
    const loader = navigation.loader
    navigation.loader = async () => { await editor?.flush(); return loader() }
  }, { signal })
  window.addEventListener('beforeunload', event => { if (editor?.hasUnsaved()) event.preventDefault() }, { signal })
  return () => { void editor?.flush(); lifecycle.abort() }
}

function createEditor(root: HTMLElement, getSession: () => Session, sessionKnown: () => boolean, write: <T>(url: string, body: unknown) => Promise<T>, signal: AbortSignal) {
  const config = JSON.parse(root.dataset.config!) as EditorConfig
  const q = <T extends HTMLElement = HTMLElement>(selector: string) => root.querySelector<T>(selector)!
  const list = q('[data-ranking-items]'), status = q('[data-editor-status]'), saveStatus = q('[data-save-status]')
  const dialog = q<HTMLDialogElement>('[data-preview-dialog]')
  const owner = sessionKnown() ? getSession().user?.id || 'anonymous' : `unverified-${crypto.randomUUID()}`
  const storage = new RankingDraftStore()
  let draft: RankingDraft | undefined, existing: RankingDraft | undefined, editing = false, starting = false, suspended = false
  let revision = 0, slotId: string | undefined, dirty = false, unavailable = !sessionKnown(), conflict = false, saving: Promise<void> = Promise.resolve(), timer = 0, sending = false
  let preview: SubmissionInput | undefined
  const announce = (message: string) => { status.textContent = message }
  const saveMessage = () => { saveStatus.textContent = conflict ? '自动保存已暂停：其他标签页已更新' : unavailable ? '当前草稿无法自动保存，请下载备份' : dirty ? '正在保存…' : '已保存到此浏览器' }
  const load = (async () => {
    if (unavailable) return
    try {
      existing = await storage.read(owner); revision = existing?.revision ?? 0; slotId = existing?.draftId
      if (!existing && owner !== 'anonymous') {
        const anonymous = await storage.read('anonymous')
        if (anonymous && confirm('发现此浏览器的匿名草稿。要将它归入当前账号吗？')) {
          existing = { ...anonymous, owner, revision: 0 }; revision = await storage.write(existing, 0, undefined); existing.revision = revision; slotId = existing.draftId
          // Copy completed before deleting the anonymous slot; failure preserves both copies.
          await storage.remove('anonymous', anonymous.revision, anonymous.draftId)
        }
      }
    } catch (e) { unavailable = true; announce(e instanceof Error ? e.message : '草稿无法自动保存，请下载备份。') }
  })()
  const flush = async () => {
    clearTimeout(timer)
    saving = saving.then(async () => {
      if (!draft || !dirty || unavailable || conflict) { saveMessage(); return }
      const snapshot = clone(draft)
      try {
        revision = await storage.write(snapshot, revision, slotId); slotId = snapshot.draftId
        snapshot.revision = revision; existing = snapshot
        if (draft.draftId === snapshot.draftId) { draft.revision = revision; if (draft.contentRevision === snapshot.contentRevision && JSON.stringify(draft.pending) === JSON.stringify(snapshot.pending) && JSON.stringify(draft.submitted) === JSON.stringify(snapshot.submitted)) dirty = false }
      } catch (e) { if (e instanceof DraftConflict) conflict = true; else unavailable = true; announce(e instanceof Error ? e.message : '草稿无法保存，请下载备份。') }
      saveMessage()
    })
    await saving
  }
  const changed = (immediate = false) => {
    if (!draft) return
    draft.contentRevision++; draft.updatedAt = new Date().toISOString(); dirty = true; preview = undefined
    saveMessage(); clearTimeout(timer)
    if (immediate) void flush(); else timer = window.setTimeout(() => void flush(), 350)
  }
  const submissionResult = () => {
    const result = q('[data-submission-result]'), button = q<HTMLButtonElement>('[data-preview]')
    result.replaceChildren(); button.disabled = suspended || sending || !!draft?.submitted
    button.textContent = draft?.pending ? '重试确认上次投稿' : '预览并提交'
    if (draft?.pending) result.textContent = '上次投稿结果尚未确认。重试会发送原内容；此后的编辑会继续保存在本地。'
    if (draft?.submitted) {
      const link = node('a', '查看投稿，撤回后继续修改 →'); link.href = `/ranking/submissions/${draft.submitted.id}/`; link.dataset.astroReload = ''
      result.append(document.createTextNode('已提交审核。当前本地编辑仍保留。 '), link)
    }
  }
  const syncFields = () => {
    const payload = editing && draft ? draft.payload : config.payload
    for (const name of ['title', 'description', 'categoryId', 'changeNote'] as const) q<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[name=${name}]`).value = payload[name] || ''
  }
  const renderRows = () => {
    const payload = editing && draft ? draft.payload : config.payload
    list.replaceChildren()
    payload.items.forEach((item, index) => {
      const row = node('li'); row.className = 'ranking-row'; row.dataset.itemId = item.itemId
      const number = node('span', String(index + 1).padStart(2, '0')); number.className = 'ranking-number'; number.setAttribute('aria-hidden', 'true')
      const copy = node('div'); copy.className = 'ranking-item-copy'
      if (editing) {
        for (const [key, title] of [['name', '条目名称'], ['note', '说明（选填）']] as const) {
          const label = node('label', title), input = key === 'name' ? node('input') : node('textarea')
          input.value = item[key] || ''; input.dataset.itemField = key; input.setAttribute('maxlength', key === 'name' ? '240' : '1000')
          if (input instanceof HTMLTextAreaElement) input.rows = 2
          label.append(input); copy.append(label)
        }
      } else { copy.append(node('strong', item.name)); if (item.note) copy.append(node('p', item.note)) }
      const actions = node('div'); actions.className = 'ranking-row-actions ranking-js'
      for (const [action, text, label] of [['up', '↑', '上移'], ['down', '↓', '下移'], ['handle', '⠿', '排序'], ...(editing ? [['remove', '×', '移除']] : [])]) {
        const button = node('button', text); button.type = 'button'; button.setAttribute('aria-label', `${label} ${item.name || '未命名条目'}`)
        if (action === 'handle') { button.dataset.handle = ''; button.className = 'ranking-handle'; button.title = '拖动排序；空格抓取，方向键移动，Escape 取消' }
        else if (action === 'remove') button.dataset.remove = ''
        else { button.dataset.move = action; button.disabled = action === 'up' ? index === 0 : index === payload.items.length - 1 }
        actions.append(button)
      }
      row.append(number, copy, actions); list.append(row)
    })
  }
  const renderMode = () => {
    root.querySelectorAll<HTMLElement>('.ranking-edit-only').forEach(section => section.hidden = !editing)
    q('[data-read-actions]').hidden = editing
    q('[data-draft-intent]').textContent = draft?.intent === 'update' ? '正在更新自己的榜单' : '正在编辑个人草稿'
    syncFields(); renderRows(); submissionResult(); saveMessage()
  }
  const begin = async (intent: 'derive' | 'update' = 'derive'): Promise<boolean> => {
    if (suspended) return false
    if (editing) return true
    if (starting) return false
    starting = true
    try {
      await load
      if (signal.aborted || suspended) return false
      if (draft) existing = draft
      let reuse = false
      if (existing) {
        reuse = confirm('此浏览器已有一份草稿。确定：继续这份草稿；取消：选择重新开始。')
        if (!reuse && existing.pending) { announce('请先继续草稿，确认上次投稿结果，再新建。'); return false }
        if (!reuse && !confirm('重新开始会替换此账号的活动草稿。确认已下载或不再需要原草稿？')) return false
      }
      if (reuse && existing) {
        draft = clone(existing)
        // A terminal submission page is server-authorized to resume this same target.
        if (config.resume?.rankingId === draft.rankingId && draft.submitted && !draft.pending) { delete draft.submitted; dirty = true }
      }
      else {
        if (intent === 'update' && (!config.current || config.ownerId !== getSession().user?.id)) { announce('仅作者可从当前公开版本更新原榜。'); return false }
        const target: { rankingId?: string; baseVersionId?: string; derivedFrom?: RankingSource } = config.resume || (intent === 'update' && config.source ? { rankingId: config.source.rankingId, baseVersionId: config.source.versionId } : config.source ? { derivedFrom: config.source } : {})
        draft = { schemaVersion: 1, draftId: crypto.randomUUID(), owner, intent: target.baseVersionId ? 'update' : target.derivedFrom ? 'derive' : 'create', ...target, payload: clone(config.payload), revision, contentRevision: 0, updatedAt: new Date().toISOString() }
        if (!draft.payload.items.length) draft.payload.items.push({ itemId: crypto.randomUUID(), name: '' })
        dirty = true
      }
      editing = true; renderMode(); await flush()
      return true
    } finally { starting = false }
  }
  const order = () => (draft?.payload.items || config.payload.items).map(item => item.itemId)
  const reorderDom = () => {
    if (!draft) return
    const rows = new Map(Array.from(list.querySelectorAll<HTMLElement>('[data-item-id]')).map(row => [row.dataset.itemId, row]))
    draft.payload.items.forEach((item, index) => {
      const row = rows.get(item.itemId)
      if (row) { list.append(row); row.querySelector('.ranking-number')!.textContent = String(index + 1).padStart(2, '0'); row.querySelector<HTMLButtonElement>('[data-move=up]')!.disabled = index === 0; row.querySelector<HTMLButtonElement>('[data-move=down]')!.disabled = index === draft!.payload.items.length - 1 }
    })
  }
  const move = (id: string, index: number) => {
    if (!draft) return
    const oldIndex = draft.payload.items.findIndex(item => item.itemId === id)
    if (oldIndex < 0 || index === oldIndex) return
    const [item] = draft.payload.items.splice(oldIndex, 1); draft.payload.items.splice(index, 0, item); reorderDom()
  }
  const sort = rankingSort(list, { begin: async () => { const accepted = await begin(); await flush(); return accepted }, order, move,
    restore: ids => { if (!draft) return; const items = new Map(draft.payload.items.map(item => [item.itemId, item])); draft.payload.items = ids.map(id => items.get(id)!).filter(Boolean); reorderDom() },
    commit: () => changed(true), announce, signal })

  root.addEventListener('input', event => {
    if (suspended || !editing || !draft) return
    sort.cancel()
    const input = event.target as HTMLInputElement
    if (input.dataset.itemField) {
      const item = draft.payload.items.find(item => item.itemId === input.closest<HTMLElement>('[data-item-id]')?.dataset.itemId)
      if (item) item[input.dataset.itemField as 'name' | 'note'] = input.value
    } else if (['title', 'description', 'categoryId', 'changeNote'].includes(input.name)) (draft.payload as unknown as Record<string, unknown>)[input.name] = input.value
    else return
    changed()
  }, { signal })
  root.addEventListener('click', async event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button')
    if (!button) return
    if (suspended && !button.hasAttribute('data-export')) return
    if (button.dataset.edit) { await begin(button.dataset.edit as 'derive' | 'update'); return }
    if (button.hasAttribute('data-return')) { sort.cancel(); await flush(); editing = false; renderMode(); announce('已返回原榜。个人草稿仍保留。'); return }
    if (button.dataset.move) {
      const id = button.closest<HTMLElement>('[data-item-id]')?.dataset.itemId
      if (!id) return
      sort.cancel()
      if (!await begin() || !draft) return
      const index = draft.payload.items.findIndex(item => item.itemId === id)
      if (index < 0) return
      const next = Math.max(0, Math.min(draft.payload.items.length - 1, index + (button.dataset.move === 'up' ? -1 : 1)))
      move(id, next); changed(true); announce(`已移至第 ${next + 1} 名。`)
      list.querySelector<HTMLElement>(`[data-item-id="${id}"] [data-handle]`)?.focus({ preventScroll: true }); return
    }
    if (!draft) return
    if (button.hasAttribute('data-add')) { sort.cancel(); if (draft.payload.items.length >= 100) { announce('最多添加 100 个条目。'); return } draft.payload.items.push({ itemId: crypto.randomUUID(), name: '' }); renderRows(); changed(true); list.lastElementChild?.querySelector('input')?.focus(); return }
    if (button.hasAttribute('data-remove')) { sort.cancel(); const id = button.closest<HTMLElement>('[data-item-id]')?.dataset.itemId; draft.payload.items = draft.payload.items.filter(item => item.itemId !== id); renderRows(); changed(true); announce('已移除条目。'); return }
    if (button.hasAttribute('data-export')) { exportDraft(); return }
    if (button.hasAttribute('data-discard')) {
      if (draft.pending) { announce('请先确认上次投稿结果，或下载草稿留存，不能丢弃未确认请求。'); return }
      if (!confirm('确认丢弃这份本地草稿？已经提交的投稿不受影响。')) return
      sort.cancel(); await flush()
      if (conflict) { announce('请刷新载入另一标签页的草稿后再决定是否丢弃。'); return }
      try { if (!unavailable) await storage.remove(owner, revision, slotId) } catch (e) { announce(e instanceof Error ? e.message : '丢弃失败'); return }
      draft = existing = undefined; revision = 0; slotId = undefined; dirty = false; editing = false; renderMode(); announce('已丢弃本地草稿。'); return
    }
    if (button.hasAttribute('data-close-preview')) { dialog.close(); return }
    if (button.hasAttribute('data-preview')) {
      if (sending) return
      sort.cancel(); await flush()
      if (conflict) { announce('草稿有多标签冲突，请先下载当前内容，再刷新。'); return }
      if (draft.pending) { await submit(draft.pending.request); return }
      try {
        preview = validateSubmissionInput({ requestId: crypto.randomUUID(), rankingId: draft.rankingId, baseVersionId: draft.baseVersionId, derivedFrom: draft.derivedFrom, payload: draft.payload })
        if (new Blob([JSON.stringify(preview)]).size > RANKING_BODY_LIMIT) throw new Error('投稿内容过大，请缩短后重试。')
        const content = q('[data-preview-content]'); content.replaceChildren(node('h3', preview.payload.title), node('p', preview.payload.description), node('p', rankingCategories.find(c => c.id === preview!.payload.categoryId)?.name || ''))
        const items = node('ol'); for (const item of preview.payload.items) { const row = node('li'); row.append(node('strong', item.name)); if (item.note) row.append(node('p', item.note)); items.append(row) } content.append(items)
        dialog.showModal()
      } catch (e) { announce(e instanceof Error ? e.message : '请检查表单内容。') }
    }
    if (button.hasAttribute('data-submit') && preview) { dialog.close(); await submit(preview) }
  }, { signal })
  const submit = async (request: SubmissionInput) => {
    if (suspended || !draft || sending) return
    if (!getSession().user) { announce(getSession().login ? '请先登录，草稿已保留。登录入口在页面顶部。' : '登录暂不可用，内容已保留；可以先下载草稿。'); return }
    sending = true
    if (!draft.pending) { draft.pending = { request: clone(request), contentRevision: draft.contentRevision }; dirty = true }
    const snapshot = clone(draft.pending)
    await flush(); submissionResult()
    if (conflict) { sending = false; submissionResult(); return }
    announce('正在提交，请稍候…')
    try {
      const result = await write<RankingSubmission>('/api/ranking/submissions/', snapshot.request)
      if (!result?.id || !result.rankingId) throw new Error('服务器响应无法确认，请重试确认原投稿。')
      draft.rankingId = result.rankingId
      draft.submitted = { id: result.id, rankingId: result.rankingId, contentRevision: snapshot.contentRevision }
      delete draft.pending; dirty = true; await flush()
      announce('投稿已收到，通过审核后公开。提交期间的其他编辑仍保留在草稿里。')
    } catch (e) {
      if (e instanceof RequestError && e.status >= 400 && e.status < 500 && ![401, 403, 429].includes(e.status)) { delete draft.pending; dirty = true; await flush() }
      announce(e instanceof Error ? e.message : '网络中断，结果尚未确认。请重试原投稿。')
    } finally { sending = false; submissionResult() }
  }
  const exportDraft = () => {
    if (!draft) return
    const exported = !sessionKnown() && !draft.pending && !draft.submitted ? { ...draft, owner: 'anonymous' } : draft
    const blob = new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' }), url = URL.createObjectURL(blob)
    const anchor = node('a'); anchor.href = url; anchor.download = `ranking-draft-${draft.draftId}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  q<HTMLInputElement>('[data-import]').addEventListener('change', async event => {
    const input = event.target as HTMLInputElement, file = input.files?.[0]
    if (suspended) return
    if (!file) return
    try {
      if (file.size > RANKING_BODY_LIMIT * 3) throw new Error('草稿文件过大')
      if (draft?.pending) throw new Error('请先确认上次投稿结果，再恢复其他草稿。')
      const imported = parseDraftImport(JSON.parse(await file.text()), owner)
      if (suspended) return
      // Imported content is a new local incarnation; keep only server request IDs stable.
      imported.draftId = crypto.randomUUID()
      if (!confirm('恢复文件会替换当前本地草稿，确认继续？')) return
      sort.cancel(); await flush()
      if (conflict) throw new Error('存在多标签保存冲突，请刷新后恢复。')
      draft = imported; draft.revision = revision; dirty = true; editing = true; renderMode(); await flush(); announce('草稿已恢复。')
    } catch (e) { announce(e instanceof Error ? e.message : '无法恢复这个草稿文件。') }
    finally { input.value = '' }
  }, { signal })
  const update = q('[data-edit=update]')
  update.hidden = !(config.current && config.ownerId === getSession().user?.id)
  if (config.start) void begin()
  return {
    flush,
    exportDraft,
    hasDraft: () => !!draft,
    suspend: async () => {
      suspended = true; sort.cancel(); dialog.close()
      root.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement | HTMLSelectElement>('input, button, textarea, select').forEach(control => { if (!control.hasAttribute('data-export')) control.disabled = true })
      await flush(); announce('账号已变化，编辑已暂停。草稿保留在原身份下，可下载备份后刷新。')
    },
    hasUnsaved: () => !!draft && (dirty || unavailable || conflict || sending),
    beforeLeave: async () => {
      sort.cancel(); await flush()
      if (draft && (unavailable || conflict || dirty) && !confirm('当前草稿尚未安全保存。建议取消并先下载草稿；仍要离开吗？')) return false
      return true
    },
  }
}
