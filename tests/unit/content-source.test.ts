import { describe, expect, it } from 'vitest'
import {
  clearCollectionBeforeLoad,
  generateMomentContentId,
  resolveMomentContentBase,
  resolvePostContentBase,
} from '../../src/lib/content-source'

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

  it('keeps production moments empty-capable by default and enables moment fixtures only under an explicit env flag', () => {
    expect(resolveMomentContentBase({})).toBe('./src/content/moments')
    expect(resolveMomentContentBase({ BLOG_MOMENT_FIXTURES: 'true' })).toBe('./tests/fixtures/moments')
    expect(resolveMomentContentBase({ BLOG_MOMENT_FIXTURES: 'false' })).toBe('./src/content/moments')
  })

  it('uses an isolated empty moment source before any populated fixture source', () => {
    expect(resolveMomentContentBase({ BLOG_E2E_EMPTY_CONTENT: 'true' })).toBe('./tests/fixtures/empty-moments')
    expect(resolveMomentContentBase({
      BLOG_E2E_EMPTY_CONTENT: 'true',
      BLOG_MOMENT_FIXTURES: 'true',
    })).toBe('./tests/fixtures/empty-moments')
  })

  it('derives the exact top-level moment id from a fixture or content filename', () => {
    expect(generateMomentContentId('20260823-143501-a7c31e4f.mdx')).toBe('20260823-143501-a7c31e4f')
  })

  it.each([
    'nested/20260823-143501-a7c31e4f.mdx',
    '20260823-143501-a7c31e4f.md',
    'bad-id.mdx',
  ])('rejects non-top-level or malformed moment content filenames: %s', (entry) => {
    expect(() => generateMomentContentId(entry)).toThrow(/top-level|mdx|id/i)
  })

  it('clears persisted collection entries before syncing a different moment source', async () => {
    const calls: string[] = []
    const loader = clearCollectionBeforeLoad({
      name: 'glob-loader',
      async load(_context: { store: { clear(): void } }) {
        calls.push('load')
      },
    })

    await loader.load({
      store: {
        clear() {
          calls.push('clear')
        },
      },
    })

    expect(calls).toEqual(['clear', 'load'])
  })
})
