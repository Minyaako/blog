import { DatabaseSync } from 'node:sqlite'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import type { AstroCookies } from 'astro'
import { RankingStore } from '../../src/server/ranking/store'
import { migrateRankingDatabase } from '../../src/server/ranking/migrate'

const state = vi.hoisted(() => ({ store: undefined as RankingStore | undefined }))
vi.mock('../../src/server/ranking/runtime.ts', () => ({
  getRankingStore: () => state.store!,
  rankingOrigin: () => process.env.RANKING_ORIGIN || 'https://gsk.minyako.top',
}))
import { walineServerURL, walineProvider, verifyWalineToken } from '../../src/server/ranking/waline'
import { exchangeWalineSession, readRankingIdentity, requireRankingWrite, logoutRanking, rankingSessionCookieName, rankingWalineCookieName } from '../../src/server/ranking/http'
// Exercise the same cookie serialization used by the pinned Astro adapter.
const { AstroCookies: RuntimeCookies } = await import(new URL('./core/cookies/index.js', import.meta.resolve('astro')).href)

let db: DatabaseSync
const fetchMock = vi.fn<typeof fetch>()
const response = (data: unknown, errno = 0) => new Response(JSON.stringify({ errno, data }), { headers: { 'Content-Type': 'application/json' } })
const profile = (objectId: string | number = 1, display_name = '投稿者', type = 'guest') => ({ objectId, display_name, type, email: 'same@example.com' })
function cookieJar() {
  const values = new Map<string, string>()
  const set = vi.fn((key: string, value: string, _options: unknown) => { values.set(key, value) })
  return { values, set, cookies: { get: (key: string) => values.has(key) ? { value: values.get(key) } : undefined,
    set, delete: (key: string) => values.delete(key) } as unknown as AstroCookies }
}
const request = (body: unknown, csrf?: string, origin = 'https://gsk.minyako.top') => new Request(`${origin}/api/ranking/auth/waline/`, {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) }, body: JSON.stringify(body),
})
beforeEach(() => {
  // Keep HTTPS/security assertions independent of the preview server's runtime env.
  vi.stubEnv('RANKING_ORIGIN', 'https://gsk.minyako.top')
  vi.stubEnv('RANKING_WALINE_URL', 'https://comments.minyako.top')
  vi.stubEnv('RANKING_WRITE_ENABLED', 'true')
  db = new DatabaseSync(':memory:'); migrateRankingDatabase(db); state.store = new RankingStore(db)
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockImplementation(async () => response(profile()))
})
afterEach(() => { db.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetAllMocks() })

describe('trusted Waline verifier', () => {
  it('only contacts the configured endpoint with Bearer and the site Origin, never follows redirects', async () => {
    vi.stubEnv('RANKING_WALINE_URL', 'https://comments.example.com/waline/')
    expect(await verifyWalineToken('opaque-token')).toEqual({ subject: '1', displayName: '投稿者' })
    expect(fetchMock).toHaveBeenCalledWith('https://comments.example.com/waline/api/token', expect.objectContaining({
      headers: { Authorization: 'Bearer opaque-token', Origin: 'https://gsk.minyako.top', Accept: 'application/json' }, redirect: 'error', cache: 'no-store',
    }))
  })
  it('rejects unsafe endpoint configuration and header-sized/invalid tokens before fetching', async () => {
    for (const url of ['http://remote.example', 'https://user:pass@example.com', 'https://example.com/?redirect=other', 'https://example.com/#x', 'http://127.0.0.1:4336']) {
      vi.stubEnv('RANKING_WALINE_URL', url); expect(() => walineServerURL()).toThrow()
    }
    vi.stubEnv('RANKING_ORIGIN', 'http://127.0.0.1:4325'); vi.stubEnv('RANKING_WALINE_URL', 'http://127.0.0.1:4336')
    expect(walineServerURL()).toBe('http://127.0.0.1:4336')
    for (const token of ['', 'a\r\nInjected:x', 'x'.repeat(2049)]) expect(await verifyWalineToken(token)).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('rejects anonymous, expired, banned and unverified profiles', async () => {
    for (const data of [{}, profile(1, '用户', 'banned'), profile(1, '用户', 'verify:pending')]) {
      fetchMock.mockResolvedValueOnce(response(data)); expect(await verifyWalineToken('token')).toBeNull()
    }
    for (const status of [401, 403]) { fetchMock.mockResolvedValueOnce(new Response('', { status })); expect(await verifyWalineToken('token')).toBeNull() }
  })
  it('fails closed on network, redirect, malformed, missing-id and oversized responses', async () => {
    const bad = [new Response('error', { status: 502 }), new Response('', { status: 302 }), new Response('<html>'), response([], 0),
      response({ display_name: '昵称' }), response(profile('', '昵称')), response(profile(1, '')), response(profile(1.5)), response({}, 500), new Response('x'.repeat(32769))]
    for (const value of bad) { fetchMock.mockResolvedValueOnce(value); await expect(verifyWalineToken('token')).rejects.toMatchObject({ status: 503 }) }
    fetchMock.mockRejectedValueOnce(new DOMException('timeout', 'TimeoutError'))
    await expect(verifyWalineToken('token')).rejects.toMatchObject({ status: 503 })
  })
})

describe('Waline to local session bridge', () => {
  it('serializes HTTPS logout deletions that browsers accept for __Host cookies', async () => {
    const cookies = new RuntimeCookies(request({}))
    const identity = await exchangeWalineSession(request({ token: 'one' }), cookies)
    logoutRanking(request({}, identity.csrfToken!), cookies)
    const headers: string[] = [...cookies.headers()]
    expect(headers).toHaveLength(2)
    for (const header of headers) {
      expect(header).toMatch(/^__Host-ranking_(?:session|waline)=/)
      expect(header).toContain('Secure'); expect(header).toContain('HttpOnly')
      expect(header).toContain('Path=/'); expect(header).toContain('Expires=Thu, 01 Jan 1970')
      expect(header).not.toContain('Domain=')
    }
  })
  it('verifies real identity, ignores supplied profiles/roles and sets secure HttpOnly scoped cookies', async () => {
    const jar = cookieJar()
    fetchMock.mockImplementation(async () => response(profile(1, '可信昵称', 'administrator')))
    const identity = await exchangeWalineSession(request({ token: 'waline-token', remember: true, user: { id: 'victim' }, isAdmin: true }), jar.cookies)
    expect(identity.user!.displayName).toBe('可信昵称'); expect(identity.isAdmin).toBe(false)
    expect(state.store!.getIdentityUser(walineProvider(), '1')!.id).toBe(identity.user!.id)
    expect(jar.set).toHaveBeenCalledWith('__Host-ranking_session', expect.any(String), expect.objectContaining({ httpOnly: true, secure: true, sameSite: 'lax', path: '/', expires: expect.any(Date) }))
    expect(jar.set).toHaveBeenCalledWith('__Host-ranking_waline', 'waline-token', expect.objectContaining({ httpOnly: true }))
    const rows = JSON.stringify(db.prepare('SELECT * FROM sessions').all())
    expect(rows).not.toContain('waline-token'); expect(rows).not.toContain(jar.values.get(rankingSessionCookieName()))
  })
  it('reuses stable objectId, not names or emails, and separates Waline instances', async () => {
    const jar = cookieJar()
    const first = await exchangeWalineSession(request({ token: 'one' }), jar.cookies)
    const oldToken = jar.values.get(rankingSessionCookieName())!
    fetchMock.mockImplementation(async () => response(profile('1', '已改名')))
    const same = await exchangeWalineSession(request({ token: 'rotated' }), jar.cookies)
    expect(same.user!.id).toBe(first.user!.id); expect(state.store!.getSession(oldToken)).toBeNull()
    expect(jar.set.mock.calls.at(-1)![2]).not.toHaveProperty('expires')
    fetchMock.mockImplementation(async () => response(profile('2', '已改名')))
    const another = await exchangeWalineSession(request({ token: 'other' }), jar.cookies)
    expect(another.user!.id).not.toBe(same.user!.id)
    vi.stubEnv('RANKING_WALINE_URL', 'https://another.example')
    const otherInstance = await exchangeWalineSession(request({ token: 'other' }), jar.cookies)
    expect(otherInstance.user!.id).not.toBe(another.user!.id)
  })
  it('rejects cross-site exchange without contacting Waline and rejects invalid credentials without creating accounts', async () => {
    const jar = cookieJar()
    await expect(exchangeWalineSession(request({ token: 'token' }, undefined, 'https://attacker.example'), jar.cookies)).rejects.toMatchObject({ status: 403 })
    expect(fetchMock).not.toHaveBeenCalled()
    fetchMock.mockResolvedValueOnce(response({}))
    await expect(exchangeWalineSession(request({ token: 'token' }), jar.cookies)).rejects.toMatchObject({ status: 401 })
    expect(db.prepare('SELECT * FROM users').all()).toHaveLength(0); expect(jar.values.size).toBe(0)
  })
  it('revalidates private reads and writes and rejects a different Waline token beside a valid local cookie', async () => {
    const jar = cookieJar()
    const identity = await exchangeWalineSession(request({ token: 'one' }), jar.cookies)
    expect((await readRankingIdentity(jar.cookies)).user!.id).toBe(identity.user!.id)
    await expect(requireRankingWrite(request({}, 'wrong'), jar.cookies)).rejects.toMatchObject({ status: 403 })
    expect((await requireRankingWrite(request({}, identity.csrfToken!), jar.cookies)).user!.id).toBe(identity.user!.id)
    const local = jar.values.get(rankingSessionCookieName())!
    fetchMock.mockResolvedValueOnce(response(profile('another')))
    expect((await readRankingIdentity(jar.cookies)).user).toBeNull()
    expect(jar.values.size).toBe(0); expect(state.store!.getSession(local)).toBeNull()
  })
  it('does not clear sessions on an outage, but logout still revokes them without calling Waline', async () => {
    const jar = cookieJar(), identity = await exchangeWalineSession(request({ token: 'one' }), jar.cookies)
    const local = jar.values.get(rankingSessionCookieName())!
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    await expect(readRankingIdentity(jar.cookies)).rejects.toMatchObject({ status: 503 })
    expect(jar.values.size).toBe(2); expect(state.store!.getSession(local)).not.toBeNull()
    expect(() => logoutRanking(request({}, 'wrong'), jar.cookies)).toThrow()
    fetchMock.mockClear(); vi.stubEnv('RANKING_WRITE_ENABLED', 'false')
    logoutRanking(request({}, identity.csrfToken!), jar.cookies)
    expect(fetchMock).not.toHaveBeenCalled(); expect(jar.values.size).toBe(0); expect(state.store!.getSession(local)).toBeNull()
  })
  it('requires both cookies and does not call upstream for anonymous or locally expired sessions', async () => {
    const jar = cookieJar()
    expect((await readRankingIdentity(jar.cookies)).user).toBeNull(); expect(fetchMock).not.toHaveBeenCalled()
    const identity = await exchangeWalineSession(request({ token: 'one' }), jar.cookies)
    jar.values.delete(rankingWalineCookieName()); fetchMock.mockClear()
    expect((await readRankingIdentity(jar.cookies)).user).toBeNull(); expect(fetchMock).not.toHaveBeenCalled()
    expect(identity.user).not.toBeNull()
  })
})
