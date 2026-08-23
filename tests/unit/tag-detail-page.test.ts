import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const routeSource = readFileSync(
  'D:/seRver/apps/blog/.worktrees/moments-editor-integration/src/pages/tags/[id].astro',
  'utf8',
)

describe('tag detail route wiring', () => {
  it('filters moment props by tag id before rendering the page', () => {
    expect(routeSource).toContain("moments: moments.filter((moment) => moment.tags.some((item) => item.id === tag.id))")
  })

  it('renders both post and moment sections through the shared section builder', () => {
    expect(routeSource).toContain('const sections = buildTagDetailSections(tag, posts, moments)')
    expect(routeSource).toContain('{sections.hasPosts ? sections.posts.map((post) => <PostCard post={post} />) : <p class="empty">尚无公开文章使用此标签。</p>}')
    expect(routeSource).toContain('{sections.hasMoments ? sections.moments.map((moment) => <MomentCard moment={moment} />) : <p class="empty">尚无公开动态使用此标签。</p>}')
  })
})
