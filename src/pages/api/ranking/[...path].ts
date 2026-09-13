import type { APIRoute } from 'astro'
import { RankingError, requireId, validateSubmissionInput } from '../../../lib/ranking'
import { getRankingStore } from '../../../server/ranking/runtime'
import { readRankingIdentity, readRankingJson, requireRankingUser, requireRankingWrite, rankingJson, rankingFailure, rankingPage, rankingLogin, exchangeWalineSession, logoutRanking } from '../../../server/ranking/http'

export const prerender = false
export const ALL: APIRoute = async ({ params, request, cookies, url }) => {
  try {
    const path = (params.path ?? '').replace(/\/$/, '')
    const method = request.method
    if (method === 'GET' && path === 'auth/session') return rankingJson({ ...await readRankingIdentity(cookies), login: rankingLogin() })
    if (method === 'POST' && path === 'auth/waline') return rankingJson({ ...await exchangeWalineSession(request, cookies), login: rankingLogin() })
    if (method === 'POST' && path === 'auth/logout') {
      logoutRanking(request, cookies)
      return rankingJson({ loggedOut: true })
    }
    if ((method === 'GET' || method === 'HEAD') && path === 'ready') {
      getRankingStore().listPublic({ page: 1 })
      const response = rankingJson({ ready: true })
      return method === 'HEAD' ? new Response(null, { status: response.status, headers: response.headers }) : response
    }
    if (method === 'GET') {
      const identity = await requireRankingUser(cookies)
      const store = getRankingStore()
      if (path === 'submissions' || path === 'manage/submissions') return rankingJson(store.listSubmissions(identity.user.id, {
        manage: path.startsWith('manage/'), page: rankingPage(url.searchParams.get('page')),
      }))
      const match = /^submissions\/([^/]+)$/.exec(path)
      if (match) return rankingJson(store.getSubmission(identity.user.id, requireId(match[1])))
    } else if (method === 'POST') {
      const identity = await requireRankingWrite(request, cookies)
      const store = getRankingStore()
      const body = await readRankingJson(request)
      if (path === 'submissions') return rankingJson(store.submit(identity.user.id, validateSubmissionInput(body, false)), 201)
      const withdraw = /^submissions\/([^/]+)\/withdraw$/.exec(path)
      if (withdraw) return rankingJson(store.withdraw(identity.user.id, requireId(withdraw[1])))
      const review = /^manage\/submissions\/([^/]+)\/review$/.exec(path)
      if (review) {
        if (body.decision !== 'approve' && body.decision !== 'reject') throw new RankingError(422, '审核操作无效')
        if (body.reason !== undefined && typeof body.reason !== 'string') throw new RankingError(422, '原因格式无效')
        return rankingJson(store.review(identity.user.id, requireId(review[1]), body.decision, body.reason as string | undefined))
      }
      const visibility = /^manage\/rankings\/([^/]+)\/visibility$/.exec(path)
      if (visibility) {
        if (typeof body.hidden !== 'boolean' || typeof body.reason !== 'string') throw new RankingError(422, '请填写处理原因')
        store.setVisibility(identity.user.id, requireId(visibility[1]), body.hidden, body.reason)
        return rankingJson({ updated: true })
      }
    } else throw new RankingError(405, '不支持的请求方式')
    throw new RankingError(404, '没有找到该内容')
  } catch (error) { return rankingFailure(error) }
}
