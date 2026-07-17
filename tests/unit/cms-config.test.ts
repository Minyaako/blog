import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

describe('Sveltia tag relation', () => {
  it('stores stable ids while searching labels, ids, and aliases', () => {
    const config = parse(readFileSync('public/admin/config.yml', 'utf8'))
    const tags = config.collections.find((collection: { name: string }) => collection.name === 'tags')
    const posts = config.collections.find((collection: { name: string }) => collection.name === 'posts')
    const field = posts.fields.find((item: { name: string }) => item.name === 'tags')

    expect(tags.folder).toBe('src/content/tags')
    expect(tags.format).toBe('json')
    expect(field).toMatchObject({
      widget: 'relation',
      collection: 'tags',
      multiple: true,
      value_field: 'id',
      display_fields: ['label', 'id'],
      search_fields: ['label', 'id', 'aliases']
    })
  })
})
