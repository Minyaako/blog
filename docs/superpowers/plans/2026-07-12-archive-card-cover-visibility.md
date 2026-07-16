# Archive Card Cover Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复归档卡片悬浮时图片越界的问题，并让 `隐藏封面` Tag 独立控制列表卡片封面。

**Architecture:** 保留 `toPostCard()` 作为所有文章列表的唯一展示数据转换入口，在该入口用精确 Tag 匹配决定是否输出 `cover`，同时继续用 `contentWarning` 生成安全摘要。`PostCard.astro` 只负责把图片缩放限制在独立图片容器内，不承担内容安全判断。

**Tech Stack:** Astro 7、TypeScript 6、Vitest 4、Playwright 1.61、组件作用域 CSS

## Global Constraints

- 专用控制 Tag 的精确值为 `隐藏封面`，区分大小写，不做模糊匹配或别名推断。
- 默认显示已配置的列表卡片封面，包括带 `contentWarning` 的视觉小说文章。
- `contentWarning` 继续控制安全摘要、正文确认弹窗、RSS、搜索数据和社交元数据保护。
- `隐藏封面` 只影响列表卡片，不删除文章页页首图，也不修改图片文件或版权信息。
- 保留现有约 `1.025` 倍悬浮缩放、卡片布局、断点、圆角和配色。
- 不引入新依赖，不实现归档筛选、标签检索或全站动效重构。

---

### Task 1: 解耦列表封面和内容提示

**Files:**
- Modify: `tests/unit/posts.test.ts`
- Modify: `src/lib/posts.ts`

**Interfaces:**
- Consumes: `CollectionEntry<'posts'>` 中现有的 `data.tags`、`data.cover` 和 `data.contentWarning`。
- Produces: `toPostCard(post): PostCardData`；`description` 仍由内容提示保护，`cover` 仅由 `隐藏封面` Tag 决定是否省略。

- [ ] **Step 1: 写出内容提示与封面解耦的失败测试**

在 `tests/unit/posts.test.ts` 中保留现有 fixture，并把原测试替换为以下两个测试；新增 `hiddenCover` fixture：

```ts
const hiddenCover = {
  ...sensitive,
  data: {
    ...sensitive.data,
    id: 'post-3',
    tags: ['视觉小说', '隐藏封面']
  }
}

it('keeps protected summaries without hiding covers', () => {
  const card = toPostCard(sensitive as never)
  expect(card.description).toBe('此内容需要确认后查看。')
  expect(card.cover).toEqual(sensitive.data.cover)
})

it('hides a configured cover only when the exact control tag is present', () => {
  expect(toPostCard(hiddenCover as never).cover).toBeUndefined()
  expect(
    toPostCard({
      ...hiddenCover,
      data: { ...hiddenCover.data, tags: ['视觉小说', '隐藏封面扩展'] }
    } as never).cover
  ).toEqual(sensitive.data.cover)
})
```

- [ ] **Step 2: 运行目标测试并确认按预期失败**

Run: `pnpm vitest run tests/unit/posts.test.ts`

Expected: `keeps protected summaries without hiding covers` 失败，实际 `card.cover` 为 `undefined`。

- [ ] **Step 3: 实现精确 Tag 控制**

在 `src/lib/posts.ts` 的 `toPostCard()` 中增加独立判断，并只替换 `cover` 的赋值：

```ts
export function toPostCard(post: CollectionEntry<'posts'>): PostCardData {
  const protectedContent = post.data.contentWarning.type !== 'none'
  const hideCover = post.data.tags.includes('隐藏封面')
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
    cover: hideCover ? undefined : post.data.cover,
    protected: protectedContent
  }
}
```

- [ ] **Step 4: 运行单元测试并确认通过**

Run: `pnpm vitest run tests/unit/posts.test.ts tests/unit/rss-safety.test.ts`

Expected: 两个测试文件全部通过；RSS 安全摘要行为保持不变。

- [ ] **Step 5: 提交数据转换改动**

```bash
git add tests/unit/posts.test.ts src/lib/posts.ts
git commit -m "feat: control card covers with tag"
```

### Task 2: 裁剪悬浮图片并验证视觉小说封面

**Files:**
- Modify: `tests/e2e/listings.spec.ts`
- Modify: `src/components/PostCard.astro`

**Interfaces:**
- Consumes: Task 1 输出的 `PostCardData.cover`，以及现有 `[data-post-card]`、`[data-card-image]` DOM 标记。
- Produces: 图片容器的计算样式 `overflow: hidden`；视觉小说卡片中的 `<img src="/images/posts/games-cover.webp">`。

- [ ] **Step 1: 扩展归档失败测试**

把 `tests/e2e/listings.spec.ts` 的首个测试扩展为：

```ts
test('archive cards keep images clipped and show the visual novel cover', async ({ page }) => {
  await page.goto('/archives')

  const firstCard = page.locator('[data-post-card]').first()
  await expect(firstCard.getByRole('heading')).toBeVisible()
  await expect(firstCard.getByRole('link')).toHaveAttribute('href', /\/posts\//)

  const imageRegion = firstCard.locator('[data-card-image]')
  await expect(imageRegion).toBeVisible()
  expect(await imageRegion.evaluate((element) => getComputedStyle(element).overflow)).toBe('hidden')

  const gameCard = page.locator('[data-post-card]', { hasText: '视觉小说中的记忆与重访' })
  await expect(gameCard.locator('[data-card-image] img')).toHaveAttribute(
    'src',
    '/images/posts/games-cover.webp'
  )
})
```

- [ ] **Step 2: 运行归档测试并确认按预期失败**

Run: `pnpm exec playwright test tests/e2e/listings.spec.ts --project=desktop`

Expected: 图片区域的计算样式当前为 `visible`，并且视觉小说卡片当前没有 `<img>`，测试失败。

- [ ] **Step 3: 给图片区域建立稳定裁剪和遮罩层**

在 `src/components/PostCard.astro` 中把相关样式调整为：

```css
.card-image {
  position: relative;
  overflow: hidden;
  min-height: 15rem;
  background: color-mix(in srgb, var(--card-accent) 18%, var(--surface));
}
.card-image::after {
  position: absolute;
  z-index: 1;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(90deg, var(--surface) 0%, transparent 35%);
  content: '';
}
.card-image img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transform-origin: center;
  transition: transform 280ms ease;
}
```

保留现有 `.card-link:hover img { transform: scale(1.025); }` 和移动端渐变覆盖规则。

- [ ] **Step 4: 运行归档测试并确认通过**

Run: `pnpm exec playwright test tests/e2e/listings.spec.ts --project=desktop`

Expected: 2 tests passed；视觉小说卡片显示 WebP 封面，图片区域计算样式为 `hidden`。

- [ ] **Step 5: 运行静态检查**

Run: `pnpm check`

Expected: `0 errors`、`0 warnings`、`0 hints`。

- [ ] **Step 6: 提交卡片修复**

```bash
git add tests/e2e/listings.spec.ts src/components/PostCard.astro
git commit -m "fix: contain archive card imagery"
```

### Task 3: 更新视觉基线并完成全量验证

**Files:**
- Modify: `tests/e2e/visual.spec.ts-snapshots/archive-light-desktop.png`
- Modify: `tests/e2e/visual.spec.ts-snapshots/archive-light-mobile.png`
- Modify: `tests/e2e/visual.spec.ts-snapshots/archive-light-tablet.png`
- Modify: `tests/e2e/visual.spec.ts-snapshots/archive-dark-desktop.png`
- Modify: `tests/e2e/visual.spec.ts-snapshots/archive-dark-mobile.png`
- Modify: `tests/e2e/visual.spec.ts-snapshots/archive-dark-tablet.png`
- Modify if changed by the shared list-card behavior: matching `home-light-*.png` and `home-dark-*.png` snapshots in the same directory

**Interfaces:**
- Consumes: Task 1 的封面数据规则和 Task 2 的图片裁剪样式。
- Produces: 已人工检查的首页/归档视觉基线，以及通过的完整构建和浏览器测试结果。

- [ ] **Step 1: 重新生成直接受影响的视觉快照**

Run: `pnpm exec playwright test tests/e2e/visual.spec.ts --grep "^(home|archive) (light|dark)$" --update-snapshots`

Expected: desktop、mobile、tablet 三个项目中的归档快照更新；如果首页“最新长文”包含视觉小说卡片，对应首页快照也更新。不得更新文章、About、搜索或 404 快照。

- [ ] **Step 2: 检查快照变更范围**

Run: `git status --short tests/e2e/visual.spec.ts-snapshots`

Expected: 只出现 `archive-*.png`，以及确实因视觉小说卡片显示封面而变化的 `home-*.png`。

- [ ] **Step 3: 运行完整验证**

Run: `pnpm build`

Expected: Astro check、Vitest、Astro build 和 Pagefind 全部成功。

Run: `pnpm test:e2e`

Expected: 所有 Playwright 功能、可访问性与视觉测试通过。

- [ ] **Step 4: 在本地浏览器做最终视觉检查**

保持 `http://127.0.0.1:4321/archives` 可访问，在桌面宽度检查以下结果：视觉小说卡片显示 `/images/posts/games-cover.webp`；鼠标移入学术、技术、生活和视觉小说卡片时，放大图片不会进入左侧文字区；渐变遮罩不跳动；卡片外圆角没有图片泄露。再以约 `390px` 宽度确认图片仍位于文字上方且没有横向溢出。

- [ ] **Step 5: 提交视觉基线**

```bash
git add tests/e2e/visual.spec.ts-snapshots
git commit -m "test: update card cover baselines"
```

- [ ] **Step 6: 确认工作树与本地服务状态**

Run: `git status --short`

Expected: 无输出。最终交付中报告三个提交、验证命令结果和本地访问地址；本地开发服务保持运行供用户复核。
