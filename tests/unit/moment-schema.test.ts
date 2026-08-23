import { describe, expect, it } from 'vitest'
import { validateMomentEntries } from '../../src/lib/moments'
import { momentSchema } from '../../src/schemas/moment'

const validMoment = {
  id: '20260823-143501-a7c31e4f',
  publishedAt: '2026-08-23T14:35:01+08:00',
  tags: ['life-notes'],
  pinned: false,
  contentWarning: ''
}

const entry = (filename: string, data = validMoment, body = '正文') => ({
  id: filename,
  body,
  data
})

describe('moment schema', () => {
  it('accepts a valid untitled moment with an explicit timezone', () => {
    const parsed = momentSchema.parse(validMoment)
    expect(parsed.id).toBe(validMoment.id)
    expect(parsed.title).toBeUndefined()
    expect(parsed.contentWarning).toBeUndefined()
  })

  it('rejects malformed ids', () => {
    expect(() => momentSchema.parse({ ...validMoment, id: '2026-08-23-bad' }))
      .toThrow()
  })

  it('rejects publishedAt values without an explicit time zone', () => {
    expect(() => momentSchema.parse({ ...validMoment, publishedAt: '2026-08-23T14:35:01' }))
      .toThrow(/time zone/i)
  })

  it.each([
    ['2026-02-29T14:35:01+08:00', false],
    ['2028-02-29T14:35:01+08:00', true],
    ['2026-02-30T14:35:01+08:00', false],
    ['2026-04-31T14:35:01+08:00', false],
    ['2026-08-23T24:00:00+08:00', false],
    ['2026-08-23T14:35:01.1+08:00', true],
    ['2026-08-23T14:35:01.123+08:00', true],
    ['2026-08-23T14:35:01.123456789Z', true],
    ['2026-08-23T14:35:01+14:00', true],
    ['2026-08-23T14:35:01-14:00', true],
    ['2026-08-23T14:35:01+14:30', false],
    ['2026-08-23T14:35:01-14:30', false],
    ['2026-08-23T14:35:01+15:00', false],
    ['2026-08-23T14:35:01-15:00', false],
    ['2026-08-23T14:35:01+23:59', false],
    ['2026-08-23T14:35:01.+08:00', false],
    ['2026-08-23T14:35:01.a+08:00', false],
    ['2026-08-23T14:35:01.12a+08:00', false],
    ['2026-08-23T14:35.1:01+08:00', false],
    ['2026-08-23T14:35:01Z', true],
  ])('enforces the shared explicit timezone boundary for %s', (publishedAt, valid) => {
    const parse = () => momentSchema.parse({ ...validMoment, publishedAt })
    if (valid) expect(parse).not.toThrow()
    else expect(parse).toThrow(/time zone/i)
  })

  it('rejects non-boolean pinned values', () => {
    expect(() => momentSchema.parse({ ...validMoment, pinned: 'false' }))
      .toThrow(/boolean/i)
  })

  it('rejects filename and frontmatter id mismatches during entry validation', () => {
    expect(() => validateMomentEntries([
      entry('20260823-143502-a7c31e4f.mdx')
    ])).toThrow(/filename.*id/i)
  })

  it('rejects unknown tag ids during entry validation', () => {
    expect(() => validateMomentEntries([
      entry(`${validMoment.id}.mdx`, { ...validMoment, tags: ['missing-tag'] })
    ])).toThrow(/Unknown tag: missing-tag/)
  })

  it('rejects whitespace-only bodies during entry validation', () => {
    expect(() => validateMomentEntries([
      entry(`${validMoment.id}.mdx`, validMoment, '   ')
    ])).toThrow(/body/i)
  })
})
