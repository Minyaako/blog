import { describe, expect, it } from 'vitest'
import { buildTagRegistry, getAllTags, getPostTags, getTag } from '../../src/lib/tags'

const source = (id: string, label: string, aliases: string[] = []) => ({
  filename: `${id}.json`,
  data: { id, label, aliases, description: `${label} description` }
})

describe('tag registry', () => {
  it('provides the fixed public lookup APIs', () => {
    expect(getTag('visual-novel').label).toBe('视觉小说')
    expect(getAllTags().map((tag) => tag.id)).toEqual(expect.arrayContaining(['embodied-ai', 'visual-novel', 'astro']))
    expect(getPostTags({ tags: ['visual-novel'] })[0]?.aliases).toEqual(['VN', 'Galgame'])
  })

  it('requires the filename to equal the stable id', () => {
    expect(() => buildTagRegistry([{ ...source('astro', 'Astro'), filename: 'renamed.json' }]))
      .toThrow('Tag filename must equal id')
  })

  it('rejects duplicate ids, labels, and case-normalized aliases', () => {
    expect(() => buildTagRegistry([source('one', 'One'), source('one', 'Two')])).toThrow('Duplicate tag id')
    expect(() => buildTagRegistry([source('one', 'Same'), source('two', 'same')])).toThrow('Duplicate tag label')
    expect(() => buildTagRegistry([source('one', 'One', ['VN']), source('two', 'Two', ['vn'])])).toThrow('Duplicate tag label or alias')
    expect(() => buildTagRegistry([source('one', 'One', ['Two']), source('two', 'two')])).toThrow('Duplicate tag label')
  })

  it('rejects malformed and unknown ids', () => {
    expect(() => buildTagRegistry([source('Bad_ID', 'Bad')])).toThrow('Tag id must use lowercase')
    expect(() => getTag('missing-tag')).toThrow('Unknown tag: missing-tag')
    expect(() => getPostTags({ tags: ['missing-tag'] })).toThrow('Unknown tag: missing-tag')
  })
})
