# Static Blog Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify the first production-quality static vertical slice of the Minyako blog: content schema, visual system, homepage, four extensible domains, archive cards, article rendering, search, feeds, content warnings, and frontend visual checks.

**Architecture:** Astro 7 generates a fully static site from one typed `posts` content collection. Plain Astro components and layered CSS implement the approved visual language; Vitest covers content logic and Playwright covers rendered behavior, accessibility, and screenshots. Waline, server media upload tooling, Docker deployment, and Caddy routing are separate follow-up plans, but this plan provides stable `pageKey` and `CommentProvider` boundaries for them.

**Tech Stack:** Node.js 24, pnpm 11, Astro 7.0.7, TypeScript 6.0.3, MDX, Pagefind 1.5.2, Vitest 4.1.10, Playwright 1.61.1, axe-core, plain CSS, local Fontsource fonts, local Iconify SVG sets.

## Global Constraints

- Work only in the independent repository at `D:\seRver\apps\blog`.
- Do not modify files tracked by the parent `server-infra` repository.
- Preserve the pre-existing untracked Chinese design translation `docs/superpowers/specs/2026-07-12-blog-platform-design.zh-CN.md`; do not stage it unless explicitly requested.
- Production output is static; do not add an Astro server adapter.
- Default language is `zh-CN`; Chinese routes have no `/zh/` prefix.
- Every post has a stable `id` independent of its slug and taxonomy.
- Every domain obtains subcategories from configuration, never route-specific conditionals.
- Protected content must not leak through cards, search summaries, RSS, or social metadata.
- Use local build-time SVG icons and local font packages; no runtime font or icon CDN.
- Guest comments, GitHub OAuth, page views, media upload, Docker Compose, Caddy, backup, and rollback are outside this plan.
- Use explicit `git add <paths>` commands because the worktree contains a pre-existing untracked user file.

## Planned File Structure

```text
astro.config.mjs                 Astro, MDX, Sitemap, math, and site configuration
package.json                     scripts and pinned dependency ranges
playwright.config.ts             browser and screenshot projects
vitest.config.ts                 unit-test configuration
src/content.config.ts            typed post collection schema
src/config/site.ts               identity, navigation, social, and SEO configuration
src/config/taxonomy.ts           four domains and extensible subcategories
src/lib/posts.ts                 sorting, filtering, grouping, and safe summaries
src/lib/reading-time.ts          deterministic reading-time calculation
src/lib/comments/contracts.ts    provider boundary for the later Waline plan
src/components/                  focused visual and content components
src/layouts/                     base and article layouts
src/pages/                       static routes, RSS, and 404
src/content/posts/               four representative MDX posts
src/styles/                      tokens, reset, global, prose, and component layers
tests/unit/                      Vitest content and utility tests
tests/e2e/                       Playwright behavior, accessibility, and visual tests
```

---

### Task 1: Toolchain and Static Build Foundation

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `.nvmrc`
- Create: `.gitignore`
- Create: `tsconfig.json`
- Create: `astro.config.mjs`
- Create: `vitest.config.ts`
- Create: `playwright.config.ts`
- Create: `src/env.d.ts`
- Create: `src/pages/index.astro`
- Create: `tests/unit/foundation.test.ts`

**Interfaces:**
- Consumes: approved domain `https://minyakogsk.icu` and static-output constraint.
- Produces: `pnpm check`, `pnpm test:unit`, `pnpm build`, and `pnpm test:e2e` commands used by every later task.

- [x] **Step 1: Write the failing foundation test**

```ts
// tests/unit/foundation.test.ts
import { describe, expect, it } from 'vitest'
import { SITE } from '../../src/config/site'

describe('site foundation', () => {
  it('uses the production canonical origin and Chinese default language', () => {
    expect(SITE.origin).toBe('https://minyakogsk.icu')
    expect(SITE.lang).toBe('zh-CN')
  })
})
```

- [x] **Step 2: Create the pinned package manifest and configs**

```json
{
  "name": "minyako-blog",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.7.0",
  "engines": { "node": ">=22.12.0" },
  "scripts": {
    "dev": "astro dev",
    "check": "astro check",
    "test:unit": "vitest run",
    "test:e2e": "playwright test",
    "test:visual": "playwright test tests/e2e/visual.spec.ts",
    "build:astro": "astro build",
    "build:search": "pagefind --site dist",
    "build": "pnpm check && pnpm test:unit && pnpm build:astro && pnpm build:search",
    "preview": "astro preview"
  },
  "dependencies": {
    "@astrojs/mdx": "7.0.2",
    "@astrojs/rss": "4.0.19",
    "@astrojs/sitemap": "3.7.3",
    "@fontsource-variable/manrope": "5.2.8",
    "@fontsource-variable/noto-sans-sc": "5.2.10",
    "@iconify-json/lucide": "1.2.116",
    "@iconify-json/simple-icons": "1.2.89",
    "astro": "7.0.7",
    "astro-icon": "1.1.5",
    "katex": "0.17.0",
    "pagefind": "1.5.2",
    "rehype-katex": "7.0.1",
    "remark-math": "6.0.0"
  },
  "devDependencies": {
    "@astrojs/check": "0.9.9",
    "@axe-core/playwright": "4.12.1",
    "@playwright/test": "1.61.1",
    "@types/node": "24.13.3",
    "typescript": "6.0.3",
    "vitest": "4.1.10"
  }
}
```

```yaml
# pnpm-workspace.yaml
packages:
  - .
```

```text
# .nvmrc
24
```

```json
// tsconfig.json
{
  "extends": "astro/tsconfigs/strict",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] },
    "types": ["vitest/globals", "node"]
  },
  "include": [".astro/types.d.ts", "**/*"],
  "exclude": ["dist"]
}
```

```js
// astro.config.mjs
import mdx from '@astrojs/mdx'
import sitemap from '@astrojs/sitemap'
import { defineConfig } from 'astro/config'
import rehypeKatex from 'rehype-katex'
import remarkMath from 'remark-math'

export default defineConfig({
  site: 'https://minyakogsk.icu',
  output: 'static',
  trailingSlash: 'never',
  integrations: [mdx(), sitemap()],
  markdown: {
    remarkPlugins: [remarkMath],
    rehypePlugins: [rehypeKatex],
    shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' } }
  }
})
```

```ts
// vitest.config.ts
import { getViteConfig } from 'astro/config'

export default getViteConfig({
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' }
})
```

```ts
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  use: { baseURL: 'http://127.0.0.1:4321', trace: 'retain-on-failure' },
  webServer: {
    command: 'pnpm build && pnpm preview --host 127.0.0.1',
    url: 'http://127.0.0.1:4321',
    reuseExistingServer: !process.env.CI
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } }
  ]
})
```

```text
# src/env.d.ts
/// <reference types="astro/client" />
```

```text
# .gitignore
node_modules/
dist/
.astro/
.pnpm-store/
playwright-report/
test-results/
.DS_Store
Thumbs.db
```

- [x] **Step 2a: Install dependencies and verify the foundation test fails**

Run:

```powershell
pnpm.cmd install
pnpm.cmd test:unit
```

Expected: FAIL because `src/config/site.ts` does not exist yet.

- [x] **Step 3: Add the minimum site config and page so the test can pass**

```ts
// src/config/site.ts
export const SITE = {
  origin: 'https://minyakogsk.icu',
  title: 'Minyako',
  description: '研究、技术、生活与视觉小说的个人记录。',
  lang: 'zh-CN'
} as const
```

```astro
---
// src/pages/index.astro
import { SITE } from '../config/site'
---
<!doctype html>
<html lang={SITE.lang}>
  <head><meta charset="UTF-8" /><title>{SITE.title}</title></head>
  <body><main><h1>{SITE.title}</h1></main></body>
</html>
```

- [x] **Step 4: Install and verify the foundation**

Run:

```powershell
pnpm.cmd install
pnpm.cmd test:unit
pnpm.cmd check
pnpm.cmd build:astro
```

Expected: one Vitest test passes; Astro check reports zero errors; `dist/index.html` exists.

- [x] **Step 5: Commit only foundation files**

```powershell
git add package.json pnpm-lock.yaml pnpm-workspace.yaml .nvmrc .gitignore tsconfig.json astro.config.mjs vitest.config.ts playwright.config.ts src/env.d.ts src/config/site.ts src/pages/index.astro tests/unit/foundation.test.ts
git commit -m "chore: bootstrap static Astro site"
```

### Task 2: Typed Taxonomy and Content Schema

**Files:**
- Create: `src/config/taxonomy.ts`
- Create: `src/content.config.ts`
- Create: `tests/unit/taxonomy.test.ts`
- Create: `tests/unit/content-schema.test.ts`

**Interfaces:**
- Consumes: `SITE.lang` and Astro's `glob()` content loader.
- Produces: `DomainKey`, `SubcategoryKey`, `getDomain()`, `getSubcategory()`, and the validated `posts` collection.

- [x] **Step 1: Write failing taxonomy tests**

```ts
// tests/unit/taxonomy.test.ts
import { describe, expect, it } from 'vitest'
import { DOMAINS, getSubcategory } from '../../src/config/taxonomy'

describe('taxonomy', () => {
  it('defines four first-class domains', () => {
    expect(Object.keys(DOMAINS)).toEqual(['academic', 'engineering', 'life', 'games'])
  })

  it('resolves configured subcategories for every domain', () => {
    expect(getSubcategory('academic', 'paper-reading').label).toBe('论文阅读')
    expect(getSubcategory('engineering', 'devlogs').label).toBe('开发日志')
    expect(getSubcategory('life', 'journals').label).toBe('生活札记')
    expect(getSubcategory('games', 'gallery').label).toBe('图集')
  })

  it('rejects a subcategory from the wrong domain', () => {
    expect(() => getSubcategory('life', 'gallery')).toThrow('Unknown subcategory')
  })
})
```

- [x] **Step 1a: Run taxonomy tests to verify the red state**

Run: `pnpm.cmd vitest run tests/unit/taxonomy.test.ts`

Expected: FAIL because `src/config/taxonomy.ts` does not exist.

- [x] **Step 2: Implement the taxonomy as data, not route conditionals**

```ts
// src/config/taxonomy.ts
export const DOMAINS = {
  academic: {
    label: '学术', englishLabel: 'Academic', color: 'sage',
    description: '论文阅读、研究记录与学术思考。',
    subcategories: {
      'paper-reading': { label: '论文阅读' },
      'research-notes': { label: '研究记录' }
    }
  },
  engineering: {
    label: '技术', englishLabel: 'Engineering', color: 'amber',
    description: '工程实践、技术笔记与工具记录。',
    subcategories: {
      tutorials: { label: '教程' }, devlogs: { label: '开发日志' }, tools: { label: '工具' }
    }
  },
  life: {
    label: '生活', englishLabel: 'Life', color: 'violet',
    description: '日常、月记、旅行与生活观察。',
    subcategories: {
      journals: { label: '生活札记' }, travel: { label: '旅行' }
    }
  },
  games: {
    label: '游戏', englishLabel: 'Games', color: 'rose',
    description: '视觉小说评测、随想与图像收藏。',
    subcategories: {
      reviews: { label: '评测' }, reflections: { label: '随想' }, gallery: { label: '图集' }
    }
  }
} as const

export type DomainKey = keyof typeof DOMAINS
export type SubcategoryKey<D extends DomainKey = DomainKey> = keyof (typeof DOMAINS)[D]['subcategories'] & string

export function getDomain(domain: string) {
  if (!(domain in DOMAINS)) throw new Error(`Unknown domain: ${domain}`)
  return DOMAINS[domain as DomainKey]
}

export function getSubcategory(domain: DomainKey, subcategory: string) {
  const subcategories = DOMAINS[domain].subcategories as Record<string, { label: string }>
  const result = subcategories[subcategory]
  if (!result) throw new Error(`Unknown subcategory: ${domain}/${subcategory}`)
  return result
}
```

- [x] **Step 3: Define and test the schema rules**

```ts
// src/content.config.ts
import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'
import { z } from 'astro/zod'
import { DOMAINS, type DomainKey } from './config/taxonomy'

const warningSchema = z.object({
  type: z.enum(['none', 'spoiler', 'sensitive']).default('none'),
  message: z.string().default(''),
  scope: z.enum(['none', 'page', 'blocks']).default('none')
})

const assetUrlSchema = z.string().refine((value) => {
  if (value.startsWith('/')) return true
  try { new URL(value); return true } catch { return false }
}, 'Expected a root-relative path or absolute URL')

const imageSchema = z.object({
  url: assetUrlSchema, alt: z.string(), credit: z.string(), sourceUrl: z.string().url().optional()
})

const posts = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/posts' }),
  schema: z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]+$/),
    title: z.string().min(1), description: z.string().min(1),
    publishedAt: z.coerce.date(), updatedAt: z.coerce.date().optional(),
    domain: z.enum(Object.keys(DOMAINS) as [DomainKey, ...DomainKey[]]),
    subcategory: z.string().min(1), tags: z.array(z.string()).default([]),
    collections: z.array(z.string()).default([]), cover: imageSchema.optional(),
    authors: z.array(z.string()).default(['Minyako']), draft: z.boolean().default(false),
    featured: z.boolean().default(false), lang: z.literal('zh-CN').default('zh-CN'),
    translationKey: z.string().min(1), license: z.literal('CC-BY-4.0').default('CC-BY-4.0'),
    contentWarning: warningSchema.default({ type: 'none', message: '', scope: 'none' })
  }).superRefine((post, ctx) => {
    try {
      const domain = DOMAINS[post.domain]
      if (!(post.subcategory in domain.subcategories)) throw new Error()
    } catch {
      ctx.addIssue({ code: 'custom', path: ['subcategory'], message: `Unknown subcategory: ${post.domain}/${post.subcategory}` })
    }
  })
})

export const collections = { posts }
```

Extract the Zod object as `export const postSchema` before passing it to `defineCollection`, then add this test:

```ts
// tests/unit/content-schema.test.ts
import { describe, expect, it } from 'vitest'
import { postSchema } from '../../src/content.config'

const validPost = {
  id: 'engineering-schema-example', title: 'Schema Example', description: 'A valid post.',
  publishedAt: '2026-07-12', domain: 'engineering', subcategory: 'devlogs',
  tags: ['astro'], collections: [], cover: {
    url: '/images/posts/engineering-cover.svg', alt: 'Geometric amber cover', credit: 'Minyako'
  },
  authors: ['Minyako'], draft: false, featured: true, lang: 'zh-CN',
  translationKey: 'engineering-schema-example', license: 'CC-BY-4.0',
  contentWarning: { type: 'none', message: '', scope: 'none' }
}

describe('post schema', () => {
  it('accepts a configured domain and root-relative cover', () => {
    expect(postSchema.parse(validPost).domain).toBe('engineering')
  })

  it('rejects a subcategory owned by another domain', () => {
    expect(() => postSchema.parse({ ...validPost, domain: 'life', subcategory: 'gallery' }))
      .toThrow('Unknown subcategory: life/gallery')
  })
})
```

- [x] **Step 4: Run focused and full unit tests**

Run: `pnpm.cmd vitest run tests/unit/taxonomy.test.ts tests/unit/content-schema.test.ts`

Expected: all taxonomy and schema tests pass.

- [x] **Step 5: Commit taxonomy and schema**

```powershell
git add src/config/taxonomy.ts src/content.config.ts tests/unit/taxonomy.test.ts tests/unit/content-schema.test.ts
git commit -m "feat: define extensible content taxonomy"
```

### Task 3: Post Query and Safe-Presentation Utilities

**Files:**
- Create: `src/lib/posts.ts`
- Create: `src/lib/reading-time.ts`
- Create: `src/lib/comments/contracts.ts`
- Create: `tests/unit/posts.test.ts`
- Create: `tests/unit/reading-time.test.ts`

**Interfaces:**
- Consumes: `CollectionEntry<'posts'>` and permanent post IDs.
- Produces: `getPublishedPosts()`, `filterPosts()`, `groupPostsByYear()`, `toPostCard()`, `getReadingTime()`, and `CommentProvider`.

- [x] **Step 1: Write failing utility tests**

```ts
// tests/unit/reading-time.test.ts
import { expect, it } from 'vitest'
import { getReadingTime } from '../../src/lib/reading-time'

it('counts Chinese characters and Latin words deterministically', () => {
  expect(getReadingTime('中文内容'.repeat(100) + ' astro static site '.repeat(40))).toEqual({ minutes: 2, words: 520 })
})
```

- [x] **Step 1a: Run utility tests to verify the red state**

Run: `pnpm.cmd vitest run tests/unit/posts.test.ts tests/unit/reading-time.test.ts`

Expected: FAIL because `src/lib/posts.ts` and `src/lib/reading-time.ts` do not exist.

```ts
// tests/unit/posts.test.ts
import { describe, expect, it } from 'vitest'
import { groupPostsByYear, toPostCard } from '../../src/lib/posts'

const normal = { id: 'normal', data: { id: 'post-1', title: 'Normal', description: 'Public summary', publishedAt: new Date('2026-07-01'), domain: 'engineering', subcategory: 'devlogs', tags: [], contentWarning: { type: 'none', message: '', scope: 'none' } } }
const sensitive = { id: 'sensitive', data: { ...normal.data, id: 'post-2', title: 'Hidden', description: 'Leaking summary', publishedAt: new Date('2025-01-01'), contentWarning: { type: 'sensitive', message: '成人向内容', scope: 'page' } } }

describe('post presentation', () => {
  it('groups posts by publication year', () => expect([...groupPostsByYear([normal, sensitive] as never).keys()]).toEqual([2026, 2025]))
  it('replaces protected summaries', () => expect(toPostCard(sensitive as never).description).toBe('此内容需要确认后查看。'))
})
```

- [x] **Step 2: Implement reading time and post presentation**

```ts
// src/lib/reading-time.ts
export function getReadingTime(source: string) {
  const han = source.match(/[\u3400-\u9fff]/g)?.length ?? 0
  const latin = source.replace(/[\u3400-\u9fff]/g, ' ').match(/[A-Za-z0-9_'-]+/g)?.length ?? 0
  const words = han + latin
  return { words, minutes: Math.max(1, Math.ceil(han / 300 + latin / 220)) }
}
```

Implement `src/lib/posts.ts` with these exact exports:

```ts
export async function getPublishedPosts(): Promise<CollectionEntry<'posts'>[]>
export function filterPosts(posts: CollectionEntry<'posts'>[], domain: DomainKey, subcategory?: string): CollectionEntry<'posts'>[]
export function groupPostsByYear(posts: CollectionEntry<'posts'>[]): Map<number, CollectionEntry<'posts'>[]>
export function toPostCard(post: CollectionEntry<'posts'>): { pageKey: string; slug: string; title: string; description: string; publishedAt: Date; domain: DomainKey; subcategory: string; tags: string[]; cover?: PostCover; protected: boolean }
```

`getPublishedPosts()` excludes drafts and sorts descending by `publishedAt`. `toPostCard()` substitutes the safe summary and omits `cover` whenever `contentWarning.type !== 'none'`.

```ts
// src/lib/comments/contracts.ts
export interface CommentProvider {
  mount(target: HTMLElement, pageKey: string): Promise<void>
  getPageViews(pageKey: string): Promise<number>
  dispose(): void
}
```

- [x] **Step 3: Run focused tests**

Run: `pnpm.cmd vitest run tests/unit/posts.test.ts tests/unit/reading-time.test.ts`

Expected: grouping, protected summaries, and reading-time assertions pass.

- [x] **Step 4: Commit utilities**

```powershell
git add src/lib/posts.ts src/lib/reading-time.ts src/lib/comments/contracts.ts tests/unit/posts.test.ts tests/unit/reading-time.test.ts
git commit -m "feat: add safe post presentation utilities"
```

### Task 4: Base Layout, Navigation, Theme, and Icon System

**Files:**
- Create: `src/styles/tokens.css`
- Create: `src/styles/global.css`
- Create: `src/styles/prose.css`
- Create: `src/layouts/BaseLayout.astro`
- Create: `src/components/SiteHeader.astro`
- Create: `src/components/SiteFooter.astro`
- Create: `src/components/AppIcon.astro`
- Create: `src/components/ThemeToggle.astro`
- Modify: `src/config/site.ts`
- Modify: `src/pages/index.astro`
- Create: `tests/e2e/shell.spec.ts`

**Interfaces:**
- Consumes: `SITE`, `DOMAINS`, local Iconify sets, and the canonical URL.
- Produces: `BaseLayout` props `{ title, description, image?, noindex? }`, accessible header/footer, and persisted `light | dark | system` theme behavior.

- [x] **Step 1: Write the failing shell test**

```ts
// tests/e2e/shell.spec.ts
import { expect, test } from '@playwright/test'

test('renders accessible navigation and persists theme', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('banner')).toBeVisible()
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible()
  await page.getByRole('button', { name: '切换主题' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', /light|dark/)
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', /light|dark/)
})
```

- [x] **Step 1a: Run the shell test to verify the red state**

Run: `pnpm.cmd test:e2e --project=desktop tests/e2e/shell.spec.ts`

Expected: FAIL because the minimal page has no accessible navigation or theme button.

- [x] **Step 2: Implement design tokens and global rules**

Define tokens for neutral canvas, surface, text, muted text, borders, four domain accents, type scales, radii, content widths, shadows, and motion. Include both `:root` and `[data-theme='dark']`. Set `color-scheme`, visible `:focus-visible`, `prefers-reduced-motion`, responsive images, and the approved Manrope/Noto Sans SC font stacks.

Use CSS layers in `src/styles/global.css`:

```css
@layer reset, tokens, base, components, utilities;
@import './tokens.css' layer(tokens);
@import './prose.css' layer(components);

@layer base {
  *, *::before, *::after { box-sizing: border-box; }
  html { background: var(--canvas); color: var(--text); font-family: var(--font-body); }
  body { margin: 0; min-height: 100vh; }
  a { color: inherit; }
  :focus-visible { outline: 2px solid var(--focus); outline-offset: 3px; }
}
```

- [x] **Step 3: Implement the icon and theme components**

`AppIcon.astro` accepts `{ name: string; label?: string; size?: number }`, renders `astro-icon`'s `Icon`, sets `aria-hidden="true"` when no label exists, and otherwise uses `role="img" aria-label={label}`.

`ThemeToggle.astro` renders one button and an inline module script. The script cycles `system -> light -> dark`, stores `minyako-theme`, resolves system preference, updates `data-theme`, and keeps `aria-label="切换主题"`.

- [x] **Step 4: Implement `BaseLayout`, header, and footer**

`BaseLayout.astro` imports both font packages, KaTeX CSS, and `global.css`; emits canonical, description, OpenGraph, Twitter, RSS, theme-color, viewport, and optional noindex metadata. `SiteHeader` includes 首页、归档、项目、关于、搜索 and a compact domain menu. `SiteFooter` includes RSS, GitHub, CC BY 4.0, and third-party-rights wording.

- [x] **Step 5: Run browser and static checks**

Run:

```powershell
pnpm.cmd exec playwright install chromium
pnpm.cmd test:e2e --project=desktop tests/e2e/shell.spec.ts
pnpm.cmd check
```

Expected: shell test passes and Astro reports zero errors.

- [x] **Step 6: Commit the design shell**

```powershell
git add src/styles src/layouts/BaseLayout.astro src/components/SiteHeader.astro src/components/SiteFooter.astro src/components/AppIcon.astro src/components/ThemeToggle.astro src/config/site.ts src/pages/index.astro tests/e2e/shell.spec.ts
git commit -m "feat: add accessible visual foundation"
```

### Task 5: Homepage Vertical Slice and Initial Content

**Files:**
- Create: `src/components/HeroBanner.astro`
- Create: `src/components/ProfileStrip.astro`
- Create: `src/components/DomainGrid.astro`
- Create: `src/components/LatestPosts.astro`
- Create: `public/images/home/banner-geometric.svg`
- Create: `public/images/profile/avatar-geometric.svg`
- Create: `public/images/posts/academic-cover.svg`
- Create: `public/images/posts/engineering-cover.svg`
- Create: `public/images/posts/life-cover.svg`
- Create: `public/images/posts/games-cover.svg`
- Create: `src/content/posts/academic/embodied-ai-reading.mdx`
- Create: `src/content/posts/engineering/astro-content-architecture.mdx`
- Create: `src/content/posts/life/july-field-notes.mdx`
- Create: `src/content/posts/games/visual-novel-memory.mdx`
- Modify: `src/pages/index.astro`
- Create: `tests/e2e/home.spec.ts`

**Interfaces:**
- Consumes: `getPublishedPosts()`, `toPostCard()`, `DOMAINS`, and `SITE.socials`.
- Produces: approved image-top-bar homepage and reusable domain/post-card presentation.

- [x] **Step 1: Write the failing homepage test**

```ts
// tests/e2e/home.spec.ts
import { expect, test } from '@playwright/test'

test('homepage presents identity, four domains, and recent writing', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('img', { name: 'Minyako 首页横幅' })).toBeVisible()
  await expect(page.getByText('@minyako')).toBeVisible()
  for (const label of ['学术', '技术', '生活', '游戏']) {
    await expect(page.getByRole('link', { name: new RegExp(label) })).toBeVisible()
  }
  await expect(page.getByRole('heading', { name: '最新长文' })).toBeVisible()
})
```

- [x] **Step 1a: Run the homepage test to verify the red state**

Run: `pnpm.cmd test:e2e --project=desktop tests/e2e/home.spec.ts`

Expected: FAIL because the banner, identity strip, domain grid, and latest-post section do not exist.

- [x] **Step 2: Add one valid initial post for each domain**

Create four MDX files with these exact frontmatter decisions:

```yaml
# academic/embodied-ai-reading.mdx
id: academic-embodied-ai-reading
title: 具身智能论文阅读：从问题定义开始
description: 用一份结构化阅读记录展示学术文章的组织方式。
publishedAt: 2026-07-09
domain: academic
subcategory: paper-reading
tags: [具身智能, 论文阅读]
collections: [研究阅读笔记]
cover: { url: /images/posts/academic-cover.svg, alt: 青绿色学术几何封面, credit: Minyako }
authors: [Minyako]
draft: false
featured: false
lang: zh-CN
translationKey: academic-embodied-ai-reading
license: CC-BY-4.0
contentWarning: { type: none, message: '', scope: none }

# engineering/astro-content-architecture.mdx
id: engineering-astro-content-architecture
title: Astro 内容架构：从稳定标识到可扩展分类
description: 解释博客如何用稳定 ID、领域与子类组织长期内容。
publishedAt: 2026-07-12
domain: engineering
subcategory: devlogs
tags: [Astro, 内容架构]
collections: [博客构建记录]
cover: { url: /images/posts/engineering-cover.svg, alt: 琥珀色技术几何封面, credit: Minyako }
authors: [Minyako]
draft: false
featured: true
lang: zh-CN
translationKey: engineering-astro-content-architecture
license: CC-BY-4.0
contentWarning: { type: none, message: '', scope: none }

# life/july-field-notes.mdx
id: life-july-field-notes
title: 七月生活札记：为长期记录留出空间
description: 一篇关于记录习惯、日常观察与页面节奏的生活札记。
publishedAt: 2026-07-06
domain: life
subcategory: journals
tags: [生活札记, 七月]
collections: [月度札记]
cover: { url: /images/posts/life-cover.svg, alt: 紫色生活几何封面, credit: Minyako }
authors: [Minyako]
draft: false
featured: false
lang: zh-CN
translationKey: life-july-field-notes
license: CC-BY-4.0
contentWarning: { type: none, message: '', scope: none }

# games/visual-novel-memory.mdx
id: games-visual-novel-memory
title: 视觉小说中的记忆与重访
description: 本文包含需要确认后查看的视觉小说讨论。
publishedAt: 2026-07-10
domain: games
subcategory: reflections
tags: [视觉小说, 随想]
collections: [视觉小说札记]
cover: { url: /images/posts/games-cover.svg, alt: 玫瑰色游戏几何封面, credit: Minyako }
authors: [Minyako]
draft: false
featured: false
lang: zh-CN
translationKey: games-visual-novel-memory
license: CC-BY-4.0
contentWarning: { type: sensitive, message: '包含视觉小说剧情与敏感主题讨论。', scope: page }
```

Each file initially contains two original paragraphs explaining what that domain will record. Task 7 expands the same files into full capability demonstrations; it does not replace their IDs, slugs, or metadata.

- [x] **Step 3: Implement the approved homepage components**

`HeroBanner` renders a `<picture>` with fixed aspect ratio and a visible credit link. `ProfileStrip` renders the circular avatar overlapping the banner edge, `Minyako`, `@minyako`, the one-line introduction, GitHub, email, and additional-platform icons. The initial banner, avatar, and covers are original repository-owned geometric fallback SVGs, not copied third-party artwork.

`DomainGrid` maps `Object.entries(DOMAINS)` and generates `/domains/<domain>` links. `LatestPosts` shows the newest featured post as the wide lead and the next two posts as compact rows; if no featured post exists, the newest post is the lead.

- [x] **Step 4: Replace the minimal index with `BaseLayout` and the components**

The page fetches `const posts = await getPublishedPosts()` and passes card-safe results only. Do not access raw protected descriptions or covers in homepage components.

- [x] **Step 5: Run the homepage test at desktop and mobile widths**

Run: `pnpm.cmd test:e2e tests/e2e/home.spec.ts`

Expected: both configured Playwright projects pass without horizontal overflow.

- [x] **Step 6: Commit the homepage and initial posts**

```powershell
git add src/components/HeroBanner.astro src/components/ProfileStrip.astro src/components/DomainGrid.astro src/components/LatestPosts.astro public/images/home public/images/profile public/images/posts src/content/posts src/pages/index.astro tests/e2e/home.spec.ts
git commit -m "feat: build image-led blog homepage"
```

### Task 6: Domain, Subcategory, and Archive Listings

**Files:**
- Create: `src/components/PostCard.astro`
- Create: `src/components/ArchiveGroup.astro`
- Create: `src/pages/domains/[domain]/index.astro`
- Create: `src/pages/domains/[domain]/[subcategory].astro`
- Create: `src/pages/archives/index.astro`
- Create: `src/pages/tags/[tag].astro`
- Create: `src/pages/collections/[collection].astro`
- Create: `tests/e2e/listings.spec.ts`

**Interfaces:**
- Consumes: `filterPosts()`, `groupPostsByYear()`, `toPostCard()`, and configured taxonomy.
- Produces: every domain/subcategory route and the approved left-text/right-image listing card.

- [x] **Step 1: Write failing route and layout tests**

```ts
// tests/e2e/listings.spec.ts
import { expect, test } from '@playwright/test'

test('archive cards keep semantic text and atmospheric image regions', async ({ page }) => {
  await page.goto('/archives')
  const card = page.locator('[data-post-card]').first()
  await expect(card.getByRole('heading')).toBeVisible()
  await expect(card.locator('[data-card-image]')).toBeVisible()
  await expect(card.getByRole('link')).toHaveAttribute('href', /\/posts\//)
})

test('all configured domain entrances resolve', async ({ page }) => {
  for (const domain of ['academic', 'engineering', 'life', 'games']) {
    const response = await page.goto(`/domains/${domain}`)
    expect(response?.status()).toBe(200)
  }
})
```

- [x] **Step 1a: Run listing tests to verify the red state**

Run: `pnpm.cmd test:e2e --project=desktop tests/e2e/listings.spec.ts`

Expected: FAIL because `/archives` and `/domains/<domain>` have not been generated.

- [x] **Step 2: Implement `PostCard` and archive grouping**

`PostCard.astro` receives only `ReturnType<typeof toPostCard>`. Desktop uses a wide grid with text left and cover right; a pseudo-element gradient preserves contrast. Missing/protected covers use a domain-colored geometric pattern. Mobile stacks the card. The card contains one stretched semantic link and one visible focus state.

- [x] **Step 3: Generate domain and subcategory routes from configuration**

Both dynamic files use `getStaticPaths()`. The domain route maps `Object.keys(DOMAINS)`. The subcategory route flattens every configured domain's `subcategories`. No hard-coded route array is allowed outside `taxonomy.ts`.

- [x] **Step 4: Generate archive, tag, and collection routes from content**

Archive groups by year descending. Tag and collection routes derive unique values from published posts and pass every post through `toPostCard()`.

- [x] **Step 5: Run list tests and build route generation**

Run:

```powershell
pnpm.cmd test:e2e tests/e2e/listings.spec.ts
pnpm.cmd build:astro
```

Expected: all four domain pages return 200 and generated `dist/domains`, `dist/archives`, `dist/tags`, and `dist/collections` contain HTML.

- [x] **Step 6: Commit listings**

```powershell
git add src/components/PostCard.astro src/components/ArchiveGroup.astro src/pages/domains src/pages/archives src/pages/tags src/pages/collections tests/e2e/listings.spec.ts
git commit -m "feat: add taxonomy and archive listings"
```

### Task 7: Article Layout and Four Representative Posts

**Files:**
- Create: `src/layouts/ArticleLayout.astro`
- Create: `src/components/TableOfContents.astro`
- Create: `src/components/ArticleMeta.astro`
- Create: `src/components/ContentNotice.astro`
- Create: `src/pages/posts/[...slug].astro`
- Modify: `src/content/posts/academic/embodied-ai-reading.mdx`
- Modify: `src/content/posts/engineering/astro-content-architecture.mdx`
- Modify: `src/content/posts/life/july-field-notes.mdx`
- Modify: `src/content/posts/games/visual-novel-memory.mdx`
- Create: `tests/e2e/article.spec.ts`

**Interfaces:**
- Consumes: content schema, `getReadingTime()`, rendered headings, permanent IDs, and safe metadata.
- Produces: static article pages demonstrating citations, math, code, callouts, imagery, warnings, and long-form reading.

- [x] **Step 1: Write the failing article behavior test**

```ts
// tests/e2e/article.spec.ts
import { expect, test } from '@playwright/test'

test('technical article renders metadata, toc, code, and math', async ({ page }) => {
  await page.goto('/posts/astro-content-architecture')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Astro')
  await expect(page.getByRole('navigation', { name: '文章目录' })).toBeVisible()
  await expect(page.locator('pre code')).toBeVisible()
  await expect(page.locator('.katex')).toBeVisible()
  await expect(page.locator('[data-page-key]')).toHaveAttribute('data-page-key', 'engineering-astro-content-architecture')
})
```

- [x] **Step 1a: Run the article test to verify the red state**

Run: `pnpm.cmd test:e2e --project=desktop tests/e2e/article.spec.ts`

Expected: FAIL because the static post route and article layout do not exist.

- [x] **Step 2: Implement article route and layout**

`[...slug].astro` uses `getStaticPaths()` over published posts, renders the entry, calculates reading time from `body`, and passes headings to `ArticleLayout`. `ArticleLayout` renders title, description, domain/subcategory, dates, reading time, tags, license, desktop sticky TOC, mobile disclosure TOC, prose content, previous/next links, and an empty `<section data-comment-slot data-page-key={post.data.id}>` for the later comment adapter.

- [x] **Step 3: Write four original representative MDX posts**

Each post must be a coherent publishable demonstration rather than lorem ipsum:

- Academic: paper-reading structure, citation list, equation, and research-note callout.
- Engineering: content architecture, TypeScript code, directory tree, and design rationale.
- Life: prose, blockquote, image caption, and monthly-note structure.
- Games: spoiler warning, review metadata, image-gallery markup, and third-party-rights note using repository-owned geometric art.

Keep the stable IDs and subcategories created in Task 5. Keep the engineering post `featured: true`. Use only repository-owned geometric SVG covers in this plan.

- [x] **Step 4: Run article test, schema check, and build**

Run:

```powershell
pnpm.cmd test:e2e tests/e2e/article.spec.ts
pnpm.cmd check
pnpm.cmd build:astro
```

Expected: four article pages build; technical article exposes code and KaTeX; no schema errors occur.

- [x] **Step 5: Commit articles and layout**

```powershell
git add src/layouts/ArticleLayout.astro src/components/TableOfContents.astro src/components/ArticleMeta.astro src/components/ContentNotice.astro src/pages/posts src/content/posts tests/e2e/article.spec.ts public/images/posts
git commit -m "feat: add long-form article experience"
```

### Task 8: Content Warnings, Search, RSS, SEO, and Utility Pages

**Files:**
- Create: `src/components/ContentWarningDialog.astro`
- Create: `src/components/Spoiler.astro`
- Create: `src/pages/search.astro`
- Create: `src/pages/rss.xml.ts`
- Create: `src/pages/about.astro`
- Create: `src/pages/projects.astro`
- Create: `src/pages/404.astro`
- Modify: `src/layouts/BaseLayout.astro`
- Modify: `src/layouts/ArticleLayout.astro`
- Create: `tests/unit/rss-safety.test.ts`
- Create: `tests/e2e/warnings.spec.ts`
- Create: `tests/e2e/search.spec.ts`

**Interfaces:**
- Consumes: `contentWarning`, `toPostCard()`, Pagefind assets, and SITE metadata.
- Produces: protected-content interaction, safe feed items, searchable static output, About/projects/404, and complete metadata.

- [x] **Step 1: Write failing warning and feed-safety tests**

```ts
// tests/e2e/warnings.spec.ts
import { expect, test } from '@playwright/test'

test('sensitive page requires confirmation and remembers it for the session', async ({ page }) => {
  await page.goto('/posts/visual-novel-memory')
  const dialog = page.getByRole('dialog', { name: '内容提示' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '确认并继续' }).click()
  await expect(dialog).toBeHidden()
  await page.reload()
  await expect(dialog).toBeHidden()
})
```

`tests/unit/rss-safety.test.ts` passes a sensitive post to an exported `toFeedItem()` helper and asserts the result contains `此内容需要确认后查看。` and does not contain the raw protected description or cover URL.

- [x] **Step 1a: Run warning and feed tests to verify the red state**

Run:

```powershell
pnpm.cmd vitest run tests/unit/rss-safety.test.ts
pnpm.cmd test:e2e --project=desktop tests/e2e/warnings.spec.ts
```

Expected: FAIL because `toFeedItem()` and the confirmation dialog do not exist.

- [x] **Step 2: Implement accessible warning interactions**

`ContentWarningDialog` uses native `<dialog>`, moves focus to the confirmation action, closes only through explicit continue/back actions, restores focus when appropriate, and stores `minyako-warning:<pageKey>=accepted` in `sessionStorage`. Without JavaScript, the warning text remains visible before content.

`Spoiler.astro` renders a button-controlled blurred region with `aria-expanded`; it supports keyboard reveal and does not reveal on hover alone.

- [x] **Step 3: Implement Pagefind search with failure fallback**

The search page imports `/pagefind/pagefind-ui.js` from built output, initializes the UI on page load, sets the Chinese input hint `搜索文章、标签与合集`, and shows a static link to `/archives` when loading fails. Add `data-pagefind-body` to article content and `data-pagefind-ignore` to navigation, warnings, and comment slots.

- [x] **Step 4: Implement safe RSS, About, projects, and 404**

`rss.xml.ts` calls `getPublishedPosts()` and `toFeedItem()`; it never uses raw protected summaries. About documents the site purpose and CC BY 4.0 versus third-party rights. Projects starts with a concise empty-state card that is valid production content. The 404 page provides home, search, and archive actions.

- [x] **Step 5: Verify warnings, search bundle, feeds, and metadata**

Run:

```powershell
pnpm.cmd vitest run tests/unit/rss-safety.test.ts
pnpm.cmd test:e2e tests/e2e/warnings.spec.ts
pnpm.cmd build
pnpm.cmd exec playwright test tests/e2e/search.spec.ts
```

Expected: warnings pass, `dist/pagefind` exists, `dist/rss.xml` contains no protected raw summary, and search finds the engineering example post.

- [x] **Step 6: Commit utility features**

```powershell
git add src/components/ContentWarningDialog.astro src/components/Spoiler.astro src/pages/search.astro src/pages/rss.xml.ts src/pages/about.astro src/pages/projects.astro src/pages/404.astro src/layouts tests/unit/rss-safety.test.ts tests/e2e/warnings.spec.ts tests/e2e/search.spec.ts
git commit -m "feat: add safe discovery and content warnings"
```

### Task 9: Accessibility, Visual Regression, and CI Release Gate

**Files:**
- Create: `tests/e2e/accessibility.spec.ts`
- Create: `tests/e2e/visual.spec.ts`
- Create: `tests/e2e/fixtures.ts`
- Create: `tests/e2e/visual.spec.ts-snapshots/` through Playwright update command
- Create: `.github/workflows/ci.yml`
- Create: `README.md`

**Interfaces:**
- Consumes: every representative route and deterministic content fixtures.
- Produces: automated accessibility checks, phone/tablet/desktop light/dark screenshots, uploaded diff artifacts, and a documented local workflow.

- [x] **Step 1: Write accessibility and visual suites**

```ts
// tests/e2e/accessibility.spec.ts
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

for (const path of ['/', '/archives', '/posts/astro-content-architecture', '/about', '/404']) {
  test(`has no serious accessibility violations: ${path}`, async ({ page }) => {
    await page.goto(path)
    const results = await new AxeBuilder({ page }).analyze()
    expect(results.violations.filter((item) => ['serious', 'critical'].includes(item.impact ?? ''))).toEqual([])
  })
}
```

- [x] **Step 1a: Run visual tests to verify the missing-baseline state**

Run: `pnpm.cmd exec playwright test tests/e2e/visual.spec.ts --project=desktop`

Expected: FAIL with missing screenshot baselines; do not accept screenshots until Step 3 manual inspection.

```ts
// tests/e2e/visual.spec.ts
import { expect, test } from '@playwright/test'

const routes = {
  home: '/', archive: '/archives', article: '/posts/astro-content-architecture',
  game: '/posts/visual-novel-memory', search: '/search', about: '/about', notFound: '/404'
}

for (const theme of ['light', 'dark'] as const) {
  for (const [name, path] of Object.entries(routes)) {
    test(`${name} ${theme}`, async ({ page }) => {
      await page.addInitScript((value) => localStorage.setItem('minyako-theme', value), theme)
      await page.goto(path)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await expect(page).toHaveScreenshot(`${name}-${theme}.png`, { fullPage: true, animations: 'disabled' })
    })
  }
}
```

- [x] **Step 2: Add a tablet screenshot project and deterministic fixtures**

Add `{ name: 'tablet', use: { viewport: { width: 834, height: 1112 } } }` to `playwright.config.ts`. In `fixtures.ts`, freeze the clock to `2026-07-12T00:00:00+08:00`, disable transitions, and intercept the later comment endpoint pattern with an empty stable response. Import the fixture's `test` in `visual.spec.ts`.

- [x] **Step 3: Generate and inspect screenshot baselines**

Run:

```powershell
pnpm.cmd test:e2e tests/e2e/accessibility.spec.ts
pnpm.cmd exec playwright test tests/e2e/visual.spec.ts --update-snapshots
pnpm.cmd exec playwright test tests/e2e/visual.spec.ts
```

Expected: accessibility suite has zero serious/critical violations; the second visual run has zero pixel mismatches. Manually inspect banner crop, icons, line wrapping, archive gradients, focus rings, and protected imagery before staging snapshots.

- [x] **Step 4: Add GitHub Actions CI**

```yaml
# .github/workflows/ci.yml
name: CI
on:
  pull_request:
  push:
    branches: [main]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 11.7.0 }
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm build
      - run: pnpm test:e2e
      - if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: |
            playwright-report/
            test-results/
```

- [x] **Step 5: Document developer workflow and visual review gate**

README must document Node/pnpm versions, `pnpm dev`, authoring location, taxonomy configuration, `pnpm build`, unit/e2e/visual commands, how to review and intentionally update screenshots, public-repository draft warning, and the separation of future Waline/media/deployment plans.

- [x] **Step 6: Run the complete release gate**

Run:

```powershell
pnpm.cmd check
pnpm.cmd test:unit
pnpm.cmd build
pnpm.cmd test:e2e
git diff --check
```

Expected: zero type errors, zero unit failures, successful Astro and Pagefind builds, zero browser failures, and no whitespace errors.

- [x] **Step 7: Commit CI, docs, and baselines**

```powershell
git add .github/workflows/ci.yml README.md playwright.config.ts tests/e2e tests/e2e/visual.spec.ts-snapshots
git commit -m "test: add frontend release gates"
```

### Task 10: Static-Core Acceptance Audit

**Files:**
- Modify: `docs/superpowers/plans/2026-07-12-static-blog-core.md`
- Create: `docs/verification/static-core-acceptance.md`

**Interfaces:**
- Consumes: all outputs from Tasks 1-9 and the approved design spec.
- Produces: durable evidence that the static-core subproject is ready for the Waline/media/deployment plans.

- [x] **Step 1: Run the clean-clone-equivalent verification**

Run:

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd check
pnpm.cmd test:unit
pnpm.cmd build
pnpm.cmd test:e2e
git status --short
```

Expected: all commands pass; only the preserved pre-existing untracked Chinese design translation may appear in status unless separately committed by its owner.

- [x] **Step 2: Write acceptance evidence**

`docs/verification/static-core-acceptance.md` records the tested commit, command results, generated route count, browser projects, screenshot count, accessibility result, manual visual observations, known scope exclusions, and the exact next plans: Waline integration, server media workflow, and production deployment.

- [x] **Step 3: Mark completed plan checkboxes and commit evidence**

```powershell
git add docs/superpowers/plans/2026-07-12-static-blog-core.md docs/verification/static-core-acceptance.md
git commit -m "docs: record static core acceptance"
```

- [ ] **Step 4: Push the verified main branch**

Run: `git push origin main`

Expected: remote `main` points to the acceptance commit and GitHub Actions starts the same verification workflow.
