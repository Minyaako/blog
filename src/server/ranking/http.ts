import { timingSafeEqual } from 'node:crypto'
import type { AstroCookies } from 'astro'
import { RankingError, RANKING_BODY_LIMIT, type RankingUser } from '../../lib/ranking.ts'
import { getRankingStore, rankingOrigin } from './runtime.ts'
import { validWalineToken, verifyWalineToken, walineProvider, walineServerURL } from './waline.ts'

export interface RankingIdentity { user: RankingUser | null; csrfToken: string | null; isAdmin: boolean }
export function rankingSessionCookieName(): string {
  return rankingOrigin().startsWith('https:') ? '__Host-ranking_session' : 'ranking_session'
}
export const rankingWalineCookieName = () => rankingOrigin().startsWith('https:') ? '__Host-ranking_waline' : 'ranking_waline'
export const rankingLogin = () => ({ label: '使用 Waline 登录', url: '/api/ranking/auth/waline/', serverURL: walineServerURL() })
const anonymous = (): RankingIdentity => ({ user: null, csrfToken: null, isAdmin: false })
export function clearRankingSession(cookies: AstroCookies): void {
  const token = cookies.get(rankingSessionCookieName())?.value
  if (token && token.length <= 256) getRankingStore().revokeSession(token)
  const options = { path: '/', secure: rankingOrigin().startsWith('https:'), httpOnly: true, sameSite: 'lax' as const }
  cookies.delete(rankingSessionCookieName(), options)
  cookies.delete(rankingWalineCookieName(), options)
}
export async function readRankingIdentity(cookies: AstroCookies): Promise<RankingIdentity> {
  const token = cookies.get(rankingSessionCookieName())?.value
  if (!token || token.length > 256) return anonymous()
  const store = getRankingStore()
  const session = store.getSession(token)
  const upstreamToken = cookies.get(rankingWalineCookieName())?.value
  if (!session || !validWalineToken(upstreamToken)) { clearRankingSession(cookies); return anonymous() }
  const upstream = await verifyWalineToken(upstreamToken)
  const mapped = upstream ? store.getIdentityUser(walineProvider(), upstream.subject) : null
  if (!mapped || mapped.id !== session.user.id) { clearRankingSession(cookies); return anonymous() }
  return { user: { id: mapped.id, displayName: upstream!.displayName }, csrfToken: session.csrfToken, isAdmin: store.isAdmin(mapped.id) }
}
export async function requireRankingUser(cookies: AstroCookies): Promise<RankingIdentity & { user: RankingUser }> {
  const identity = await readRankingIdentity(cookies)
  if (!identity.user) throw new RankingError(401, '请先登录再继续')
  return identity as RankingIdentity & { user: RankingUser }
}
export function requireRankingOrigin(request: Request): void {
  if (request.headers.get('origin') !== rankingOrigin()) throw new RankingError(403, '请求来源无效，请刷新后重试')
}
function requireCsrf(request: Request, csrfToken: string | null): void {
  const expected = Buffer.from(csrfToken ?? '')
  const actual = Buffer.from(request.headers.get('x-csrf-token') ?? '')
  if (!expected.length || expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new RankingError(403, '登录状态已变化，请刷新后重试')
}
export async function requireRankingWrite(request: Request, cookies: AstroCookies): Promise<RankingIdentity & { user: RankingUser }> {
  if (process.env.RANKING_WRITE_ENABLED === 'false') throw new RankingError(503, '正在维护，草稿已保留，请稍后再试')
  requireRankingOrigin(request)
  const identity = await requireRankingUser(cookies)
  requireCsrf(request, identity.csrfToken)
  return identity
}
export async function exchangeWalineSession(request: Request, cookies: AstroCookies): Promise<RankingIdentity> {
  requireRankingOrigin(request)
  const { token, remember = false } = await readRankingJson(request)
  if (!validWalineToken(token) || typeof remember !== 'boolean') throw new RankingError(422, 'Waline 登录凭据格式无效')
  const upstream = await verifyWalineToken(token)
  if (!upstream) throw new RankingError(401, 'Waline 登录已失效，请重新登录')
  const store = getRankingStore()
  const user = store.createOrGetUser(walineProvider(), upstream.subject, upstream.displayName)
  const session = store.createSession(user.id)
  clearRankingSession(cookies)
  const options = { path: '/', httpOnly: true, secure: rankingOrigin().startsWith('https:'), sameSite: 'lax' as const,
    ...(remember ? { expires: new Date(session.expiresAt) } : {}) }
  cookies.set(rankingSessionCookieName(), session.token, options)
  cookies.set(rankingWalineCookieName(), token, options)
  return { user, csrfToken: session.csrfToken, isAdmin: store.isAdmin(user.id) }
}
/** Local logout must work even when Waline is offline or its token has expired. */
export function logoutRanking(request: Request, cookies: AstroCookies): void {
  requireRankingOrigin(request)
  const token = cookies.get(rankingSessionCookieName())?.value
  const session = token && token.length <= 256 ? getRankingStore().getSession(token) : null
  if (session) requireCsrf(request, session.csrfToken)
  clearRankingSession(cookies)
}
export async function readRankingJson(request: Request): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) throw new RankingError(415, '请使用 JSON 提交内容')
  const declared = request.headers.get('content-length')
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > RANKING_BODY_LIMIT)) throw new RankingError(413, '内容太大，请缩短说明')
  const reader = request.body?.getReader()
  if (!reader) throw new RankingError(422, '提交内容为空')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > RANKING_BODY_LIMIT) { await reader.cancel(); throw new RankingError(413, '内容太大，请缩短说明') }
      chunks.push(value)
    }
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid object')
    return parsed as Record<string, unknown>
  } catch (error) {
    if (error instanceof RankingError) throw error
    throw new RankingError(422, '内容格式无效，请检查后重试')
  } finally { reader.releaseLock() }
}
export function rankingJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data }), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex',
  } })
}
export function rankingFailure(error: unknown): Response {
  const status = error instanceof RankingError ? error.status : 503
  return new Response(JSON.stringify({ error: error instanceof RankingError ? error.message : '服务暂时不可用，请稍后重试' }), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex', ...(status === 429 ? { 'Retry-After': '60' } : {}) },
  })
}
export function rankingPage(value: string | null): number {
  const page = value === null ? 1 : Number(value)
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000) throw new RankingError(422, '页码无效')
  return page
}
