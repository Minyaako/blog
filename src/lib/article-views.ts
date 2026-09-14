import { COMMENT_SERVER_URL } from './waline-config'

/** The same counter contract used by @waline/client 3.15.2's pageview module. */
export async function recordArticleView(
  pageKey: string,
  signal: AbortSignal,
  request: typeof fetch = fetch,
): Promise<number> {
  const response = await request(`${COMMENT_SERVER_URL}/api/article?lang=zh-CN`, {
    method: 'POST',
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: pageKey, type: 'time', action: 'inc' }),
    signal,
  })
  if (!response.ok) throw new Error('Article counter unavailable')
  const result: unknown = await response.json()
  if (!result || typeof result !== 'object' || !('errno' in result) || result.errno !== 0
    || !('data' in result) || !Array.isArray(result.data) || result.data.length !== 1) {
    throw new Error('Invalid article counter response')
  }
  const count: unknown = result.data[0]?.time
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
    throw new Error('Invalid article view count')
  }
  return count
}
