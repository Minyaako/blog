import type { CollectionEntry } from 'astro:content'
import type { DomainKey } from '../config/taxonomy'

export interface PostCover {
  url: string
  alt: string
  credit: string
  sourceUrl?: string
}

export interface PostCardData {
  pageKey: string
  slug: string
  title: string
  description: string
  publishedAt: Date
  domain: DomainKey
  subcategory: string
  tags: string[]
  cover?: PostCover
  protected: boolean
}

export async function getPublishedPosts(): Promise<CollectionEntry<'posts'>[]> {
  const { getCollection } = await import('astro:content')
  const posts = await getCollection('posts', ({ data }) => !data.draft)

  return posts.sort((left, right) => right.data.publishedAt.getTime() - left.data.publishedAt.getTime())
}

export function filterPosts(
  posts: CollectionEntry<'posts'>[],
  domain: DomainKey,
  subcategory?: string
) {
  return posts.filter((post) => {
    if (post.data.domain !== domain) return false
    return subcategory ? post.data.subcategory === subcategory : true
  })
}

export function groupPostsByYear(posts: CollectionEntry<'posts'>[]) {
  const groups = new Map<number, CollectionEntry<'posts'>[]>()
  const sorted = [...posts].sort(
    (left, right) => right.data.publishedAt.getTime() - left.data.publishedAt.getTime()
  )

  for (const post of sorted) {
    const year = post.data.publishedAt.getFullYear()
    const entries = groups.get(year) ?? []
    entries.push(post)
    groups.set(year, entries)
  }

  return groups
}

export function toPostCard(post: CollectionEntry<'posts'>): PostCardData {
  const protectedContent = post.data.contentWarning.type !== 'none'
  const filename = post.id.split('/').at(-1) ?? post.id
  const slug = filename.replace(/\.(md|mdx)$/i, '')

  return {
    pageKey: post.data.id,
    slug,
    title: post.data.title,
    description: protectedContent ? '此内容需要确认后查看。' : post.data.description,
    publishedAt: post.data.publishedAt,
    domain: post.data.domain,
    subcategory: post.data.subcategory,
    tags: post.data.tags,
    cover: protectedContent ? undefined : post.data.cover,
    protected: protectedContent
  }
}

export function toFeedItem(post: CollectionEntry<'posts'>) {
  const card = toPostCard(post)
  return {
    title: card.title,
    description: card.description,
    pubDate: card.publishedAt,
    link: `/posts/${card.slug}`,
    categories: [card.domain, card.subcategory, ...card.tags]
  }
}
