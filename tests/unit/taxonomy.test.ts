import { describe, expect, it } from 'vitest'
import { DOMAINS, getSubcategory } from '../../src/config/taxonomy'

describe('taxonomy', () => {
  it('defines four first-class domains', () => {
    expect(Object.keys(DOMAINS)).toEqual(['academic', 'engineering', 'life', 'games'])
  })

  it('resolves configured subcategories for every domain', () => {
    expect(getSubcategory('academic', 'paper-reading').label).toBe('论文阅读')
    expect(getSubcategory('engineering', 'devlogs').label).toBe('开发日志')
    expect(getSubcategory('life', 'journals').label).toBe('生活札记')
    expect(getSubcategory('games', 'gallery').label).toBe('图集')
  })

  it('rejects a subcategory from the wrong domain', () => {
    expect(() => getSubcategory('life', 'gallery')).toThrow('Unknown subcategory')
  })
})
