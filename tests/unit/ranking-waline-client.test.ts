// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { initRanking } from '../../src/scripts/ranking-client'
import { clearWalineCredential, parseWalineCredential, readWalineCredential, receiveWalineLogin, reserveWalinePopup, restoreWalineTabLogin, storeWalineCredential, WALINE_USER_KEY, type WalineStorage } from '../../src/scripts/ranking-waline'

let dispose: (() => void) | undefined
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear()
  vi.stubGlobal('crypto', webcrypto)
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
})
afterEach(() => { dispose?.(); dispose = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); document.body.replaceChildren() })

describe('Waline credential storage', () => {
  it('reuses existing Waline data without trusting its profile, and safely bounds malformed input', () => {
    localStorage.setItem(WALINE_USER_KEY, JSON.stringify({ token: 'existing-token', display_name: 'Comment user', isAdmin: true }))
    expect(readWalineCredential()).toEqual({ readable: true, credential: { token: 'existing-token', remember: true, profile: { token: 'existing-token', display_name: 'Comment user', remember: true } } })
    for (const invalid of [null, [], {}, { token: 'invalid token' }, { token: 'x'.repeat(2049) }]) expect(parseWalineCredential(invalid)).toBeNull()
    localStorage.setItem(WALINE_USER_KEY, '{broken')
    expect(readWalineCredential().credential).toBeNull()
    localStorage.setItem(WALINE_USER_KEY, 'x'.repeat(16385))
    expect(readWalineCredential().credential).toBeNull()
  })

  it('uses tab storage for non-remembered login and notifies mounted Waline after logout', () => {
    const credential = parseWalineCredential({ token: 'temporary-token', remember: false })!
    expect(storeWalineCredential(credential)).toBe(true)
    expect(localStorage.getItem(WALINE_USER_KEY)).toBe('{}')
    expect(readWalineCredential().credential?.token).toBe('temporary-token')
    let stateWhenNotified: ReturnType<typeof readWalineCredential> | undefined
    const listener = (event: StorageEvent) => { if (event.key === WALINE_USER_KEY) stateWhenNotified = readWalineCredential() }
    window.addEventListener('storage', listener)
    expect(clearWalineCredential()).toBe(true)
    window.removeEventListener('storage', listener)
    expect(stateWhenNotified).toEqual({ readable: true, credential: null })
    expect(sessionStorage.getItem(WALINE_USER_KEY)).toBeNull()
  })

  it('distinguishes denied storage from an explicit comment logout, without claiming a saved login', () => {
    const denied = { get localStorage() { throw new Error('denied') }, get sessionStorage() { throw new Error('denied') }, dispatchEvent: vi.fn() } as unknown as WalineStorage
    expect(readWalineCredential(denied)).toEqual({ readable: false, credential: null })
    expect(storeWalineCredential(parseWalineCredential({ token: 'new-token' })!, denied)).toBe(false)
    expect(clearWalineCredential(denied)).toBe(false)
    expect(denied.dispatchEvent).not.toHaveBeenCalled()
  })

  it('rehydrates tab-only login into the mounted comment UI without persisting its token', () => {
    const events: StorageEvent[] = []
    const listener = (event: StorageEvent) => events.push(event)
    window.addEventListener('storage', listener)
    const credential = parseWalineCredential({ token: 'tab-token', remember: false, email: 'user@example.test', objectId: 12 })!
    storeWalineCredential(credential)
    expect(JSON.parse(events.at(-1)!.newValue!)).toMatchObject({ token: 'tab-token', email: 'user@example.test', objectId: 12 })
    restoreWalineTabLogin()
    window.removeEventListener('storage', listener)
    expect(JSON.parse(events.at(-1)!.newValue!).token).toBe('tab-token')
    expect(localStorage.getItem(WALINE_USER_KEY)).toBe('{}')
    expect(readWalineCredential().credential?.remember).toBe(false)
  })
})

describe('Waline popup boundary', () => {
  function popup() { return { location: { href: 'about:blank' }, close: vi.fn(), focus: vi.fn(), closed: false } as unknown as Window }
  function message(source: Window, origin: string, data: unknown = { type: 'userInfo', data: { token: 'verified-token', remember: false } }) {
    window.dispatchEvent(new MessageEvent('message', { source, origin, data }))
  }

  it('reserves the popup synchronously and accepts only the exact popup AND configured origin', async () => {
    const opened = popup(), stranger = popup()
    vi.spyOn(window, 'open').mockReturnValue(opened)
    expect(reserveWalinePopup()).toBe(opened)
    expect(window.open).toHaveBeenCalledWith('about:blank', '_blank', expect.any(String))
    const promise = receiveWalineLogin(opened, 'https://comments.example.test/base/', new AbortController().signal)
    expect(opened.location.href).toBe('https://comments.example.test/base/ui/login?lng=zh-CN')
    const completed = vi.fn(); void promise.then(completed)
    message(opened, 'https://attacker.example.test')
    message(stranger, 'https://comments.example.test')
    await Promise.resolve()
    expect(completed).not.toHaveBeenCalled()
    message(opened, 'https://comments.example.test')
    expect(await promise).toMatchObject({ token: 'verified-token', remember: false })
    expect(opened.close).toHaveBeenCalledOnce()
  })

  it('cancels on disposal and cleans up listeners and timers', async () => {
    vi.useFakeTimers()
    const opened = popup(), abort = new AbortController()
    const promise = receiveWalineLogin(opened, 'https://comments.example.test', abort.signal)
    const rejected = expect(promise).rejects.toThrow('登录已取消')
    abort.abort(); await rejected
    expect(opened.close).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
    message(opened, 'https://comments.example.test')
    expect(opened.close).toHaveBeenCalledOnce()
  })

  it.each(['closed', 'timeout'] as const)('rejects a %s login without retaining a listener', async mode => {
    vi.useFakeTimers()
    const opened = popup()
    const promise = receiveWalineLogin(opened, 'https://comments.example.test', new AbortController().signal, window, 1000)
    const rejected = expect(promise).rejects.toThrow(mode === 'closed' ? '登录窗口已关闭' : '登录等待超时')
    if (mode === 'closed') Object.defineProperty(opened, 'closed', { value: true })
    await vi.advanceTimersByTimeAsync(1000); await rejected
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('ranking identity reconciliation', () => {
  const anonymous = { user: null, csrfToken: null, isAdmin: false, login: { label: '使用 Waline 登录', url: '/api/ranking/auth/waline/', serverURL: 'https://comments.example.test' } }
  const signedIn = (id: string) => ({ ...anonymous, user: { id, displayName: id }, csrfToken: 'csrf-token' })
  function mount() {
    document.body.innerHTML = '<main class="ranking-app"><div data-ranking-account></div></main>'
    dispose = initRanking()
  }

  it('exchanges an existing comment login once; focus checks reuse the session, and switching accounts freezes the old identity', async () => {
    let server: typeof anonymous | ReturnType<typeof signedIn> = anonymous
    const request = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/auth/waline/')) server = signedIn(JSON.parse(String(options?.body)).token === 'token-a' ? 'user-a' : 'user-b')
      return new Response(JSON.stringify({ data: server }), { status: 200 })
    })
    vi.stubGlobal('fetch', request)
    localStorage.setItem(WALINE_USER_KEY, JSON.stringify({ token: 'token-a' }))
    mount()
    await vi.waitFor(() => expect(document.body.textContent).toContain('user-a'))
    const exchanges = () => request.mock.calls.filter(([url]) => url.endsWith('/auth/waline/')).length
    expect(exchanges()).toBe(1)
    const readsBefore = request.mock.calls.length
    window.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(request.mock.calls.length).toBeGreaterThan(readsBefore))
    expect(exchanges()).toBe(1)
    localStorage.setItem(WALINE_USER_KEY, JSON.stringify({ token: 'token-b' }))
    window.dispatchEvent(new StorageEvent('storage', { key: WALINE_USER_KEY }))
    await vi.waitFor(() => expect(document.body.textContent).toContain('旧草稿保留在原身份下'))
    expect(exchanges()).toBe(2)
    expect(document.body.textContent).not.toContain('user-b')
  })

  it('revokes its own session when the shared comment credential is cleared', async () => {
    let server: typeof anonymous | ReturnType<typeof signedIn> = signedIn('user-a')
    const request = vi.fn(async (url: string) => {
      if (url.endsWith('/auth/logout/')) server = anonymous
      return new Response(JSON.stringify({ data: server }), { status: 200 })
    })
    vi.stubGlobal('fetch', request)
    localStorage.setItem(WALINE_USER_KEY, JSON.stringify({ token: 'token-a' }))
    mount()
    await vi.waitFor(() => expect(document.body.textContent).toContain('user-a'))
    clearWalineCredential()
    await vi.waitFor(() => expect(document.body.textContent).toContain('账号已变化'))
    expect(request.mock.calls.filter(([url]) => url.endsWith('/auth/logout/'))).toHaveLength(1)
  })

  it('does not sign out or freeze a valid draft merely because upstream is temporarily unreachable', async () => {
    let fail = false
    const request = vi.fn(async () => {
      if (fail) return new Response(JSON.stringify({ error: 'temporarily unavailable' }), { status: 503 })
      return new Response(JSON.stringify({ data: signedIn('user-a') }), { status: 200 })
    })
    vi.stubGlobal('fetch', request)
    localStorage.setItem(WALINE_USER_KEY, JSON.stringify({ token: 'token-a' }))
    mount()
    await vi.waitFor(() => expect(document.body.textContent).toContain('user-a'))
    fail = true
    const readsBefore = request.mock.calls.length
    window.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(request.mock.calls.length).toBeGreaterThan(readsBefore))
    expect(document.body.textContent).toContain('user-a')
    expect(document.body.textContent).not.toContain('账号已变化')
  })

  it('rechecks the shared identity immediately before a write, without waiting for focus or storage events', async () => {
    let server: typeof anonymous | ReturnType<typeof signedIn> = anonymous
    const request = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/auth/waline/')) server = signedIn(JSON.parse(String(options?.body)).token === 'token-a' ? 'user-a' : 'user-b')
      return new Response(JSON.stringify({ data: server }), { status: 200 })
    })
    vi.stubGlobal('fetch', request)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    localStorage.setItem(WALINE_USER_KEY, JSON.stringify({ token: 'token-a' }))
    mount()
    await vi.waitFor(() => expect(document.body.textContent).toContain('user-a'))
    document.querySelector('.ranking-app')!.insertAdjacentHTML('beforeend', '<button data-ranking-action="withdraw" data-id="submission-1">撤回</button><p data-action-status></p>')
    localStorage.setItem(WALINE_USER_KEY, JSON.stringify({ token: 'token-b' }))
    document.querySelector<HTMLButtonElement>('[data-ranking-action]')!.click()
    await vi.waitFor(() => expect(document.body.textContent).toContain('旧草稿保留在原身份下'))
    expect(request.mock.calls.some(([url]) => url.includes('/withdraw/'))).toBe(false)
  })

  it('keeps a usable login action for an expired stored token and reports blocked popups', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/auth/waline/')
      ? new Response(JSON.stringify({ error: 'expired' }), { status: 401 })
      : new Response(JSON.stringify({ data: anonymous }), { status: 200 })))
    localStorage.setItem(WALINE_USER_KEY, JSON.stringify({ token: 'expired-token' }))
    mount()
    await vi.waitFor(() => expect(document.body.textContent).toContain('评论登录已过期'))
    vi.spyOn(window, 'open').mockReturnValue(null)
    document.querySelector<HTMLButtonElement>('[data-ranking-account] button')!.click()
    expect(document.body.textContent).toContain('请允许登录弹窗后重试')
  })

  it('keeps its verified cookie session when browser storage is denied, instead of treating denial as logout', async () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new DOMException('denied', 'SecurityError') })
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => { throw new DOMException('denied', 'SecurityError') })
    const request = vi.fn(async (_url: string) => new Response(JSON.stringify({ data: signedIn('user-a') }), { status: 200 }))
    vi.stubGlobal('fetch', request)
    mount()
    await vi.waitFor(() => expect(document.body.textContent).toContain('user-a'))
    expect(request.mock.calls.map(args => String(args[0])).every(url => url.endsWith('/auth/session/'))).toBe(true)
  })

  it('never initializes private server-rendered content under a different browser identity', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: signedIn('user-b') }), { status: 200 })))
    localStorage.setItem(WALINE_USER_KEY, JSON.stringify({ token: 'token-b' }))
    // Intentionally invalid editor config: if initialized at all, this private-A payload throws.
    document.body.innerHTML = '<main class="ranking-app" data-ranking-rendered-user="user-a"><nav class="ranking-nav"><span data-ranking-account></span></nav><section data-ranking-editor data-config="not-json">private-A-content</section></main>'
    dispose = initRanking()
    await vi.waitFor(() => expect(document.body.textContent).toContain('请刷新页面重新载入个人内容'))
    expect(document.body.textContent).not.toContain('private-A-content')
    expect(document.querySelector('[data-ranking-editor]')).toBeNull()
  })

  it('conceals previously rendered private content when accounts change after initialization', async () => {
    let server = signedIn('user-a')
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/auth/waline/') && JSON.parse(String(options?.body)).token === 'token-b') server = signedIn('user-b')
      return new Response(JSON.stringify({ data: server }), { status: 200 })
    }))
    localStorage.setItem(WALINE_USER_KEY, JSON.stringify({ token: 'token-a' }))
    document.body.innerHTML = '<main class="ranking-app" data-ranking-rendered-user="user-a"><nav class="ranking-nav"><span data-ranking-account></span></nav><section>private-A-content</section></main>'
    dispose = initRanking()
    await vi.waitFor(() => expect(document.body.textContent).toContain('user-a'))
    localStorage.setItem(WALINE_USER_KEY, JSON.stringify({ token: 'token-b' }))
    window.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(document.body.textContent).toContain('旧草稿保留在原身份下'))
    expect(document.body.textContent).not.toContain('private-A-content')
  })

  it('waits for an in-flight account exchange before logout, using its rotated CSRF token', async () => {
    let server = signedIn('user-a'), release: (() => void) | undefined
    const mutations: string[] = []
    const request = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/auth/waline/')) {
        mutations.push('exchange')
        if (JSON.parse(String(options?.body)).token === 'token-b') {
          await new Promise<void>(resolve => { release = resolve })
          server = { ...signedIn('user-b'), csrfToken: 'new-csrf' }
        }
      }
      if (url.endsWith('/auth/logout/')) {
        mutations.push('logout')
        expect(options?.headers).toMatchObject({ 'X-CSRF-Token': 'new-csrf' })
        // Avoid jsdom's unsupported navigation; the network ordering is what this guards.
        return new Response(JSON.stringify({ error: 'test ends after logout request' }), { status: 503 })
      }
      return new Response(JSON.stringify({ data: server }), { status: 200 })
    })
    vi.stubGlobal('fetch', request)
    localStorage.setItem(WALINE_USER_KEY, JSON.stringify({ token: 'token-a' }))
    mount()
    await vi.waitFor(() => expect(document.body.textContent).toContain('user-a'))
    localStorage.setItem(WALINE_USER_KEY, JSON.stringify({ token: 'token-b' }))
    window.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    document.querySelector<HTMLButtonElement>('[data-ranking-account] button')!.click()
    expect(mutations).toEqual(['exchange', 'exchange'])
    release!()
    await vi.waitFor(() => expect(mutations).toEqual(['exchange', 'exchange', 'logout']))
    window.dispatchEvent(new Event('focus'))
    expect(mutations.at(-1)).toBe('logout')
  })
})
