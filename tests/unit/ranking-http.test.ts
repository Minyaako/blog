import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AstroCookies } from 'astro'
import { RANKING_BODY_LIMIT } from '../../src/lib/ranking'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(), getIdentityUser: vi.fn(), revokeSession: vi.fn(), isAdmin: vi.fn().mockReturnValue(false),
}))
vi.mock('../../src/server/ranking/runtime.ts', () => ({
  getRankingStore: () => mocks,
  rankingOrigin: () => 'https://gsk.minyako.top',
}))
import { readRankingJson, readRankingIdentity, requireRankingWrite, rankingFailure, rankingPage } from '../../src/server/ranking/http'
vi.mock('../../src/server/ranking/waline.ts', () => ({
  validWalineToken: () => true, verifyWalineToken: async () => ({ subject: 'waline-id', displayName: '投稿者' }), walineProvider: () => 'waline:test',
}))

const cookies = { get: () => ({ value: 'opaque-session' }), delete: () => {} } as unknown as AstroCookies
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs() })

describe('ranking HTTP boundary', () => {
  it('does not trust a cookie without an active server session', async () => {
    mocks.getSession.mockReturnValue(null)
    expect((await readRankingIdentity(cookies)).user).toBeNull()
    await expect(requireRankingWrite(new Request('https://gsk.minyako.top/api/ranking/submissions', {
      method: 'POST', headers: { Origin: 'https://gsk.minyako.top' },
    }), cookies)).rejects.toThrow('请先登录')
  })
  it('requires both exact origin and session-bound CSRF for authenticated writes', async () => {
    mocks.getSession.mockReturnValue({ user: { id: 'internal-user', displayName: '投稿者' }, csrfToken: 'expected-token' })
    mocks.getIdentityUser.mockReturnValue({ id: 'internal-user', displayName: '投稿者' })
    const request = (origin: string, csrf: string) => new Request('https://gsk.minyako.top/api/ranking/submissions', {
      method: 'POST', headers: { Origin: origin, 'X-CSRF-Token': csrf },
    })
    await expect(requireRankingWrite(request('https://other.example', 'expected-token'), cookies)).rejects.toThrow('来源')
    await expect(requireRankingWrite(request('https://gsk.minyako.top', 'wrong'), cookies)).rejects.toThrow('状态')
    expect((await requireRankingWrite(request('https://gsk.minyako.top', 'expected-token'), cookies)).user.id).toBe('internal-user')
    vi.stubEnv('RANKING_WRITE_ENABLED', 'false')
    await expect(requireRankingWrite(request('https://gsk.minyako.top', 'expected-token'), cookies)).rejects.toThrow('维护')
  })
  it('caps actual streamed bytes even without content-length', async () => {
    const request = new Request('https://gsk.minyako.top/api/ranking/submissions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ' '.repeat(RANKING_BODY_LIMIT + 1),
    })
    await expect(readRankingJson(request)).rejects.toMatchObject({ status: 413 })
  })
  it('rejects non-JSON and invalid top-level structures', async () => {
    const request = (body: string, type = 'application/json') => new Request('https://gsk.minyako.top/api/ranking/submissions', {
      method: 'POST', headers: { 'Content-Type': type }, body,
    })
    await expect(readRankingJson(request('{}', 'text/plain'))).rejects.toMatchObject({ status: 415 })
    await expect(readRankingJson(request('[]'))).rejects.toMatchObject({ status: 422 })
    await expect(readRankingJson(request('{'))).rejects.toMatchObject({ status: 422 })
    await expect(readRankingJson(request('{"title":"内容"}'))).resolves.toEqual({ title: '内容' })
  })
  it('does not expose internal errors or cache private errors', async () => {
    const response = rankingFailure(new Error('private database path /secret/data'))
    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(await response.text()).not.toContain('/secret')
    expect(() => rankingPage('-1')).toThrow()
    expect(() => rankingPage('NaN')).toThrow()
  })
})
