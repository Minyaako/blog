import { describe, expect, it } from 'vitest'
import { resolvePostContentBase } from '../../src/lib/content-source'

describe('post content source', () => {
  it('keeps production content empty-capable by default', () => {
    expect(resolvePostContentBase({})).toBe('./src/content/posts')
  })

  it('uses isolated article fixtures only for explicit browser checks', () => {
    expect(resolvePostContentBase({ BLOG_E2E_FIXTURES: 'true' })).toBe('./tests/fixtures/posts')
    expect(resolvePostContentBase({ BLOG_E2E_FIXTURES: 'false' })).toBe('./src/content/posts')
  })

  it('uses a dedicated empty source only for empty-state browser checks', () => {
    expect(resolvePostContentBase({ BLOG_E2E_EMPTY_CONTENT: 'true' })).toBe('./tests/fixtures/empty-posts')
  })
})
