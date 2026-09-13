import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import rehypeLinkCards, { renderLinkCard } from '../../src/lib/rehype-link-cards.mjs'
import { getLinkMetadata, identifyLink } from '../../src/lib/link-card-metadata.mjs'

type HastNode = {
  type: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
  position?: { start: { offset: number }; end: { offset: number } }
}

const text = (value: string): HastNode => ({ type: 'text', value })
const element = (tagName: string, properties: Record<string, unknown> = {}, children: HastNode[] = []): HastNode => ({
  type: 'element', tagName, properties, children
})
const paragraph = (...children: HastNode[]): HastNode => element('p', {}, children)
const root = (...children: HastNode[]): HastNode => ({ type: 'root', children })
const githubUrl = 'https://github.com/astro-build/astro'

function textContent(node: HastNode): string {
  return node.type === 'text' ? node.value ?? '' : (node.children ?? []).map(textContent).join('')
}

function elementsWithClass(node: HastNode, className: string): HastNode[] {
  const classes = node.properties?.className
  const matches = Array.isArray(classes) && classes.includes(className) ? [node] : []
  return matches.concat((node.children ?? []).flatMap((child) => elementsWithClass(child, className)))
}

describe('rehype link cards', () => {
  it('reads quoted overrides from the authored paragraph and preserves unspecified automatic fields', async () => {
    const source = `${githubUrl} [title="A *B* & C" description="" image="/images/posts/life-cover.svg"]`
    const node = paragraph(element('a', { href: githubUrl }, [text(githubUrl)]), text(' [title="A '), element('em', {}, [text('B')]), text('* & C"]'))
    node.position = { start: { offset: 0 }, end: { offset: source.length } }
    const tree = root(node)
    const automatic = { title: 'Automatic', description: 'Automatic description', author: 'Upstream', stats: [{ label: 'Stars', value: 10 }] }
    await rehypeLinkCards({ resolveMetadata: async () => automatic })(tree, { value: source })
    const card = tree.children![0]
    expect(textContent(elementsWithClass(card, 'link-card__title')[0])).toBe('A *B* & C')
    expect(elementsWithClass(card, 'link-card__description')).toHaveLength(0)
    expect(textContent(elementsWithClass(card, 'link-card__author')[0])).toBe('Upstream')
    expect(elementsWithClass(card, 'link-card__stat')[0].properties?.ariaLabel).toBe('Stars 10')
    expect(elementsWithClass(card, 'link-card__media')[0].children?.[0].properties?.src).toBe('/images/posts/life-cover.svg')
    expect(automatic.title).toBe('Automatic')
  })

  it('keeps manual metadata usable after fetch failure and leaves malformed syntax visible', async () => {
    const malformed = `${githubUrl} [title="Missing end]`
    const tree = root(paragraph(text(`${githubUrl} [title="My repository" image=""]`)), paragraph(text(malformed)))
    await rehypeLinkCards({ resolveMetadata: async () => { throw new Error('offline') } })(tree)
    expect(textContent(elementsWithClass(tree, 'link-card__title')[0])).toBe('My repository')
    expect(elementsWithClass(tree, 'link-card__brand')).toHaveLength(1)
    expect(tree.children![1].tagName).toBe('p')
    expect(textContent(tree.children![1])).toBe(malformed)
  })

  it('does not hide malformed metadata embedded after a URL fragment', async () => {
    const source = `${githubUrl}#readme[typo="wrong"]`
    const tree = root(paragraph(text(source)))
    await rehypeLinkCards({ resolveMetadata: async () => ({ title: 'Should not replace authored text' }) })(tree)
    expect(tree.children![0].tagName).toBe('p')
    expect(textContent(tree)).toBe(source)
  })

  it('converts bare URLs and exact autolinks for all supported platforms', async () => {
    const urls = [
      'https://github.com/astro-build/astro',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.bilibili.com/video/BV1xx411c7mD/',
      'https://zhuanlan.zhihu.com/p/123456'
    ]
    const tree = root(
      paragraph(text(urls[0])),
      paragraph(element('a', { href: urls[1] }, [text(urls[1])])),
      paragraph(text(urls[2])),
      paragraph(element('a', { href: urls[3] }, [text(urls[3])]))
    )

    await rehypeLinkCards({
      resolveMetadata: async (link: { label: string }) => ({ title: `${link.label} 示例` })
    })(tree)

    expect(tree.children?.map((node) => node.properties?.['data-link-card'])).toEqual([
      'github', 'youtube', 'bilibili', 'zhihu'
    ])
    expect(tree.children?.every((node) => node.tagName === 'a')).toBe(true)
  })

  it('leaves inline, named, code, list, blockquote, and unsupported links unchanged', async () => {
    const supported = 'https://github.com/astro-build/astro'
    const tree = root(
      paragraph(text('前缀 '), text(supported), text(' 后缀')),
      paragraph(element('a', { href: supported }, [text('Astro 源码仓库')])),
      element('pre', {}, [element('code', {}, [text(supported)])]),
      element('ul', {}, [element('li', {}, [text(supported)])]),
      element('blockquote', {}, [paragraph(text(supported))]),
      paragraph(text('https://example.com/not-a-supported-card'))
    )

    await rehypeLinkCards({ resolveMetadata: async () => ({ title: '不应渲染' }) })(tree)

    expect(elementsWithClass(tree, 'link-card')).toHaveLength(0)
    expect(textContent(tree)).toContain('Astro 源码仓库')
    expect(textContent(tree)).toContain('https://example.com/not-a-supported-card')
    expect((tree.children?.[2].children?.[0].children?.[0].value)).toBe(supported)
  })

  it('falls back to the stable link id when metadata resolution fails', async () => {
    const tree = root(paragraph(text('https://github.com/astro-build/astro')))

    await rehypeLinkCards({
      resolveMetadata: async () => { throw new Error('resolver unavailable') }
    })(tree)

    const card = tree.children?.[0]
    expect(card?.properties?.['data-link-card']).toBe('github')
    expect(textContent(card!)).toContain('astro-build/astro')
  })

  it('keeps metadata as text and renders zero while omitting invalid stats', () => {
    const link = identifyLink(githubUrl)
    if (!link) throw new Error('Expected the GitHub fixture URL to be supported')
    const unsafe = '<strong>metadata</strong>'
    const card = renderLinkCard(link, {
      title: unsafe,
      description: unsafe,
      author: unsafe,
      stats: [
        { label: 'Stars', value: 0 },
        { label: 'Forks', value: undefined },
        { label: 'Forks', value: 12 },
        { label: 'Stars', value: -1 },
        { label: 'Stars', value: Number.NaN },
        { label: '点赞', value: 0 }
      ],
      fetchedAt: '2026-09-01T00:00:00.000Z'
    })

    for (const className of ['link-card__title', 'link-card__description', 'link-card__author']) {
      const field = elementsWithClass(card, className)[0]
      expect(field?.children).toEqual([{ type: 'text', value: unsafe }])
    }
    expect(elementsWithClass(card, 'link-card__stat').map(textContent)).toEqual([
      '0', '12', '0'
    ])
    expect(elementsWithClass(card, 'link-card__stat').map((stat) => (
      stat.properties?.ariaLabel ?? stat.properties?.title
    ))).toEqual(['Stars 0', 'Forks 12', '点赞 0'])
    for (const stat of elementsWithClass(card, 'link-card__stat')) {
      const icon = stat.children?.find((child) => child.tagName === 'svg')
      expect(icon?.properties?.ariaHidden).toBe('true')
    }
    expect(elementsWithClass(card, 'link-card__brand')).toHaveLength(1)
    expect(elementsWithClass(card, 'link-card__brand')[0].children?.[0].properties?.['data-link-card-icon']).toBe('github')
    expect(elementsWithClass(card, 'link-card__media')).toHaveLength(0)
  })

  it('renders an actual cover image when safe metadata supplies one', () => {
    const link = identifyLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    if (!link) throw new Error('Expected the YouTube fixture URL to be supported')
    const card = renderLinkCard(link, {
      title: '示例视频',
      image: '/images/posts/engineering-cover.svg'
    })

    const media = elementsWithClass(card, 'link-card__media')[0]
    expect(elementsWithClass(card, 'link-card__media--fallback')).toHaveLength(0)
    expect(media.children?.[0].tagName).toBe('img')
    expect(media.children?.[0].properties).toMatchObject({ loading: 'lazy', decoding: 'async' })
  })
})

describe('GitHub link metadata covers', () => {
  it('does not turn the REST owner avatar into a repository cover', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'minyako-link-card-'))
    try {
      const link = identifyLink(githubUrl)
      if (!link) throw new Error('Expected the GitHub fixture URL to be supported')
      const metadata = await getLinkMetadata(link, {
        cacheDir,
        now: Date.parse('2026-09-10T00:00:00.000Z'),
        offline: false,
        fetch: async () => new Response(JSON.stringify({
          full_name: 'astro-build/astro',
          description: 'Astro repository',
          owner: {
            login: 'withastro',
            avatar_url: 'https://avatars.githubusercontent.com/u/123456?v=4'
          },
          stargazers_count: 0,
          forks_count: 0
        }), { status: 200 })
      })

      expect(metadata).not.toHaveProperty('image')
      expect(metadata.stats).toEqual([
        { label: 'Stars', value: 0 },
        { label: 'Forks', value: 0 }
      ])
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('keeps an Open Graph GitHub cover while sanitizing cached avatar covers', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'minyako-link-card-'))
    try {
      const link = identifyLink(githubUrl)
      if (!link) throw new Error('Expected the GitHub fixture URL to be supported')
      const now = Date.parse('2026-09-10T00:00:00.000Z')
      const identity = `${link.provider}:${link.id}`
      const key = createHash('sha256').update(`v1:${identity}:false`).digest('hex')
      const cachePath = join(cacheDir, `${key}.json`)
      const writeCache = async (image: string) => writeFile(cachePath, JSON.stringify({
        version: 1,
        identity,
        checkedAt: now - 1_000,
        metadata: { title: 'Astro', image }
      }))

      await writeCache('https://opengraph.githubassets.com/1/astro-build/astro')
      await expect(getLinkMetadata(link, { cacheDir, now, offline: false })).resolves.toMatchObject({
        image: 'https://opengraph.githubassets.com/1/astro-build/astro'
      })

      await writeCache('https://avatars.githubusercontent.com/u/123456?v=4')
      const sanitized = await getLinkMetadata(link, { cacheDir, now, offline: false })
      expect(sanitized).not.toHaveProperty('image')
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })
})
