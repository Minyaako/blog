import { requireId, validateSubmissionInput, type RankingPayload, type RankingSource, type SubmissionInput } from '../lib/ranking'

export interface RankingDraft {
  schemaVersion: 1
  draftId: string
  owner: string
  intent: 'create' | 'derive' | 'update'
  rankingId?: string
  baseVersionId?: string
  derivedFrom?: RankingSource
  payload: RankingPayload
  revision: number
  contentRevision: number
  updatedAt: string
  pending?: { request: SubmissionInput; contentRevision: number }
  submitted?: { id: string; rankingId: string; contentRevision: number }
}

export class DraftConflict extends Error {
  constructor() { super('另一标签页已修改草稿。请先下载当前草稿，再刷新载入，自动保存已暂停。') }
}

/** One identity slot, with revision comparison and write in the SAME transaction. */
export class RankingDraftStore {
  private database?: Promise<IDBDatabase>
  private open(): Promise<IDBDatabase> {
    if (!this.database) this.database = new Promise((resolve, reject) => {
      const request = indexedDB.open('community-ranking-drafts', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'owner' })
      request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result) }
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('草稿存储被其他标签页占用'))
    })
    return this.database
  }
  async read(owner: string): Promise<RankingDraft | undefined> {
    const db = await this.open()
    return new Promise((resolve, reject) => {
      const request = db.transaction('drafts', 'readonly').objectStore('drafts').get(owner)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }
  async write(draft: RankingDraft, expected: number, expectedDraftId: string | undefined): Promise<number> {
    const db = await this.open()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('drafts', 'readwrite')
      const store = tx.objectStore('drafts')
      const read = store.get(draft.owner)
      let conflict = false
      read.onsuccess = () => {
        if ((read.result?.revision ?? 0) !== expected || read.result?.draftId !== expectedDraftId) { conflict = true; tx.abort(); return }
        store.put({ ...draft, revision: expected + 1 })
      }
      tx.oncomplete = () => resolve(expected + 1)
      tx.onabort = () => reject(conflict ? new DraftConflict() : tx.error || new Error('草稿保存失败'))
      tx.onerror = () => reject(tx.error || new Error('草稿保存失败'))
    })
  }
  async remove(owner: string, expected: number, expectedDraftId: string | undefined): Promise<void> {
    const db = await this.open()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('drafts', 'readwrite'), store = tx.objectStore('drafts')
      const read = store.get(owner)
      let conflict = false
      read.onsuccess = () => { if ((read.result?.revision ?? 0) !== expected || read.result?.draftId !== expectedDraftId) { conflict = true; tx.abort() } else store.delete(owner) }
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(conflict ? new DraftConflict() : tx.error)
      tx.onerror = () => reject(tx.error)
    })
  }
}

/** Drafts may be incomplete; use the same field limits, but allow blank names/title and zero items. */
export function parseDraftImport(value: unknown, owner: string): RankingDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('草稿格式无效')
  const draft = value as RankingDraft
  if (draft.schemaVersion !== 1 || !['create', 'derive', 'update'].includes(draft.intent)) throw new Error('不支持的草稿版本')
  if (draft.owner !== owner && draft.owner !== 'anonymous') throw new Error('这是另一账号的草稿，请使用原账号恢复')
  requireId(draft.draftId)
  const p = draft.payload
  if (!p || p.schemaVersion !== 1 || !Array.isArray(p.items) || p.items.length > 100) throw new Error('草稿内容格式无效')
  const texts: [unknown, number][] = [[p.title, 80], [p.description, 1000], [p.changeNote ?? '', 500]]
  const ids = new Set<string>()
  for (const item of p.items) {
    requireId(item.itemId)
    if (ids.has(item.itemId)) throw new Error('草稿条目编号重复')
    ids.add(item.itemId)
    texts.push([item.name, 120], [item.note ?? '', 500])
  }
  if (texts.some(([text, max]) => typeof text !== 'string' || [...text].length > max)) throw new Error('草稿文字超出长度限制')
  // Validate references and category with the submission schema without changing incomplete text.
  validateSubmissionInput({ requestId: draft.draftId, rankingId: draft.rankingId, baseVersionId: draft.baseVersionId, derivedFrom: draft.derivedFrom,
    payload: { ...p, title: p.title.trim() || '草稿', items: p.items.length ? p.items.map(item => ({ ...item, name: item.name.trim() || '未命名' })) : [{ itemId: crypto.randomUUID(), name: '未命名' }] } }, false)
  if (!Number.isSafeInteger(draft.contentRevision) || draft.contentRevision < 0) throw new Error('草稿修订号无效')
  if (draft.pending) {
    if (draft.owner !== owner) throw new Error('未确认的投稿只能由原账号恢复')
    validateSubmissionInput(draft.pending.request, false)
    if (!Number.isSafeInteger(draft.pending.contentRevision)) throw new Error('投稿快照无效')
  }
  if (draft.submitted) { requireId(draft.submitted.id); requireId(draft.submitted.rankingId) }
  return { schemaVersion: 1, draftId: draft.draftId, owner, intent: draft.intent, payload: structuredClone(p), revision: 0,
    contentRevision: draft.contentRevision, updatedAt: new Date().toISOString(),
    ...(draft.rankingId ? { rankingId: draft.rankingId } : {}), ...(draft.baseVersionId ? { baseVersionId: draft.baseVersionId } : {}),
    ...(draft.derivedFrom ? { derivedFrom: structuredClone(draft.derivedFrom) } : {}),
    ...(draft.pending ? { pending: structuredClone(draft.pending) } : {}), ...(draft.submitted ? { submitted: structuredClone(draft.submitted) } : {}) }
}
