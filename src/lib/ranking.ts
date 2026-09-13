/** Shared JSON contract. This module is safe to import in the browser. */
export interface RankingItem { itemId: string; name: string; note?: string }
export interface RankingPayload {
  schemaVersion: 1
  title: string
  description: string
  categoryId: string
  items: RankingItem[]
  changeNote?: string
}
export interface RankingSource { rankingId: string; versionId: string }
export interface SubmissionInput {
  requestId: string
  rankingId?: string
  baseVersionId?: string
  derivedFrom?: RankingSource
  payload: RankingPayload
}
export interface RankingUser { id: string; displayName: string }
export interface RankingRecord {
  id: string
  ownerId: string
  derivedFrom: RankingSource | null
  currentVersionId: string | null
  hidden: boolean
}
export type SubmissionStatus = 'pending' | 'published' | 'rejected' | 'withdrawn'
export interface RankingSubmission {
  id: string
  rankingId: string
  authorId: string
  baseVersionId: string | null
  payload: RankingPayload
  status: SubmissionStatus
  submittedAt: string
  processedAt: string | null
  reason: string | null
  publishedVersionId: string | null
}
export interface RankingVersion {
  id: string
  rankingId: string
  number: number
  parentVersionId: string | null
  payload: RankingPayload
  publishedAt: string
}
export interface PublicRanking {
  ranking: RankingRecord
  version: RankingVersion
  author: RankingUser
  source: { rankingId: string; versionId: string; hidden: boolean; title?: string } | null
}
export const rankingCategories = [
  { id: 'games', name: '游戏', active: true },
  { id: 'books-screen', name: '阅读与影视', active: true },
  { id: 'food-life', name: '饮食与生活', active: true },
  { id: 'other', name: '其他', active: true },
] as const
export const RANKING_BODY_LIMIT = 256 * 1024
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export class RankingError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = 'RankingError' }
}
export function requireId(value: unknown, field = '编号'): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new RankingError(422, `${field}无效`)
  return value.toLowerCase()
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RankingError(422, '内容格式无效')
  return value as Record<string, unknown>
}
function text(value: unknown, field: string, limit: number, required = false): string {
  if (typeof value !== 'string') throw new RankingError(422, `${field}必须为文字`)
  const result = value.trim()
  if ((required && !result) || [...result].length > limit) throw new RankingError(422, `${field}${required ? '不能为空，且' : ''}最多 ${limit} 字`)
  return result
}
export function validateRankingPayload(value: unknown, requireActiveCategory = true): RankingPayload {
  const input = object(value)
  if (input.schemaVersion !== 1) throw new RankingError(422, '不支持的内容版本')
  const categoryId = text(input.categoryId, '分类', 80, true)
  if (!rankingCategories.some(category => category.id === categoryId && (!requireActiveCategory || category.active))) throw new RankingError(422, '请选择可用分类')
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 100) throw new RankingError(422, '榜单需要 1–100 个条目')
  const seen = new Set<string>()
  const items = input.items.map(value => {
    const item = object(value)
    const itemId = requireId(item.itemId, '条目编号')
    if (seen.has(itemId)) throw new RankingError(422, '条目编号重复')
    seen.add(itemId)
    const note = item.note === undefined ? '' : text(item.note, '条目说明', 500)
    return { itemId, name: text(item.name, '条目名称', 120, true), ...(note ? { note } : {}) }
  })
  const changeNote = input.changeNote === undefined ? '' : text(input.changeNote, '修改说明', 500)
  return {
    schemaVersion: 1,
    title: text(input.title, '标题', 80, true),
    description: text(input.description, '简介', 1000),
    categoryId, items, ...(changeNote ? { changeNote } : {}),
  }
}
export function validateSubmissionInput(value: unknown, requireActiveCategory = true): SubmissionInput {
  const input = object(value)
  const rankingId = input.rankingId === undefined ? undefined : requireId(input.rankingId, '榜单编号')
  const baseVersionId = input.baseVersionId === undefined ? undefined : requireId(input.baseVersionId, '基线版本')
  const source = input.derivedFrom === undefined ? undefined : object(input.derivedFrom)
  if (baseVersionId && !rankingId) throw new RankingError(422, '更新需要指定榜单')
  if (baseVersionId && source) throw new RankingError(422, '更新不能改变来源')
  return {
    requestId: requireId(input.requestId, '请求编号'),
    ...(rankingId ? { rankingId } : {}), ...(baseVersionId ? { baseVersionId } : {}),
    ...(source ? { derivedFrom: { rankingId: requireId(source.rankingId), versionId: requireId(source.versionId) } } : {}),
    payload: validateRankingPayload(input.payload, requireActiveCategory),
  }
}

export function rankingDiff(before: RankingPayload | null, after: RankingPayload): string[] {
  if (!before) return [`新建榜单，共 ${after.items.length} 个条目`]
  const changes: string[] = []
  for (const key of ['title', 'description', 'categoryId'] as const) {
    if (before[key] !== after[key]) changes.push(`${{ title: '标题', description: '简介', categoryId: '分类' }[key]}已修改`)
  }
  const old = new Map(before.items.map((item, index) => [item.itemId, { item, index }]))
  const currentIds = new Set(after.items.map(item => item.itemId))
  for (const item of before.items) if (!currentIds.has(item.itemId)) changes.push(`移除「${item.name}」`)
  after.items.forEach((item, index) => {
    const previous = old.get(item.itemId)
    if (!previous) { changes.push(`新增「${item.name}」至第 ${index + 1} 名`); return }
    if (previous.index !== index) changes.push(`「${item.name}」：第 ${previous.index + 1} → ${index + 1} 名`)
    if (previous.item.name !== item.name) changes.push(`「${previous.item.name}」改名为「${item.name}」`)
    if ((previous.item.note ?? '') !== (item.note ?? '')) changes.push(`「${item.name}」说明已修改`)
  })
  return changes.length ? changes : ['榜单内容未改变']
}
