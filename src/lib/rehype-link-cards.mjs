import { readFileSync } from 'node:fs'
import lucide from '@iconify-json/lucide/icons.json' with { type: 'json' }
import simpleIcons from '@iconify-json/simple-icons/icons.json' with { type: 'json' }
import { identifyLink, getLinkMetadata } from './link-card-metadata.mjs'
import { parseLinkCardSource } from './link-card-overrides.mjs'

const element = (tagName, properties, children = []) => ({ type: 'element', tagName, properties, children })
const text = (value) => ({ type: 'text', value: String(value) })
const span = (className, value) => element('span', { className: [className] }, [text(value)])

const statIcons = { Stars: 'star', Forks: 'git-fork', '播放': 'eye', '点赞': 'thumbs-up' }

function cardIcon(name) {
  // Trusted installed icons only. These icons contain paths/circles that share
  // Lucide's common stroke; no external SVG or raw HTML enters the tree.
  const brand = ['github', 'youtube', 'bilibili', 'zhihu'].includes(name)
  const body = brand ? simpleIcons.icons[name].body : lucide.icons[name].body
  const shapes = [...body.matchAll(/<(path|circle)\b([^>]*?)\/>/gu)].map(([, tag, attributes]) => {
    const properties = {}
    for (const [, key, value] of attributes.matchAll(/\b(d|cx|cy|r)="([^"]*)"/gu)) properties[key] = value
    return element(tag, properties)
  })
  return element('svg', {
    viewBox: '0 0 24 24', width: 16, height: 16, fill: brand ? 'currentColor' : 'none',
    stroke: brand ? 'none' : 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
    ariaHidden: 'true', focusable: 'false', 'data-link-card-icon': name
  }, shapes)
}

// Only a URL occupying an entire paragraph opts in; named links stay links.
export function standaloneUrl(node) {
  if (node.type !== 'element' || node.tagName !== 'p') return null
  const children = node.children.filter((child) => !(child.type === 'text' && !child.value.trim()))
  if (children.length !== 1) return null
  const child = children[0]
  if (child.type === 'text') return /^https?:\/\/\S+$/.test(child.value.trim()) ? child.value.trim() : null
  if (child.type !== 'element' || child.tagName !== 'a' || child.children.length !== 1) return null
  const label = child.children[0]
  return label.type === 'text' && label.value.trim() === child.properties?.href ? child.properties.href : null
}

function cardSource(node, file) {
  if (node.type !== 'element' || node.tagName !== 'p') return null
  const start = node.position?.start?.offset
  const end = node.position?.end?.offset
  // Use the authored paragraph so Markdown emphasis/autolinks inside quoted
  // values are not mistaken for formatting or fetched as additional links.
  const source = typeof file?.value === 'string' && Number.isInteger(start) && Number.isInteger(end)
    ? file.value.slice(start, end)
    : node.children.map((child) => {
      if (child.type === 'text') return child.value
      if (child.type === 'element' && child.tagName === 'a' && child.children.length === 1 &&
        child.children[0].type === 'text' && child.children[0].value === child.properties?.href) return child.children[0].value
      return '\u0000'
    }).join('')
  const parsed = parseLinkCardSource(source)
  if (parsed) return parsed
  if (/^\s*https?:\/\//u.test(source)) return null
  const url = standaloneUrl(node)
  return url ? { url, overrides: {} } : null
}

export function renderLinkCard(link, metadata) {
  const body = [element('span', { className: ['link-card__identity'] }, [
    span('link-card__platform', link.label),
    span('link-card__kind', link.provider === 'github' ? '开源项目' : link.provider === 'zhihu' ? '文章' : '视频'),
    element('span', { className: ['link-card__arrow'], ariaHidden: 'true' }, [text('↗')])
  ]), span('link-card__title', metadata.title || link.id)]
  if (metadata.description) body.push(span('link-card__description', metadata.description))
  const details = []
  if (metadata.author) details.push(span('link-card__author', metadata.author))
  for (const stat of metadata.stats || []) {
    if (!Number.isFinite(stat.value) || stat.value < 0 || !statIcons[stat.label]) continue
    const value = new Intl.NumberFormat('zh-CN').format(stat.value)
    details.push(element('span', {
      className: ['link-card__stat'], role: 'img', ariaLabel: `${stat.label} ${value}`, title: `${stat.label} ${value}`
    }, [cardIcon(statIcons[stat.label]), text(value)]))
  }
  if (details.length) body.push(element('span', { className: ['link-card__details'] }, details))
  const url = new URL(link.url)
  const footer = [element('span', { className: ['link-card__url'], title: link.url }, [text(url.hostname.replace(/^www\./u, ''))])]
  if (metadata.stats?.length && metadata.fetchedAt) footer.push(element('time', {
    className: ['link-card__updated'], dateTime: metadata.fetchedAt, title: `数据更新于 ${metadata.fetchedAt.slice(0, 10)}`
  }, [text(`${metadata.fetchedAt.slice(5, 10)} 更新`)]))
  body.push(element('span', { className: ['link-card__footer'] }, footer))
  const children = [element('span', { className: ['link-card__brand'], ariaHidden: 'true' }, [cardIcon(link.provider)]),
    element('span', { className: ['link-card__body'] }, body)]
  if (metadata.image) children.push(element('span', { className: ['link-card__media'], ariaHidden: 'true' }, [
    element('img', { src: metadata.image, alt: '', loading: 'lazy', decoding: 'async', width: 320, height: 180, referrerPolicy: 'no-referrer' })
  ]))
  return element('a', {
    className: ['link-card'], href: link.url, target: '_blank', rel: ['noopener', 'noreferrer'],
    'data-link-card': link.provider, 'data-has-cover': String(Boolean(metadata.image)),
    ariaLabel: `${metadata.title || link.id} · ${link.label}（新窗口打开）`
  }, children)
}

function fixtureResolver() {
  if (process.env.BLOG_E2E_FIXTURES !== 'true' && process.env.BLOG_MOMENT_FIXTURES !== 'true') return null
  const fixtures = JSON.parse(readFileSync(new URL('../../tests/fixtures/link-card-metadata.json', import.meta.url), 'utf8'))
  return async (link) => fixtures[link.url] || { title: link.id }
}

export default function rehypeLinkCards(options = {}) {
  const resolve = options.resolveMetadata || fixtureResolver() || getLinkMetadata
  return async (tree, file = {}) => {
    const pending = []
    function walk(parent) {
      if (!parent.children || ['a', 'pre', 'code', 'blockquote', 'li', 'script', 'style'].includes(parent.tagName)) return
      if (parent.type === 'mdxJsxFlowElement' || parent.type === 'mdxJsxTextElement') return
      parent.children.forEach((node, index) => {
        const source = cardSource(node, file)
        const link = source && identifyLink(source.url)
        if (link) pending.push((async () => {
          let metadata
          try { metadata = await resolve(link) } catch { metadata = { title: link.id } }
          parent.children[index] = renderLinkCard(link, { ...metadata, ...source.overrides })
        })())
        else walk(node)
      })
    }
    walk(tree)
    await Promise.all(pending)
  }
}
