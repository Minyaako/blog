import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import {
  RankingError, validateSubmissionInput, validateRankingPayload,
  type RankingUser, type RankingRecord, type RankingSubmission, type RankingVersion,
  type PublicRanking, type SubmissionInput, type SubmissionStatus,
} from '../../lib/ranking.ts'
import { assertRankingSchema } from './migrate.ts'

type Row = Record<string, unknown>
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const notFound = () => new RankingError(404, '内容不存在')
const toUser = (row: Row): RankingUser => ({ id: String(row.id), displayName: String(row.display_name) })
const toRanking = (row: Row): RankingRecord => ({
  id: String(row.id), ownerId: String(row.owner_id),
  derivedFrom: row.source_ranking_id ? { rankingId: String(row.source_ranking_id), versionId: String(row.source_version_id) } : null,
  currentVersionId: row.current_version_id ? String(row.current_version_id) : null, hidden: Boolean(row.hidden),
})
const toSubmission = (row: Row): RankingSubmission => ({
  id: String(row.id), rankingId: String(row.ranking_id), authorId: String(row.author_id),
  baseVersionId: row.base_version_id ? String(row.base_version_id) : null,
  payload: JSON.parse(String(row.payload)), status: row.status as SubmissionStatus,
  submittedAt: String(row.submitted_at), processedAt: row.processed_at ? String(row.processed_at) : null,
  reason: row.reason === null ? null : String(row.reason),
  publishedVersionId: row.published_version_id ? String(row.published_version_id) : null,
})
const toVersion = (row: Row): RankingVersion => ({
  id: String(row.id), rankingId: String(row.ranking_id), number: Number(row.number),
  parentVersionId: row.parent_version_id ? String(row.parent_version_id) : null,
  payload: JSON.parse(String(row.payload)), publishedAt: String(row.published_at),
})
function offset(page = 1): number {
  if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000) throw new RankingError(422, '页码无效')
  return (page - 1) * 20
}

export class RankingStore {
  private readonly adminIds: Set<string>
  private readonly now: () => Date
  constructor(private readonly db: DatabaseSync, options: { adminIds?: string[]; now?: () => Date } = {}) {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000')
    assertRankingSchema(db)
    this.adminIds = new Set(options.adminIds ?? [])
    this.now = options.now ?? (() => new Date())
  }
  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try { const result = fn(); this.db.exec('COMMIT'); return result }
    catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  private requireUser(id: string): RankingUser {
    const user = this.getUser(id)
    if (!user) throw new RankingError(401, '请先登录')
    return user
  }
  private requireAdmin(id: string): void {
    this.requireUser(id)
    if (!this.isAdmin(id)) throw new RankingError(403, '需要管理员权限')
  }
  private submission(id: string): RankingSubmission {
    const row = this.db.prepare('SELECT * FROM submissions WHERE id = ?').get(id)
    if (!row) throw notFound()
    return toSubmission(row)
  }
  private event(actor: string, ranking: string, submission: string | null, action: string, now: string, reason: string | null): void {
    this.db.prepare('INSERT INTO moderation_events VALUES (?, ?, ?, ?, ?, ?, ?)').run(randomUUID(), ranking, submission, action, actor, now, reason)
  }
  createOrGetUser(provider: string, subject: string, displayName: string): RankingUser {
    if (!provider || !subject || provider.length > 2048 || subject.length > 2048 || !displayName.trim() || [...displayName.trim()].length > 120) throw new RankingError(422, '登录身份资料无效')
    return this.transaction(() => {
      const existing = this.db.prepare('SELECT u.* FROM users u JOIN auth_identities a ON a.user_id = u.id WHERE a.provider = ? AND a.subject = ?').get(provider, subject)
      if (existing) {
        this.db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(displayName.trim(), String(existing.id))
        return { id: String(existing.id), displayName: displayName.trim() }
      }
      const user = { id: randomUUID(), displayName: displayName.trim() }
      this.db.prepare('INSERT INTO users VALUES (?, ?, ?)').run(user.id, user.displayName, this.now().toISOString())
      this.db.prepare('INSERT INTO auth_identities VALUES (?, ?, ?)').run(provider, subject, user.id)
      return user
    })
  }
  getUser(id: string): RankingUser | null {
    const row = this.db.prepare('SELECT id, display_name FROM users WHERE id = ?').get(id)
    return row ? toUser(row) : null
  }
  getIdentityUser(provider: string, subject: string): RankingUser | null {
    const row = this.db.prepare('SELECT u.id, u.display_name FROM users u JOIN auth_identities a ON a.user_id = u.id WHERE a.provider = ? AND a.subject = ?').get(provider, subject)
    return row ? toUser(row) : null
  }
  isAdmin(userId: string): boolean { return this.adminIds.has(userId) }

  listPublicReferences(): Array<{ rankingId: string; publishedAt: string }> {
    return this.db.prepare('SELECT r.id, v.published_at FROM rankings r JOIN versions v ON v.id = r.current_version_id WHERE r.hidden = 0 ORDER BY r.id LIMIT 50000')
      .all().map(row => ({ rankingId: String(row.id), publishedAt: String(row.published_at) }))
  }

  submit(userId: string, rawInput: SubmissionInput): RankingSubmission {
    this.requireUser(userId)
    const input = validateSubmissionInput(rawInput, false)
    const digest = hash(JSON.stringify(input))
    return this.transaction(() => {
      const retry = this.db.prepare('SELECT * FROM submissions WHERE author_id = ? AND request_id = ?').get(userId, input.requestId)
      if (retry) {
        if (retry.request_digest !== digest) throw new RankingError(409, '同一请求编号不能提交不同内容')
        return toSubmission(retry)
      }
      validateRankingPayload(input.payload)
      const now = this.now()
      const minute = new Date(now.getTime() - 60_000).toISOString()
      const day = `${now.toISOString().slice(0, 10)}T00:00:00.000Z`
      const counts = this.db.prepare("SELECT SUM(status = 'pending') pending, SUM(submitted_at > ?) recent, SUM(submitted_at >= ?) daily FROM submissions WHERE author_id = ?").get(minute, day, userId)!
      if (Number(counts.pending) >= 5 || Number(counts.recent) >= 3 || Number(counts.daily) >= 20) throw new RankingError(429, '投稿次数已达上限，请稍后再试')
      let ranking: RankingRecord
      if (input.rankingId) {
        const target = this.getRanking(input.rankingId)
        if (!target || target.ownerId !== userId) throw notFound()
        ranking = target
        if (input.derivedFrom && (!ranking.derivedFrom || input.derivedFrom.rankingId !== ranking.derivedFrom.rankingId || input.derivedFrom.versionId !== ranking.derivedFrom.versionId)) throw new RankingError(409, '不能修改榜单来源')
      } else {
        ranking = { id: randomUUID(), ownerId: userId, derivedFrom: input.derivedFrom ?? null, currentVersionId: null, hidden: false }
      }
      if (ranking.hidden) throw new RankingError(409, '榜单已下架，暂不能投稿')
      if ((input.baseVersionId ?? null) !== ranking.currentVersionId) throw new RankingError(409, '榜单已更新，请从当前版本重新编辑')
      if (!ranking.currentVersionId && ranking.derivedFrom) this.getPublicRanking(ranking.derivedFrom.rankingId, ranking.derivedFrom.versionId)
      if (this.db.prepare("SELECT id FROM submissions WHERE ranking_id = ? AND status = 'pending'").get(ranking.id)) throw new RankingError(409, '此榜单已有待审核投稿')
      if (!input.rankingId) this.db.prepare('INSERT INTO rankings (id, owner_id, source_ranking_id, source_version_id) VALUES (?, ?, ?, ?)').run(ranking.id, userId, ranking.derivedFrom?.rankingId ?? null, ranking.derivedFrom?.versionId ?? null)
      const id = randomUUID()
      this.db.prepare("INSERT INTO submissions (id, ranking_id, author_id, base_version_id, payload, request_id, request_digest, status, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)")
        .run(id, ranking.id, userId, input.baseVersionId ?? null, JSON.stringify(input.payload), input.requestId, digest, now.toISOString())
      return this.submission(id)
    })
  }

  withdraw(userId: string, id: string): RankingSubmission {
    this.requireUser(userId)
    return this.transaction(() => {
      const submission = this.submission(id)
      if (submission.authorId !== userId) throw notFound()
      if (submission.status === 'withdrawn') return submission
      if (submission.status !== 'pending') throw new RankingError(409, '投稿已处理，不能撤回')
      const now = this.now().toISOString()
      this.db.prepare("UPDATE submissions SET status = 'withdrawn', processed_at = ? WHERE id = ?").run(now, id)
      this.event(userId, submission.rankingId, id, 'withdraw', now, null)
      return this.submission(id)
    })
  }
  review(adminId: string, id: string, decision: 'approve' | 'reject', reason?: string): RankingSubmission {
    this.requireAdmin(adminId)
    if (decision !== 'approve' && decision !== 'reject') throw new RankingError(422, '审核操作无效')
    const note = reason?.trim() || null
    return this.transaction(() => {
      const submission = this.submission(id)
      const expected = decision === 'approve' ? 'published' : 'rejected'
      if (submission.status === expected) return submission
      if (submission.status !== 'pending') throw new RankingError(409, '投稿已处理')
      if ((decision === 'reject' && !note) || (note && [...note].length > 1000)) throw new RankingError(422, '请填写有效的退回原因（最多 1000 字）')
      const now = this.now().toISOString()
      if (decision === 'reject') {
        this.db.prepare("UPDATE submissions SET status = 'rejected', processed_at = ?, reason = ? WHERE id = ?").run(now, note, id)
      } else {
        const ranking = this.getRanking(submission.rankingId)!
        if (ranking.hidden) throw new RankingError(409, '榜单已下架，不能发布')
        validateRankingPayload(submission.payload)
        if (ranking.currentVersionId !== submission.baseVersionId) throw new RankingError(409, '审核基线已过期')
        if (!ranking.currentVersionId && ranking.derivedFrom) this.getPublicRanking(ranking.derivedFrom.rankingId, ranking.derivedFrom.versionId)
        const previous = ranking.currentVersionId ? this.db.prepare('SELECT number FROM versions WHERE id = ?').get(ranking.currentVersionId) : null
        const versionId = randomUUID()
        this.db.prepare('INSERT INTO versions VALUES (?, ?, ?, ?, ?, ?, ?)').run(versionId, ranking.id, Number(previous?.number ?? 0) + 1, ranking.currentVersionId, id, JSON.stringify(submission.payload), now)
        this.db.prepare('UPDATE rankings SET current_version_id = ? WHERE id = ?').run(versionId, ranking.id)
        this.db.prepare("UPDATE submissions SET status = 'published', processed_at = ?, published_version_id = ? WHERE id = ?").run(now, versionId, id)
      }
      this.event(adminId, submission.rankingId, id, decision, now, note)
      return this.submission(id)
    })
  }
  setVisibility(adminId: string, rankingId: string, hidden: boolean, reason: string): void {
    this.requireAdmin(adminId)
    if (typeof hidden !== 'boolean' || typeof reason !== 'string' || !reason.trim() || [...reason.trim()].length > 1000) throw new RankingError(422, '请填写有效的操作原因（最多 1000 字）')
    this.transaction(() => {
      const ranking = this.getRanking(rankingId)
      if (!ranking?.currentVersionId) throw notFound()
      if (ranking.hidden === hidden) return
      this.db.prepare('UPDATE rankings SET hidden = ? WHERE id = ?').run(Number(hidden), rankingId)
      this.event(adminId, rankingId, null, hidden ? 'hide' : 'restore', this.now().toISOString(), reason.trim())
    })
  }
  getSubmission(actorId: string, id: string): RankingSubmission {
    this.requireUser(actorId)
    const submission = this.submission(id)
    if (submission.authorId !== actorId && !this.isAdmin(actorId)) throw notFound()
    return submission
  }
  listSubmissions(actorId: string, options: { manage?: boolean; page?: number; status?: SubmissionStatus } = {}): RankingSubmission[] {
    this.requireUser(actorId)
    if (options.manage) this.requireAdmin(actorId)
    if (options.status && !['pending', 'published', 'rejected', 'withdrawn'].includes(options.status)) throw new RankingError(422, '投稿状态无效')
    return this.db.prepare(`SELECT * FROM submissions WHERE (? OR author_id = ?) AND (? IS NULL OR status = ?) ORDER BY submitted_at DESC, id DESC LIMIT 20 OFFSET ?`)
      .all(Number(Boolean(options.manage)), actorId, options.status ?? null, options.status ?? null, offset(options.page)).map(toSubmission)
  }
  getRanking(id: string): RankingRecord | null {
    const row = this.db.prepare('SELECT * FROM rankings WHERE id = ?').get(id)
    return row ? toRanking(row) : null
  }
  getPublicRanking(id: string, versionId?: string): PublicRanking {
    const ranking = this.getRanking(id)
    if (!ranking?.currentVersionId) throw notFound()
    if (ranking.hidden) throw new RankingError(410, '榜单已下架')
    return this.readRanking(ranking, versionId)
  }
  private readRanking(ranking: RankingRecord, versionId?: string): PublicRanking {
    const row = this.db.prepare('SELECT * FROM versions WHERE id = ? AND ranking_id = ?').get(versionId ?? ranking.currentVersionId!, ranking.id)
    if (!row) throw notFound()
    let source: PublicRanking['source'] = null
    if (ranking.derivedFrom) {
      const sourceRow = this.db.prepare('SELECT r.hidden, v.payload FROM rankings r JOIN versions v ON v.id = ? AND v.ranking_id = r.id WHERE r.id = ?').get(ranking.derivedFrom.versionId, ranking.derivedFrom.rankingId)
      const hidden = !sourceRow || Boolean(sourceRow.hidden)
      source = { ...ranking.derivedFrom, hidden, ...(!hidden ? { title: JSON.parse(String(sourceRow.payload)).title as string } : {}) }
    }
    return { ranking, version: toVersion(row), author: this.getUser(ranking.ownerId)!, source }
  }
  listManagedRankings(adminId: string, options: { page?: number } = {}): PublicRanking[] {
    this.requireAdmin(adminId)
    return this.db.prepare('SELECT r.* FROM rankings r JOIN versions v ON v.id = r.current_version_id ORDER BY v.published_at DESC, r.id DESC LIMIT 20 OFFSET ?')
      .all(offset(options.page)).map(row => this.readRanking(toRanking(row)))
  }
  listPublic(options: { categoryId?: string; page?: number } = {}): PublicRanking[] {
    const rows = this.db.prepare('SELECT r.id FROM rankings r JOIN versions v ON v.id = r.current_version_id WHERE r.hidden = 0 AND (? IS NULL OR json_extract(v.payload, \'$.categoryId\') = ?) ORDER BY v.published_at DESC, r.id DESC LIMIT 20 OFFSET ?')
      .all(options.categoryId ?? null, options.categoryId ?? null, offset(options.page))
    return rows.map(row => this.getPublicRanking(String(row.id)))
  }
  listVersions(rankingId: string, page = 1): RankingVersion[] {
    this.getPublicRanking(rankingId)
    return this.db.prepare('SELECT * FROM versions WHERE ranking_id = ? ORDER BY number DESC LIMIT 20 OFFSET ?').all(rankingId, offset(page)).map(toVersion)
  }
  getVersionForReview(adminId: string, id: string): RankingVersion {
    this.requireAdmin(adminId)
    const row = this.db.prepare('SELECT * FROM versions WHERE id = ?').get(id)
    if (!row) throw notFound()
    return toVersion(row)
  }
  createSession(userId: string): { token: string; csrfToken: string; expiresAt: string } {
    this.requireUser(userId)
    const session = { token: randomBytes(32).toString('base64url'), csrfToken: randomBytes(32).toString('base64url'), expiresAt: new Date(this.now().getTime() + 7 * 86_400_000).toISOString() }
    this.db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)').run(hash(session.token), userId, session.csrfToken, session.expiresAt)
    return session
  }
  getSession(token: string): { user: RankingUser; csrfToken: string; expiresAt: string } | null {
    if (!token || token.length > 200) return null
    const row = this.db.prepare('SELECT s.csrf_token, s.expires_at, u.id, u.display_name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?').get(hash(token), this.now().toISOString())
    return row ? { user: toUser(row), csrfToken: String(row.csrf_token), expiresAt: String(row.expires_at) } : null
  }
  revokeSession(token: string): void { this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash(token)) }
}
