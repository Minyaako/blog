import { COMMENT_SERVER_URL } from './waline-config'

export const MOMENT_REACTIONS = [
  { emoji: '👍', label: '赞' }, { emoji: '❤️', label: '喜欢' },
  { emoji: '😆', label: '开心' }, { emoji: '😮', label: '惊讶' },
  { emoji: '🤔', label: '思考' }, { emoji: '🎉', label: '庆祝' }
] as const
export const REACTION_TYPES = MOMENT_REACTIONS.map((_, index) => `reaction${index}`)
export const reactionStorageKey = (id: string) => `minyako:moment-reaction:v1:${id}`
export type ReactionStorage = Pick<Storage, 'getItem' | 'setItem'>
export interface ReactionRecord { selected: number | null; pending: boolean }
export class ReactionRejected extends Error {}

function validIndex(index: unknown): index is number {
  return typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < MOMENT_REACTIONS.length
}

export function readReactionRecord(storage: ReactionStorage, id: string): ReactionRecord {
  const raw = storage.getItem(reactionStorageKey(id))
  if (raw === null) return { selected: null, pending: false }
  const value: unknown = JSON.parse(raw)
  if (!value || typeof value !== 'object' || !('selected' in value) || !('pending' in value)
    || (value.selected !== null && !validIndex(value.selected)) || typeof value.pending !== 'boolean') {
    throw new Error('Invalid saved reaction')
  }
  return { selected: value.selected as number | null, pending: value.pending }
}

function saveRecord(storage: ReactionStorage, id: string, record: ReactionRecord) {
  storage.setItem(reactionStorageKey(id), JSON.stringify(record))
}

async function readResult(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) throw new Error('Reaction service unavailable')
  const result: unknown = await response.json()
  if (result && typeof result === 'object' && 'errno' in result && typeof result.errno === 'number' && result.errno !== 0) {
    throw new ReactionRejected('Reaction rejected by server')
  }
  if (!result || typeof result !== 'object' || !('errno' in result) || result.errno !== 0
    || !('data' in result) || !Array.isArray(result.data) || result.data.length !== 1
    || !result.data[0] || typeof result.data[0] !== 'object') throw new Error('Invalid reaction response')
  return result.data[0] as Record<string, unknown>
}

function readCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid reaction count')
  return value
}

export async function getMomentReactions(id: string, signal: AbortSignal, request: typeof fetch = fetch): Promise<number[]> {
  const query = new URLSearchParams({ path: id, type: REACTION_TYPES.join(','), lang: 'zh-CN' })
  const result = await readResult(await request(`${COMMENT_SERVER_URL}/api/article?${query}`, { credentials: 'omit', signal }))
  return REACTION_TYPES.map(type => readCount(result[type]))
}

export async function updateMomentReaction(id: string, index: number, action: 'inc' | 'desc', request: typeof fetch = fetch): Promise<number> {
  if (!validIndex(index)) throw new Error('Invalid reaction index')
  // Do not abort a sent write on navigation, or automatically retry an uncertain POST.
  const result = await readResult(await request(`${COMMENT_SERVER_URL}/api/article?lang=zh-CN`, {
    method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: id, type: REACTION_TYPES[index], action }),
    signal: AbortSignal.timeout(8000)
  }))
  return readCount(result[REACTION_TYPES[index]!])
}

export interface ReactionState {
  counts: number[] | null
  selected: number | null
  phase: 'loading' | 'ready' | 'saving' | 'error' | 'uncertain' | 'unavailable'
  message: string
}
export interface ReactionDependencies {
  storage: ReactionStorage
  read(id: string, signal: AbortSignal): Promise<number[]>
  update(id: string, index: number, action: 'inc' | 'desc'): Promise<number>
}

/** Waline's counters are anonymous. Only this browser's last confirmed choice is saved. */
export class MomentReactionController {
  state: ReactionState = { counts: null, selected: null, phase: 'loading', message: '正在读取回应…' }
  private listeners = new Set<() => void>()
  private loadVersion = 0
  constructor(readonly id: string, private dependencies: ReactionDependencies) {}
  subscribe(listener: () => void) { this.listeners.add(listener); listener(); return () => { this.listeners.delete(listener) } }
  private emit() { this.listeners.forEach(listener => listener()) }

  async load(signal: AbortSignal) {
    if (this.state.phase === 'saving') return
    const version = ++this.loadVersion
    let record: ReactionRecord
    try {
      record = readReactionRecord(this.dependencies.storage, this.id)
      // Confirm storage is writable before ever allowing a server mutation.
      saveRecord(this.dependencies.storage, this.id, record)
      this.state.selected = record.selected
    } catch {
      this.state.phase = 'unavailable'
      this.state.message = '本机记录不可用，暂不能回应；仍可查看累计数量。'
      this.emit()
      try {
        const counts = await this.dependencies.read(this.id, signal)
        if (!signal.aborted && version === this.loadVersion) { this.state.counts = counts; this.emit() }
      } catch { /* Keep the truthful unavailable state. */ }
      return
    }
    this.state.phase = 'loading'
    this.state.message = '正在读取回应…'
    this.emit()
    try {
      const counts = await this.dependencies.read(this.id, signal)
      if (version !== this.loadVersion) return
      if (signal.aborted) {
        if (signal.reason?.name === 'TimeoutError') throw new Error('Reaction read timed out')
        return
      }
      this.state.counts = counts
      this.state.phase = record.pending ? 'uncertain' : 'ready'
      this.state.message = record.pending ? '上次回应结果未确认，暂不能重复提交。' : ''
    } catch {
      if ((signal.aborted && signal.reason?.name !== 'TimeoutError') || version !== this.loadVersion) return
      this.state.phase = 'error'
      this.state.message = '回应暂时没能加载，可以稍后重试。'
    }
    this.emit()
  }

  async choose(index: number) {
    if (!validIndex(index) || this.state.phase !== 'ready' || !this.state.counts) return
    let confirmed: ReactionRecord
    try {
      confirmed = readReactionRecord(this.dependencies.storage, this.id)
      if (confirmed.pending) {
        this.state.phase = 'uncertain'
        this.state.message = '另一个页面的回应结果未确认，请勿重复提交。'
        this.emit()
        return
      }
      saveRecord(this.dependencies.storage, this.id, { ...confirmed, pending: true })
    } catch {
      this.state.phase = 'unavailable'
      this.state.message = '无法保存本机回应记录，尚未提交。'
      this.emit()
      return
    }
    const previous = confirmed.selected
    this.state.phase = 'saving'
    this.state.message = '正在保存回应…'
    this.emit()
    try {
      if (previous !== null) {
        this.state.counts[previous] = await this.dependencies.update(this.id, previous, 'desc')
        confirmed = { selected: null, pending: false }
        this.state.selected = null
        // Preserve this successful first step even if adding the next reaction fails.
        saveRecord(this.dependencies.storage, this.id, confirmed)
      }
      if (previous !== index) {
        saveRecord(this.dependencies.storage, this.id, { ...confirmed, pending: true })
        this.state.counts[index] = await this.dependencies.update(this.id, index, 'inc')
        confirmed = { selected: index, pending: false }
        this.state.selected = index
        saveRecord(this.dependencies.storage, this.id, confirmed)
      }
      this.state.phase = 'ready'
      this.state.message = previous === index ? '已取消回应。' : '回应已送达。'
    } catch (error) {
      if (error instanceof ReactionRejected) {
        try {
          saveRecord(this.dependencies.storage, this.id, confirmed)
          this.state.selected = confirmed.selected
          this.state.phase = 'ready'
          this.state.message = previous !== null && confirmed.selected === null ? '原回应已取消，新的回应未保存，请稍后再试。' : '回应未保存，请稍后再试。'
        } catch {
          this.state.phase = 'uncertain'
          this.state.message = '本机记录保存失败，暂不能重复提交。'
        }
      } else {
        this.state.phase = 'uncertain'
        this.state.message = '回应结果未确认，暂不能重复提交；可刷新累计数量。'
      }
    }
    this.emit()
  }
}
