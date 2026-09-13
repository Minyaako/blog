import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { rankingDiff, validateRankingPayload, validateSubmissionInput, type RankingPayload } from '../../src/lib/ranking'

const payload = (): RankingPayload => ({ schemaVersion: 1, title: '我的游戏榜', description: '', categoryId: 'games', items: [
  { itemId: randomUUID(), name: '作品甲' }, { itemId: randomUUID(), name: '作品乙', note: '说明' },
] })

describe('ranking content contract', () => {
  it('normalizes text and strips untrusted ownership and publication fields', () => {
    const value = payload()
    const parsed = validateSubmissionInput({ requestId: randomUUID(), ownerId: 'pretend-admin', payload: { ...value, title: ' 标题 ', publishedAt: 'forged' } })
    expect(parsed.payload.title).toBe('标题')
    expect(parsed).not.toHaveProperty('ownerId')
    expect(parsed.payload).not.toHaveProperty('publishedAt')
  })
  it('retains plain markup as text rather than granting it special content semantics', () => {
    const value = payload()
    value.items[0].name = '<img src=x onerror=alert(1)>'
    expect(validateRankingPayload(value).items[0].name).toBe(value.items[0].name)
  })
  it('bounds Unicode code points and requires actual items and available categories', () => {
    expect(() => validateRankingPayload({ ...payload(), title: '😀'.repeat(80) })).not.toThrow()
    expect(() => validateRankingPayload({ ...payload(), title: '😀'.repeat(81) })).toThrow()
    expect(() => validateRankingPayload({ ...payload(), items: [] })).toThrow()
    expect(() => validateRankingPayload({ ...payload(), categoryId: 'disabled' })).toThrow()
    const value = payload()
    expect(() => validateRankingPayload({ ...value, items: [value.items[0], value.items[0]] })).toThrow()
  })
  it('keeps source and update intent unambiguous', () => {
    expect(() => validateSubmissionInput({ requestId: randomUUID(), baseVersionId: randomUUID(), payload: payload() })).toThrow()
    expect(() => validateSubmissionInput({ requestId: randomUUID(), rankingId: randomUUID(), baseVersionId: randomUUID(),
      derivedFrom: { rankingId: randomUUID(), versionId: randomUUID() }, payload: payload() })).toThrow()
  })
  it('compares stable item IDs across moves and renames without inventing additions', () => {
    const before = payload()
    const after = { ...before, items: [{ ...before.items[1], name: '作品乙新版' }, before.items[0]] }
    const diff = rankingDiff(before, after)
    expect(diff.some(line => line.includes('第 2 → 1 名'))).toBe(true)
    expect(diff.some(line => line.includes('改名'))).toBe(true)
    expect(diff.some(line => line.includes('新增') || line.includes('移除'))).toBe(false)
    expect(rankingDiff(before, before)).toEqual(['榜单内容未改变'])
  })
})
