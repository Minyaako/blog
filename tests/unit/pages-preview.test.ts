import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const root = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

describe('editor-preview Pages deployment', () => {
  it('deploys only editor-preview with the official Pages actions', () => {
    const workflow = parse(read('.github/workflows/pages-preview.yml'))

    expect(workflow.on.push.branches).toEqual(['editor-preview'])
    expect(workflow.on.workflow_dispatch).toEqual({})
    expect(workflow.permissions).toEqual({ contents: 'read', pages: 'write', 'id-token': 'write' })
    expect(workflow.jobs.build.steps.some((step: { uses?: string }) => step.uses === 'actions/configure-pages@v5')).toBe(true)
    expect(workflow.jobs.build.steps.some((step: { uses?: string }) => step.uses === 'actions/upload-pages-artifact@v3')).toBe(true)
    expect(workflow.jobs.deploy.steps.some((step: { uses?: string }) => step.uses === 'actions/deploy-pages@v5')).toBe(true)
  })

  it('builds public preview metadata without production publishing operations', () => {
    const workflow = read('.github/workflows/pages-preview.yml')

    expect(workflow).toContain('PUBLIC_BLOG_PREVIEW: "true"')
    expect(workflow).toContain('PUBLIC_PREVIEW_BRANCH: editor-preview')
    expect(workflow).toContain('PUBLIC_PREVIEW_SHA: ${{ github.sha }}')
    expect(workflow).toContain('--site "https://preview.gsk.minyako.top"')
    expect(workflow).not.toMatch(/media:(?:prepare|publish)|MEDIA_COS|tencent|force-push/i)
  })

  it('marks every preview page noindex, shows provenance and disables comments', () => {
    const baseLayout = read('src/layouts/BaseLayout.astro')
    const articleLayout = read('src/layouts/ArticleLayout.astro')

    expect(baseLayout).toContain('PUBLIC_BLOG_PREVIEW')
    expect(baseLayout).toContain('name="robots" content="noindex, noarchive"')
    expect(baseLayout).toContain('data-preview-banner')
    expect(baseLayout).toContain('PUBLIC_PREVIEW_SHA')
    expect(baseLayout).toContain('PUBLIC_PREVIEW_BUILD_TIME')
    expect(articleLayout).toContain('PUBLIC_BLOG_PREVIEW')
    expect(articleLayout).toContain('预览环境已禁用评论')
    expect(read('public/CNAME')).toBe('preview.gsk.minyako.top\n')
  })
})
