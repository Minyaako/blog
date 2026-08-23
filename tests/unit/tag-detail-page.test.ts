import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const testSource = readFileSync(new URL('./tag-detail-page.test.ts', import.meta.url), 'utf8')
const routeSource = readFileSync(new URL('../../src/pages/tags/[id].astro', import.meta.url), 'utf8')
const checkoutRootLiteral = ['D', ':/', 'seRver'].join('')
const worktreeLiteral = ['.', 'worktrees'].join('')

describe('tag detail route wiring', () => {
  it('keeps the test harness free of checkout-specific absolute paths', () => {
    expect(testSource).not.toContain(checkoutRootLiteral)
    expect(testSource).not.toContain(worktreeLiteral)
    expect(testSource).not.toMatch(/['"`][A-Z]:\//)
  })

  it('filters moment props by tag id before rendering the page', () => {
    expect(routeSource).toContain("moments: moments.filter((moment) => moment.tags.some((item) => item.id === tag.id))")
  })

  it('renders both post and moment sections through the shared section builder', () => {
    expect(routeSource).toContain('const sections = buildTagDetailSections(tag, posts, moments)')
    expect(routeSource).toContain('{sections.hasPosts ? sections.posts.map((post) => <PostCard post={post} />) : <p class="empty">尚无公开文章使用此标签。</p>}')
    expect(routeSource).toContain('{sections.hasMoments ? sections.moments.map((moment) => <MomentCard moment={moment} />) : <p class="empty">尚无公开动态使用此标签。</p>}')
  })
})
