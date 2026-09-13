import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RankingStore } from '../../src/server/ranking/store'
import { migrateRankingDatabase, assertRankingSchema } from '../../src/server/ranking/migrate'
import { RankingError, rankingCategories, type SubmissionInput, type RankingUser } from '../../src/lib/ranking'

let db: DatabaseSync
let store: RankingStore
let author: RankingUser
let stranger: RankingUser
let admin: RankingUser
let now: Date
const input = (extra: Partial<SubmissionInput> = {}): SubmissionInput => ({
  requestId: randomUUID(), payload: { schemaVersion: 1, title: '我的榜单', description: '', categoryId: 'games', items: [{ itemId: randomUUID(), name: '条目' }] }, ...extra,
})
function status(fn: () => unknown, code: number) {
  try { fn(); throw new Error('Expected RankingError') } catch (error) {
    expect(error).toBeInstanceOf(RankingError)
    expect((error as RankingError).status).toBe(code)
  }
}
const count = (table: string) => Number(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()!.n)
function publish(user = author, request = input()) {
  const submission = store.submit(user.id, request)
  return store.review(admin.id, submission.id, 'approve')
}
beforeEach(() => {
  db = new DatabaseSync(':memory:')
  migrateRankingDatabase(db)
  now = new Date('2026-09-13T08:00:00.000Z')
  store = new RankingStore(db, { now: () => now })
  author = store.createOrGetUser('https://issuer.example', 'author', '同名作者')
  stranger = store.createOrGetUser('https://issuer.example', 'stranger', '同名作者')
  admin = store.createOrGetUser('https://issuer.example', 'admin', '管理员')
  store = new RankingStore(db, { adminIds: [admin.id], now: () => now })
})
afterEach(() => db.close())

it('returns a completed request after its category is disabled, but rejects new submissions', () => {
  const request = input()
  const saved = store.submit(author.id, request)
  const category = rankingCategories[0] as { active: boolean }
  category.active = false
  try {
    expect(store.submit(author.id, request).id).toBe(saved.id)
    status(() => store.submit(author.id, { ...request, requestId: randomUUID() }), 422)
    status(() => store.review(admin.id, saved.id, 'approve'), 422)
    expect(count('versions')).toBe(0)
  } finally { category.active = true }
})

describe('explicit database lifecycle and identities', () => {
  it('refuses missing, unknown, or incomplete schema and preserves unrelated data', () => {
    const empty = new DatabaseSync(':memory:')
    expect(() => new RankingStore(empty)).toThrow(/migration/)
    expect(Number(empty.prepare('PRAGMA user_version').get()!.user_version)).toBe(0)
    empty.exec('CREATE TABLE unrelated (value TEXT); INSERT INTO unrelated VALUES (\'keep\')')
    expect(() => migrateRankingDatabase(empty)).toThrow(/Unsupported/)
    expect(empty.prepare('SELECT value FROM unrelated').get()!.value).toBe('keep')
    empty.close()
    migrateRankingDatabase(db)
    db.exec('DROP TRIGGER immutable_version_update')
    expect(() => assertRankingSchema(db)).toThrow(/constraint is missing/)
  })
  it('maps exact provider and stable subject, never display names, and updates display only', () => {
    expect(author.id).not.toBe(stranger.id)
    const renamed = store.createOrGetUser('https://issuer.example', 'author', '新名字')
    expect(renamed).toEqual({ id: author.id, displayName: '新名字' })
    expect(store.createOrGetUser('https://second.example', 'author', '新名字').id).not.toBe(author.id)
    expect(store.getUser(author.id)).toEqual(renamed)
    expect(Object.keys(renamed)).toEqual(['id', 'displayName'])
  })
  it('persists published data and hashed sessions across a database reopen', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ranking-store-'))
    const path = join(directory, 'test.sqlite')
    try {
      let disk = new DatabaseSync(path)
      migrateRankingDatabase(disk)
      let service = new RankingStore(disk, { now: () => now })
      const user = service.createOrGetUser('test', 'persistent', '作者')
      service = new RankingStore(disk, { adminIds: [user.id], now: () => now })
      const submitted = service.submit(user.id, input())
      service.review(user.id, submitted.id, 'approve')
      const session = service.createSession(user.id)
      expect(disk.prepare('SELECT token_hash FROM sessions').get()!.token_hash).not.toBe(session.token)
      disk.close()
      disk = new DatabaseSync(path)
      service = new RankingStore(disk, { now: () => now })
      expect(service.getPublicRanking(submitted.rankingId).version.number).toBe(1)
      expect(service.getSession(session.token)?.user.id).toBe(user.id)
      expect(service.createOrGetUser('test', 'persistent', '改名').id).toBe(user.id)
      disk.close()
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
  it('expires and revokes independent random sessions', () => {
    const first = store.createSession(author.id)
    const second = store.createSession(author.id)
    expect(first.token).not.toBe(second.token)
    expect(first.csrfToken).not.toBe(second.csrfToken)
    expect(store.getSession(first.token)?.csrfToken).toBe(first.csrfToken)
    store.revokeSession(first.token)
    expect(store.getSession(first.token)).toBeNull()
    now = new Date(second.expiresAt)
    expect(store.getSession(second.token)).toBeNull()
    expect(store.getSession('bad')).toBeNull()
  })
})

describe('submissions, permissions and idempotency', () => {
  it('retries the normalized request even after review without creating another ranking', () => {
    const request = input()
    const first = store.submit(author.id, request)
    const normalizedRetry = { ...request, payload: { ...request.payload, title: ` ${request.payload.title} ` } }
    expect(store.submit(author.id, normalizedRetry).id).toBe(first.id)
    status(() => store.submit(author.id, { ...request, payload: { ...request.payload, title: '变更' } }), 409)
    const approved = store.review(admin.id, first.id, 'approve')
    expect(store.submit(author.id, request)).toEqual(approved)
    expect(count('rankings')).toBe(1)
    expect(count('submissions')).toBe(1)
  })
  it('isolates private submissions and management while permitting independent request namespaces', () => {
    const request = input()
    const first = store.submit(author.id, request)
    status(() => store.getSubmission(stranger.id, first.id), 404)
    status(() => store.withdraw(stranger.id, first.id), 404)
    status(() => store.submit(stranger.id, input({ rankingId: first.rankingId })), 404)
    status(() => store.review(stranger.id, first.id, 'approve'), 403)
    status(() => store.listSubmissions(stranger.id, { manage: true }), 403)
    status(() => store.listManagedRankings(stranger.id), 403)
    status(() => store.getVersionForReview(stranger.id, randomUUID()), 403)
    expect(store.listSubmissions(stranger.id)).toEqual([])
    expect(store.getSubmission(admin.id, first.id).id).toBe(first.id)
    expect(store.listSubmissions(admin.id, { manage: true })).toHaveLength(1)
    expect(store.listSubmissions(admin.id)).toEqual([])
    expect(store.submit(stranger.id, request).id).not.toBe(first.id)
    status(() => store.getPublicRanking(first.rankingId), 404)
    expect(store.listPublic()).toEqual([])
  })
  it('allows resubmission to an unpublished target only after withdrawal or rejection', () => {
    const first = store.submit(author.id, input())
    status(() => store.submit(author.id, input({ rankingId: first.rankingId })), 409)
    expect(store.withdraw(author.id, first.id).status).toBe('withdrawn')
    expect(store.withdraw(author.id, first.id).status).toBe('withdrawn')
    status(() => store.review(admin.id, first.id, 'approve'), 409)
    const second = store.submit(author.id, input({ rankingId: first.rankingId }))
    status(() => store.review(admin.id, second.id, 'reject'), 422)
    expect(store.review(admin.id, second.id, 'reject', '请补充说明').reason).toBe('请补充说明')
    expect(store.review(admin.id, second.id, 'reject', '重复点击').reason).toBe('请补充说明')
    expect(store.review(admin.id, second.id, 'reject').reason).toBe('请补充说明')
    const third = store.submit(author.id, input({ rankingId: first.rankingId }))
    expect(third.id).not.toBe(second.id)
    expect(count('rankings')).toBe(1)
  })
  it('limits one minute, pending total and UTC daily counts but never charges retries', () => {
    const firstRequest = input()
    store.submit(author.id, firstRequest)
    store.submit(author.id, input())
    store.submit(author.id, input())
    status(() => store.submit(author.id, input()), 429)
    expect(store.submit(author.id, firstRequest).status).toBe('pending')
    now = new Date(now.getTime() + 60_000)
    store.submit(author.id, input())
    store.submit(author.id, input())
    status(() => store.submit(author.id, input()), 429)
    expect(count('rankings')).toBe(5)
    for (const submission of store.listSubmissions(author.id)) store.withdraw(author.id, submission.id)
    for (let i = 5; i < 20; i++) {
      now = new Date(now.getTime() + 61_000)
      const submission = store.submit(author.id, input())
      store.withdraw(author.id, submission.id)
    }
    now = new Date(now.getTime() + 61_000)
    status(() => store.submit(author.id, input()), 429)
    now = new Date('2026-09-14T00:00:00.000Z')
    expect(store.submit(author.id, input()).status).toBe('pending')
  })
})

describe('atomic publication, versions and visibility', () => {
  it('publishes once, appends immutable versions, and rejects invalid baselines', () => {
    const first = publish()
    expect(store.review(admin.id, first.id, 'approve')).toEqual(first)
    status(() => store.withdraw(author.id, first.id), 409)
    status(() => store.review(admin.id, first.id, 'reject', '退回'), 409)
    status(() => store.submit(author.id, input({ rankingId: first.rankingId })), 409)
    const second = publish(author, input({ rankingId: first.rankingId, baseVersionId: first.publishedVersionId! }))
    expect(store.getPublicRanking(first.rankingId).version.number).toBe(2)
    expect(store.getPublicRanking(first.rankingId, first.publishedVersionId!).version.number).toBe(1)
    expect(store.listVersions(first.rankingId).map(v => v.number)).toEqual([2, 1])
    expect(store.getVersionForReview(admin.id, second.publishedVersionId!).parentVersionId).toBe(first.publishedVersionId)
    status(() => store.submit(author.id, input({ rankingId: first.rankingId, baseVersionId: first.publishedVersionId! })), 409)
    expect(() => db.prepare('UPDATE versions SET payload = ? WHERE id = ?').run('{}', first.publishedVersionId!)).toThrow(/immutable/)
    expect(() => db.prepare('DELETE FROM versions WHERE id = ?').run(first.publishedVersionId!)).toThrow(/immutable/)
    expect(() => db.prepare('UPDATE submissions SET payload = ? WHERE id = ?').run('{}', first.id)).toThrow(/immutable|transition/)
    expect(() => db.prepare('UPDATE rankings SET owner_id = ? WHERE id = ?').run(stranger.id, first.rankingId)).toThrow(/immutable/)
  })
  it('rolls back the version, pointer, state and audit if a final transaction step fails', () => {
    const submission = store.submit(author.id, input())
    db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON moderation_events BEGIN SELECT RAISE(ABORT, 'forced failure'); END")
    expect(() => store.review(admin.id, submission.id, 'approve')).toThrow(/forced failure/)
    expect(count('versions')).toBe(0)
    expect(count('moderation_events')).toBe(0)
    expect(store.getRanking(submission.rankingId)?.currentVersionId).toBeNull()
    expect(store.getSubmission(author.id, submission.id).status).toBe('pending')
    db.exec('DROP TRIGGER fail_audit')
    expect(store.review(admin.id, submission.id, 'approve').status).toBe('published')
  })
  it('rejects stale approval and enforces cross-ranking and duplicate-pending constraints', () => {
    const first = publish()
    const second = publish(author, input({ rankingId: first.rankingId, baseVersionId: first.publishedVersionId! }))
    const pending = store.submit(author.id, input({ rankingId: first.rankingId, baseVersionId: second.publishedVersionId! }))
    // Simulate a maintenance process moving the pointer after the submission was read.
    db.prepare('UPDATE rankings SET current_version_id = ? WHERE id = ?').run(first.publishedVersionId!, first.rankingId)
    status(() => store.review(admin.id, pending.id, 'approve'), 409)
    expect(store.getSubmission(author.id, pending.id).status).toBe('pending')
    expect(count('versions')).toBe(2)
    const other = publish(stranger)
    expect(() => db.prepare('UPDATE rankings SET current_version_id = ? WHERE id = ?').run(other.publishedVersionId!, first.rankingId)).toThrow(/FOREIGN KEY/)
    expect(() => db.prepare("INSERT INTO submissions (id, ranking_id, author_id, payload, request_id, request_digest, status, submitted_at) VALUES (?, ?, ?, '{}', ?, 'x', 'pending', ?)").run(randomUUID(), first.rankingId, author.id, randomUUID(), now.toISOString())).toThrow(/UNIQUE/)
    expect(() => db.prepare("INSERT INTO submissions (id, ranking_id, author_id, payload, request_id, request_digest, status, submitted_at) VALUES (?, ?, ?, '{}', ?, 'x', 'pending', ?)").run(randomUUID(), first.rankingId, stranger.id, randomUUID(), now.toISOString())).toThrow(/owner mismatch/)
  })
  it('serializes competing actions on two file-backed connections', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ranking-race-'))
    const path = join(directory, 'test.sqlite')
    const firstDb = new DatabaseSync(path)
    migrateRankingDatabase(firstDb)
    const secondDb = new DatabaseSync(path)
    try {
      const initial = new RankingStore(firstDb)
      const user = initial.createOrGetUser('test', 'user', '作者')
      const firstStore = new RankingStore(firstDb, { adminIds: [user.id] })
      const secondStore = new RankingStore(secondDb, { adminIds: [user.id] })
      const request = input()
      const submitted = firstStore.submit(user.id, request)
      expect(secondStore.submit(user.id, request).id).toBe(submitted.id)
      firstStore.review(user.id, submitted.id, 'approve')
      status(() => secondStore.withdraw(user.id, submitted.id), 409)
      const next = firstStore.submit(user.id, input())
      secondStore.withdraw(user.id, next.id)
      status(() => firstStore.review(user.id, next.id, 'approve'), 409)
      expect(Number(firstDb.prepare('SELECT COUNT(*) n FROM versions').get()!.n)).toBe(1)
    } finally {
      firstDb.close()
      secondDb.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
  it('rolls back new ranking allocation if insertion fails', () => {
    db.exec("CREATE TRIGGER fail_submission BEFORE INSERT ON submissions BEGIN SELECT RAISE(ABORT, 'forced failure'); END")
    expect(() => store.submit(author.id, input())).toThrow(/forced failure/)
    expect(count('rankings')).toBe(0)
    expect(count('submissions')).toBe(0)
  })
  it('checks source ownership and visibility, but published derived rankings update independently', () => {
    const original = publish()
    const unrelated = publish(stranger)
    status(() => store.getPublicRanking(original.rankingId, unrelated.publishedVersionId!), 404)
    status(() => store.submit(stranger.id, input({ derivedFrom: { rankingId: original.rankingId, versionId: unrelated.publishedVersionId! } })), 404)
    const source = { rankingId: original.rankingId, versionId: original.publishedVersionId! }
    const derived = publish(stranger, input({ derivedFrom: source }))
    expect(store.getPublicRanking(derived.rankingId).source?.title).toBe('我的榜单')
    const waiting = store.submit(admin.id, input({ derivedFrom: source }))
    store.setVisibility(admin.id, original.rankingId, true, '内部敏感原因')
    status(() => store.getPublicRanking(original.rankingId), 410)
    status(() => store.listVersions(original.rankingId), 410)
    status(() => store.submit(admin.id, input({ derivedFrom: source })), 410)
    status(() => store.review(admin.id, waiting.id, 'approve'), 410)
    expect(store.getSubmission(admin.id, waiting.id).status).toBe('pending')
    const publicDerived = store.getPublicRanking(derived.rankingId)
    expect(publicDerived.source).toEqual({ ...source, hidden: true })
    expect(store.listPublic().every(r => r.ranking.id !== original.rankingId)).toBe(true)
    expect(store.listManagedRankings(admin.id).find(r => r.ranking.id === original.rankingId)?.ranking.hidden).toBe(true)
    const updated = publish(stranger, input({ rankingId: derived.rankingId, baseVersionId: derived.publishedVersionId! }))
    expect(updated.status).toBe('published')
    store.setVisibility(admin.id, original.rankingId, false, '复核恢复')
    expect(store.review(admin.id, waiting.id, 'approve').status).toBe('published')
  })
  it('prevents hidden target updates and approval without losing the pending submission', () => {
    const first = publish()
    const pending = store.submit(author.id, input({ rankingId: first.rankingId, baseVersionId: first.publishedVersionId! }))
    store.setVisibility(admin.id, first.rankingId, true, '下架')
    status(() => store.review(admin.id, pending.id, 'approve'), 409)
    status(() => store.submit(author.id, input({ rankingId: first.rankingId, baseVersionId: first.publishedVersionId! })), 409)
    expect(store.getSubmission(author.id, pending.id).status).toBe('pending')
    expect(store.getVersionForReview(admin.id, first.publishedVersionId!).payload.title).toBe('我的榜单')
  })
})
