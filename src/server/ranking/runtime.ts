import { existsSync, lstatSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { RankingError, UUID_PATTERN } from '../../lib/ranking.ts'
import { RankingStore } from './store.ts'

let instance: RankingStore | undefined

export function rankingOrigin(): string {
  const configured = process.env.RANKING_ORIGIN || 'https://gsk.minyako.top'
  const url = new URL(configured)
  if (url.origin !== configured || url.username || url.password ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new RankingError(503, '登录服务配置暂不可用')
  }
  return url.origin
}

export function getRankingStore(): RankingStore {
  if (instance) return instance
  const path = process.env.RANKING_DATABASE
  if (!path || !isAbsolute(path) || !existsSync(path) || !lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) {
    throw new RankingError(503, '排行榜暂时不可用，请稍后重试')
  }
  const adminIds = (process.env.RANKING_ADMIN_IDS || '').split(',').map(id => id.trim().toLowerCase()).filter(Boolean)
  if (adminIds.some(id => !UUID_PATTERN.test(id))) throw new RankingError(503, '排行榜配置暂不可用')
  let db: DatabaseSync | undefined
  try {
    db = new DatabaseSync(path, { timeout: 3000, enableForeignKeyConstraints: true, allowExtension: false })
    instance = new RankingStore(db, { adminIds })
    return instance
  } catch {
    db?.close()
    throw new RankingError(503, '排行榜暂时不可用，请稍后重试')
  }
}
