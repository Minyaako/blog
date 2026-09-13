/** Waline's browser credentials are only a transport; the server determines identity. */
export const WALINE_USER_KEY = 'WALINE_USER'
const MAX_USER_BYTES = 16384
export type WalineCredential = { token: string; remember: boolean; profile: Record<string, string | boolean | number> }
export type WalineStorage = Pick<Window, 'localStorage' | 'sessionStorage' | 'dispatchEvent'>
export type WalineStored = { credential: WalineCredential | null; readable: boolean }

export function parseWalineCredential(value: unknown, remember = true): WalineCredential | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const data = value as Record<string, unknown>
  if (typeof data.token !== 'string' || !data.token || data.token.length > 2048 || /[\x00-\x20\x7f]/u.test(data.token)) return null
  const profile: Record<string, string | boolean | number> = { token: data.token }
  for (const key of ['display_name', 'name', 'nick', 'mail', 'email', 'avatar', 'url', 'link', 'label', 'type', 'objectId']) {
    if (typeof data[key] === 'string' && data[key].length <= 2048) profile[key] = data[key]
  }
  if (typeof data.objectId === 'number' && Number.isSafeInteger(data.objectId) && data.objectId >= 0) profile.objectId = data.objectId
  const persist = typeof data.remember === 'boolean' ? data.remember : remember
  profile.remember = persist
  if (JSON.stringify(profile).length > MAX_USER_BYTES) return null
  return { token: data.token, remember: persist, profile }
}

function readStorage(storage: Storage, remember: boolean): WalineCredential | null {
  const raw = storage.getItem(WALINE_USER_KEY)
  if (!raw || raw.length > MAX_USER_BYTES) return null
  try { return parseWalineCredential(JSON.parse(raw), remember) } catch { return null }
}

export function readWalineCredential(host: WalineStorage = window): WalineStored {
  let local: WalineCredential | null = null, temporary: WalineCredential | null = null, readable = true
  try { local = readStorage(host.localStorage, true) } catch { readable = false }
  try { temporary = readStorage(host.sessionStorage, false) } catch { readable = false }
  // Persistent login is what the mounted Waline client observes; otherwise use this tab's login.
  return { credential: local || temporary, readable }
}

function notifyStorage(host: WalineStorage, storage: Storage, oldValue: string | null, newValue: string) {
  host.dispatchEvent(new StorageEvent('storage', { key: WALINE_USER_KEY, oldValue, newValue, storageArea: storage }))
}

export function storeWalineCredential(credential: WalineCredential, host: WalineStorage = window): boolean {
  let saved = true
  const value = JSON.stringify(credential.profile)
  try {
    if (credential.remember) host.sessionStorage.removeItem(WALINE_USER_KEY)
    else host.sessionStorage.setItem(WALINE_USER_KEY, value)
  } catch { saved = false }
  try {
    const local = host.localStorage, oldValue = local.getItem(WALINE_USER_KEY)
    local.setItem(WALINE_USER_KEY, credential.remember ? value : '{}')
    // VueUse reads event.newValue with its persistence watcher paused. The comment UI can
    // therefore see a tab-only login without putting its token in persistent storage.
    notifyStorage(host, local, oldValue, value)
  } catch { saved = false }
  return saved
}

/** Rehydrate Waline's localStorage-backed reactive state after a new comment mount. */
export function restoreWalineTabLogin(host: WalineStorage = window): boolean {
  try {
    const local = host.localStorage
    if (readStorage(local, true)) return true
    const credential = readStorage(host.sessionStorage, false)
    if (credential) notifyStorage(host, local, local.getItem(WALINE_USER_KEY), JSON.stringify(credential.profile))
    return true
  } catch { return false }
}

export function clearWalineCredential(host: WalineStorage = window): boolean {
  let cleared = true
  try { host.sessionStorage.removeItem(WALINE_USER_KEY) } catch { cleared = false }
  try {
    const local = host.localStorage, oldValue = local.getItem(WALINE_USER_KEY)
    local.setItem(WALINE_USER_KEY, '{}')
    notifyStorage(host, local, oldValue, '{}')
  } catch { cleared = false }
  return cleared
}

export async function walineFingerprint(credential: WalineCredential | null): Promise<string | null> {
  if (!credential) return null
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(credential.token))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

/** Reserve synchronously inside the click handler, before awaiting draft persistence. */
export function reserveWalinePopup(): Window | null {
  return window.open('about:blank', '_blank', 'popup=yes,width=720,height=780')
}

export function receiveWalineLogin(popup: Window, serverURL: string, signal: AbortSignal, host: Pick<Window, 'addEventListener' | 'removeEventListener'> = window, timeoutMs = 180000): Promise<WalineCredential> {
  const url = new URL(serverURL)
  url.pathname = `${url.pathname.replace(/\/$/, '')}/ui/login`
  url.search = '?lng=zh-CN'; url.hash = ''
  return new Promise((resolve, reject) => {
    let settled = false
    const cleanup = () => {
      clearInterval(closed); clearTimeout(timeout)
      host.removeEventListener('message', message)
      signal.removeEventListener('abort', abort)
      try { popup.close() } catch { /* The popup may already have closed. */ }
    }
    const fail = (message: string) => { if (!settled) { settled = true; cleanup(); reject(new Error(message)) } }
    const message = (event: MessageEvent) => {
      if (event.origin !== url.origin || event.source !== popup || event.data?.type !== 'userInfo') return
      const credential = parseWalineCredential(event.data.data)
      if (!credential) { fail('登录响应无效，请重新登录。'); return }
      if (!settled) { settled = true; cleanup(); resolve(credential) }
    }
    const abort = () => fail('登录已取消。')
    const closed = setInterval(() => { if (popup.closed) fail('登录窗口已关闭，草稿仍保留。') }, 400)
    const timeout = setTimeout(() => fail('登录等待超时，请重新尝试。'), timeoutMs)
    host.addEventListener('message', message)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) { abort(); return }
    try { popup.location.href = url.href; popup.focus() } catch { fail('无法打开登录窗口，请重试。') }
  })
}
