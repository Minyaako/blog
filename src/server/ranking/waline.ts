import { COMMENT_SERVER_URL } from '../../lib/waline-config.ts'
import { RankingError } from '../../lib/ranking.ts'
import { rankingOrigin } from './runtime.ts'

export interface WalineIdentity { subject: string; displayName: string }
export function walineServerURL(): string {
  const value = process.env.RANKING_WALINE_URL || COMMENT_SERVER_URL
  let url: URL
  try { url = new URL(value) } catch { throw new RankingError(503, '登录服务配置无效') }
  const local = (host: string) => ['localhost', '127.0.0.1', '[::1]'].includes(host)
  if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && local(url.hostname) && local(new URL(rankingOrigin()).hostname)))) {
    throw new RankingError(503, '登录服务配置无效')
  }
  return url.href.replace(/\/+$/, '')
}
export const walineProvider = () => `waline:${walineServerURL()}`
export function validWalineToken(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 2048 && /^[A-Za-z0-9._~+/-]+=*$/.test(value)
}

/** Fixed trusted endpoint only; no redirects, profile URLs, or client-provided issuer. */
export async function verifyWalineToken(token: string): Promise<WalineIdentity | null> {
  if (!validWalineToken(token)) return null
  try {
    const response = await fetch(`${walineServerURL()}/api/token`, {
      headers: { Authorization: `Bearer ${token}`, Origin: rankingOrigin(), Accept: 'application/json' },
      redirect: 'error', signal: AbortSignal.timeout(5000), cache: 'no-store',
    })
    if ([401, 403].includes(response.status)) { await response.body?.cancel(); return null }
    if (!response.ok) { await response.body?.cancel(); throw new Error('Upstream unavailable') }
    const reader = response.body?.getReader()
    if (!reader) throw new Error('Missing response')
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 32 * 1024) { await reader.cancel(); throw new Error('Oversized response') }
        chunks.push(value)
      }
    } finally { reader.releaseLock() }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!body || body.errno !== 0 || !body.data || typeof body.data !== 'object' || Array.isArray(body.data)) throw new Error('Invalid response')
    const user = body.data
    if (!Object.keys(user).length) return null
    if (user.type === 'banned' || (typeof user.type === 'string' && user.type.startsWith('verify:'))) return null
    const id = user.objectId
    if (!(typeof id === 'string' && id.trim() === id && id.length > 0 && id.length <= 256) &&
        !(typeof id === 'number' && Number.isSafeInteger(id) && id > 0)) throw new Error('Missing user identity')
    if (typeof user.display_name !== 'string' || !user.display_name.trim() || [...user.display_name.trim()].length > 120) throw new Error('Invalid user profile')
    return { subject: String(id), displayName: user.display_name.trim() }
  } catch (error) {
    if (error instanceof RankingError) throw error
    throw new RankingError(503, 'Waline 登录服务暂不可用，请保留草稿后重试')
  }
}
