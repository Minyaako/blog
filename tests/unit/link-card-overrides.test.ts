import { describe, expect, it } from 'vitest'
import { parseLinkCardSource } from '../../src/lib/link-card-overrides.mjs'

const url = 'https://github.com/astro-build/astro'

describe('parseLinkCardSource', () => {
  it('returns a bare URL unchanged without identifying its provider', () => {
    const source = `${url}?tab=readme#section[one]`
    expect(parseLinkCardSource(source)).toEqual({ url: source, overrides: {} })
    expect(parseLinkCardSource(`  ${source}  `)).toEqual({ url: source, overrides: {} })
    expect(parseLinkCardSource('https://unsupported.site/resource')).toEqual({
      url: 'https://unsupported.site/resource', overrides: {}
    })
  })

  it('parses quoted values with optional spaces, commas, and escaped quotes', () => {
    const source = `${url} [title = "自定义 \\"标题\\"", description='简介, 含有 ]' author = "作者"]`
    expect(parseLinkCardSource(source)).toEqual({
      url,
      overrides: { title: '自定义 "标题"', description: '简介, 含有 ]', author: '作者' }
    })
  })

  it('allows empty description and image overrides to clear fetched fields', () => {
    expect(parseLinkCardSource(`${url}[description="" image='']`)).toEqual({
      url, overrides: { description: '', image: '' }
    })
  })

  it.each([
    ['unknown keys', `${url}[stats="100"]`],
    ['duplicate keys', `${url}[title="one" title="two"]`],
    ['unquoted values', `${url}[title=custom]`],
    ['missing equals', `${url}[title "custom"]`],
    ['missing separator', `${url}[title="one"description="two"]`],
    ['trailing comma', `${url}[title="one",]`],
    ['empty block', `${url}[]`],
    ['unterminated quote', `${url}[title="custom]`],
    ['trailing text', `${url}[title="custom"] trailing`],
    ['empty title', `${url}[title=""]`],
    ['blank title', `${url}[title="   "]`]
  ])('rejects %s without silently dropping literal source', (_label, source) => {
    expect(parseLinkCardSource(source)).toBeNull()
  })

  it('preserves brackets in a URL query or fragment when they are not metadata', () => {
    const source = `${url}?q=[literal]&tag=one#part[2]`
    expect(parseLinkCardSource(source)).toEqual({ url: source, overrides: {} })
    expect(parseLinkCardSource(`${url}?ids[]=1`)).toEqual({
      url: `${url}?ids[]=1`, overrides: {}
    })
    expect(parseLinkCardSource(`${url}#readme[title="broken`)).toBeNull()
    expect(parseLinkCardSource(`${url}?feature=share[title="broken`)).toBeNull()
  })

  it('rejects unsupported URL schemes and malformed source boundaries', () => {
    for (const source of [
      'javascript:alert(1)',
      'data:text/plain,hello',
      `${url} trailing`,
      `${url}\n[title="custom"]`
    ]) expect(parseLinkCardSource(source)).toBeNull()
  })

  it('enforces source and field limits without truncating values', () => {
    expect(parseLinkCardSource(`${url}[title="${'a'.repeat(240)}"]`)?.overrides.title).toHaveLength(240)
    expect(parseLinkCardSource(`${url}[title="${'a'.repeat(241)}"]`)).toBeNull()
    expect(parseLinkCardSource(`${url}[description="${'a'.repeat(421)}"]`)).toBeNull()
    expect(parseLinkCardSource(`${url}[author="${'a'.repeat(101)}"]`)).toBeNull()
    expect(parseLinkCardSource(`${url}[image="/${'a'.repeat(2048)}"]`)).toBeNull()
    expect(parseLinkCardSource(`https://unsupported.site/${'a'.repeat(8200)}`)).toBeNull()
  })

  it('accepts safe root images and public HTTPS CDN images', () => {
    expect(parseLinkCardSource(`${url}[image="/images/posts/cover.svg"]`)).toEqual({
      url, overrides: { image: '/images/posts/cover.svg' }
    })
    expect(parseLinkCardSource(`${url}[image="/public/assets/cover.svg"]`)).toEqual({
      url, overrides: { image: '/public/assets/cover.svg' }
    })
    expect(parseLinkCardSource(`${url}[image="https://pic.minyako.top/path/cover.jpg?size=large#top"]`)).toEqual({
      url, overrides: { image: 'https://pic.minyako.top/path/cover.jpg?size=large#top' }
    })
  })

  it.each([
    '//cdn.example.com/cover.jpg',
    'assets/cover.jpg',
    '/images/../secret.jpg',
    '/images/%2e%2e/secret.jpg',
    '/images/path\\cover.jpg',
    'http://cdn.example.com/cover.jpg',
    'javascript:alert(1)',
    'data:image/svg+xml,evil',
    'https://user:pass@cdn.example.com/cover.jpg',
    'https://cdn.example.com:443/cover.jpg',
    'https://127.0.0.1/cover.jpg',
    'https://localhost/cover.jpg',
    'https://images.local/cover.jpg',
    'https://images.internal/cover.jpg',
    'https://images.test/cover.jpg'
  ])('rejects unsafe image %s', (image) => {
    expect(parseLinkCardSource(`${url}[image="${image}"]`)).toBeNull()
  })

  it('rejects unsupported escape sequences instead of interpreting them loosely', () => {
    expect(parseLinkCardSource(`${url}[title="line\\ntext"]`)).toBeNull()
  })
})
