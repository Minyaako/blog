# 博客评论区首版实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为文章页接入懒加载 Waline 评论区，并部署一个可独立备份、恢复和管理的自托管评论服务。

**Architecture:** Astro 只增加一个评论组件和一个薄 Waline 适配器，永久文章 `id` 作为评论键。Waline 1.41.4 以独立 Compose 项目运行在 `server_proxy`，SQLite 数据、秘密和备份均与静态博客发布隔离；共享 `server-infra` 只增加 `comments.minyako.top` 的 Caddy 路由与服务索引。

**Tech Stack:** Astro 7、TypeScript 6、`@waline/client` 3.15.2、Vitest、Playwright、Waline Server 1.41.4、SQLite、Docker Compose、Caddy、PowerShell 基础设施测试。

**Spec:** `docs/superpowers/specs/2026-08-13-blog-comments-design.md`

## Global Constraints

- 保持实现简单：一个评论组件、一个薄适配器、一个独立 Compose 服务、一套最小数据脚本和一份运行手册。
- 不新增自定义 API、通用插件框架、自建管理后台、多数据库抽象或额外应用仓库。
- `path` 必须是文章永久 `id`，不得使用 slug 或 URL。
- 昵称必填；邮箱选填且不公开；不提供网站字段。
- 禁用登录入口、邮件、图片上传、表情包、文章反应、浏览量、验证码和 Akismet。
- 评论立即公开；`IPQPS=60`；隐藏访客 UA、地区和头像。
- 回复数据保持原关系，但 CSS 最多显示一层缩进。
- Waline 客户端固定为 `3.15.2`。
- Waline 服务固定为 `lizheming/waline:1.41.4@sha256:a3c87cb50fdb3aa786d73ac7afed492811d5dbc217866b12f3d5a4eda5c5e4bc`，禁止 `latest`。
- 不把管理员邮箱、临时密码、JWT、QQ 目标或任何真实秘密写入 Git、命令行参数、计划、日志或测试快照。
- 管理员密码修改是开放公网评论路由前的硬门；注册完成后通过 QQ 发送一次不含凭据的提醒并暂停。
- 本计划只分三个端到端任务；不要把配置项、样式选择器或单条断言继续拆成独立任务。

## 文件结构

博客仓库 `D:\seRver\apps\blog`：

- 修改 `package.json`、`pnpm-lock.yaml`：固定 Waline 客户端依赖。
- 修改 `src/lib/comments/contracts.ts`：只保留挂载与销毁接口。
- 创建 `src/lib/comments/waline.ts`：唯一 Waline 专属适配器和固定客户端配置。
- 创建 `src/components/CommentSection.astro`：语义结构、懒加载、失败状态、重试和样式边界。
- 修改 `src/layouts/ArticleLayout.astro`：用评论组件替换现有占位插槽。
- 创建 `tests/unit/comments.test.ts`：适配器配置、挂载、销毁和失败测试。
- 修改 `tests/e2e/article.spec.ts`、`tests/e2e/fixtures.ts`：文章键、字段、降级、主题、移动端和单层缩进。
- 创建 `deploy/comments/compose.yml`：独立 Waline 服务。
- 创建 `deploy/comments/waline.sqlite.sql`：固定 SQLite 初始表结构。
- 创建 `deploy/comments/bin/comments-data`：`init`、`backup`、`prune`、`verify` 四个数据子命令。
- 创建 `deploy/comments/blog-comments-backup.service`、`deploy/comments/blog-comments-backup.timer`：每日备份调度。
- 创建 `tests/unit/comments-deployment.test.ts`：镜像、网络、环境、卷、秘密和数据脚本契约。
- 修改 `docs/deployment.md`：安装、初始化、管理员注册、备份、恢复、升级和回滚。
- 创建 `docs/verification/blog-comments-acceptance.md`：生产验收证据模板和最终记录。

基础设施仓库 `D:\seRver`：

- 创建 `infra/caddy/sites-available/blog-comments.caddy`：评论域名路由。
- 修改 `tests/blog-infra.test.ps1`：验证域名、上游、安全头和无根域污染。
- 修改 `docs/remote-sync-table.md`：登记评论服务、数据、备份和发布状态。

---

### Task 1: 文章页评论组件与薄 Waline 适配器

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `src/lib/comments/contracts.ts`
- Create: `src/lib/comments/waline.ts`
- Create: `src/components/CommentSection.astro`
- Modify: `src/layouts/ArticleLayout.astro`
- Create: `tests/unit/comments.test.ts`
- Modify: `tests/e2e/fixtures.ts`
- Modify: `tests/e2e/article.spec.ts`

**Interfaces:**
- Consumes: `post.data.id: string` from `ArticleLayout.astro`.
- Produces: `CommentProvider.mount(target: HTMLElement, pageKey: string): Promise<void>` and `CommentProvider.dispose(): void`.
- Produces: `createWalineProvider(dependencies?: WalineDependencies): CommentProvider`.
- Produces: `<CommentSection pageKey={data.id} />` with `[data-comment-slot]`, `[data-comment-mount]`, `[data-comment-status]`, and `[data-comment-retry]` hooks.

- [ ] **Step 1: Add the pinned client and write failing adapter tests**

Run:

```powershell
pnpm add @waline/client@3.15.2 --save-exact
```

Replace `src/lib/comments/contracts.ts` with:

```ts
export interface CommentProvider {
  mount(target: HTMLElement, pageKey: string): Promise<void>
  dispose(): void
}
```

Create `tests/unit/comments.test.ts` with injected dependencies so the test never contacts production:

```ts
import { describe, expect, it, vi } from 'vitest'
import { WALINE_OPTIONS, createWalineProvider } from '../../src/lib/comments/waline'

describe('Waline comment provider', () => {
  it('uses the approved guest-only configuration and permanent page key', async () => {
    const destroy = vi.fn()
    const init = vi.fn(() => ({ destroy }))
    const probe = vi.fn().mockResolvedValue(undefined)
    const provider = createWalineProvider({ load: async () => ({ init }), probe })
    const target = {} as HTMLElement

    await provider.mount(target, 'engineering-astro-content-architecture')

    expect(probe).toHaveBeenCalledOnce()
    expect(init).toHaveBeenCalledWith({
      ...WALINE_OPTIONS,
      el: target,
      path: 'engineering-astro-content-architecture'
    })
    expect(WALINE_OPTIONS).toMatchObject({
      serverURL: 'https://comments.minyako.top',
      lang: 'zh-CN',
      meta: ['nick', 'mail'],
      requiredMeta: ['nick'],
      login: 'disable',
      imageUploader: false,
      emoji: false,
      reaction: false,
      pageview: false,
      commentSorting: 'latest'
    })
    expect(WALINE_OPTIONS).not.toHaveProperty('turnstileKey')
    expect(WALINE_OPTIONS).not.toHaveProperty('recaptchaV3Key')
  })

  it('mounts once, destroys the client, and allows a clean retry after failure', async () => {
    const destroy = vi.fn()
    const init = vi.fn(() => ({ destroy }))
    const probe = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined)
    const provider = createWalineProvider({ load: async () => ({ init }), probe })
    const target = {} as HTMLElement

    await expect(provider.mount(target, 'post-id')).rejects.toThrow('offline')
    await provider.mount(target, 'post-id')
    await provider.mount(target, 'post-id')
    expect(init).toHaveBeenCalledTimes(1)

    provider.dispose()
    expect(destroy).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run:

```powershell
pnpm exec vitest run tests/unit/comments.test.ts
```

Expected: FAIL because `src/lib/comments/waline.ts` does not exist and `getPageViews` was removed from the contract.

- [ ] **Step 3: Implement the minimal provider**

Create `src/lib/comments/waline.ts` with this shape:

```ts
import type { WalineInitOptions, WalineInstance } from '@waline/client'
import type { CommentProvider } from './contracts'

const COMMENT_SERVER_URL = 'https://comments.minyako.top'

export const WALINE_OPTIONS = {
  serverURL: COMMENT_SERVER_URL,
  lang: 'zh-CN',
  meta: ['nick', 'mail'],
  requiredMeta: ['nick'],
  login: 'disable',
  imageUploader: false,
  emoji: false,
  reaction: false,
  pageview: false,
  comment: false,
  commentSorting: 'latest',
  dark: "html[data-theme='dark']",
  locale: {
    nick: '昵称（必填）',
    mail: '邮箱（选填，不公开）',
    link: '',
    placeholder: '支持链接、引用和代码；请友善交流。'
  }
} satisfies Omit<WalineInitOptions, 'el' | 'path'>

type WalineModule = { init(options: WalineInitOptions): WalineInstance }

export interface WalineDependencies {
  load(): Promise<WalineModule>
  probe(): Promise<void>
}

const defaults: WalineDependencies = {
  load: () => import('@waline/client'),
  probe: async () => {
    const response = await fetch(COMMENT_SERVER_URL, {
      headers: { Accept: 'text/html' },
      signal: AbortSignal.timeout(5000)
    })
    if (!response.ok) throw new Error(`Comment service returned ${response.status}`)
  }
}

export function createWalineProvider(
  dependencies: WalineDependencies = defaults
): CommentProvider {
  let instance: WalineInstance | undefined
  let mounting: Promise<void> | undefined

  return {
    mount(target, pageKey) {
      if (instance) return Promise.resolve()
      if (mounting) return mounting
      mounting = (async () => {
        await dependencies.probe()
        const { init } = await dependencies.load()
        instance = init({ ...WALINE_OPTIONS, el: target, path: pageKey })
      })().finally(() => { mounting = undefined })
      return mounting
    },
    dispose() {
      instance?.destroy()
      instance = undefined
    }
  }
}
```

If `WalineLocale` rejects one of the literal keys in 3.15.2, keep only supported locale keys and put the privacy sentence in the Astro component; do not loosen TypeScript with `any`.

- [ ] **Step 4: Add the component and article integration, then make browser tests fail first**

Create `src/components/CommentSection.astro` with:

- a `<section aria-labelledby="comments-heading" data-comment-slot data-page-key={pageKey} data-pagefind-ignore>`;
- visible copy “评论”“昵称必填；邮箱选填且不会公开。首版不发送邮件。”;
- a mount element `[data-comment-mount]`;
- a live status `[data-comment-status]` containing “评论加载中…” initially;
- a hidden retry `<button type="button" data-comment-retry>重试</button>`;
- an inline module script that creates one provider, observes the section with `rootMargin: '400px 0px'`, calls `mount`, switches to the failure copy “评论暂时不可用”, and retries from the button;
- a direct-load fallback when `IntersectionObserver` is unavailable;
- cleanup on `astro:before-swap` and `pagehide` by disconnecting the observer and calling `dispose()`.

Import `@waline/client/waline.css` and map Waline CSS variables to the existing tokens. Hide `.wl-avatar`, `.wl-login-info`, `.wl-power`, and all website/login controls verified against 3.15.2. Enforce one visual reply level with:

```css
:global(.wl-comment-children) { margin-inline-start: var(--space-5); }
:global(.wl-comment-children .wl-comment-children) { margin-inline-start: 0; }
@media (max-width: 44rem) {
  :global(.wl-comment-children) { margin-inline-start: var(--space-3); }
}
```

Modify `ArticleLayout.astro` to import `CommentSection` and replace the existing `.comment-slot` placeholder with:

```astro
<CommentSection pageKey={data.id} />
```

Remove only the obsolete `.comment-slot` style from `ArticleLayout.astro`.

Extend `tests/e2e/fixtures.ts` so comment requests default to an empty successful Waline response and no request can reach the real comment domain. Add these focused cases to `tests/e2e/article.spec.ts`:

```ts
test('comment section keeps the permanent article id and guest-only fields', async ({ page }) => {
  await page.goto('/posts/astro-content-architecture')
  const comments = page.locator('[data-comment-slot]')
  await expect(comments).toHaveAttribute('data-page-key', 'engineering-astro-content-architecture')
  await comments.scrollIntoViewIfNeeded()
  await expect(comments.getByText('昵称必填；邮箱选填且不会公开。首版不发送邮件。')).toBeVisible()
  await expect(comments.locator('input[name="nick"]')).toBeVisible()
  await expect(comments.locator('input[name="mail"]')).toBeVisible()
  await expect(comments.locator('input[name="link"]')).toHaveCount(0)
  await expect(comments.getByRole('button', { name: /登录|上传图片/ })).toHaveCount(0)
})

test('comment outage leaves the article readable and offers retry', async ({ page }) => {
  await page.route('https://comments.minyako.top/**', (route) => route.abort('failed'))
  await page.goto('/posts/astro-content-architecture')
  await page.locator('[data-comment-slot]').scrollIntoViewIfNeeded()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Astro')
  await expect(page.locator('[data-comment-status]')).toContainText('评论暂时不可用')
  await expect(page.locator('[data-comment-retry]')).toBeVisible()
})
```

Add mocked Waline markup with three nested `.wl-comment-children` containers to a test-only route fulfillment and assert computed `marginInlineStart` is nonzero for the first reply and `0px` for deeper replies on desktop and mobile. Toggle `data-theme` and run the existing Axe helper against the comment section.

- [ ] **Step 5: Run focused checks, then the complete blog gate**

Run:

```powershell
pnpm exec vitest run tests/unit/comments.test.ts
pnpm exec playwright test tests/e2e/article.spec.ts --project=desktop --project=mobile
pnpm check
pnpm build
pnpm test:e2e
```

Expected: all commands PASS; no request reaches the production comment service during tests; visual snapshots change only for article pages that now contain the stable pre-load comment shell.

- [ ] **Step 6: Commit the frontend slice**

```powershell
git add package.json pnpm-lock.yaml src/lib/comments src/components/CommentSection.astro src/layouts/ArticleLayout.astro tests/unit/comments.test.ts tests/e2e/fixtures.ts tests/e2e/article.spec.ts tests/e2e/visual.spec.ts-snapshots
git commit -m "feat: add lazy blog comments client"
```

### Task 2: 独立 Waline 服务、SQLite 数据保护与运行手册

**Files:**
- Create: `deploy/comments/compose.yml`
- Create: `deploy/comments/waline.sqlite.sql`
- Create: `deploy/comments/bin/comments-data`
- Create: `deploy/comments/blog-comments-backup.service`
- Create: `deploy/comments/blog-comments-backup.timer`
- Create: `tests/unit/comments-deployment.test.ts`
- Modify: `docs/deployment.md`
- Create: `docs/verification/blog-comments-acceptance.md`

**Interfaces:**
- Consumes: external Docker network `server_proxy` and secret file `/srv/secrets/blog-comments/waline.env`.
- Produces: internal upstream `blog-comments:8360`.
- Produces: SQLite file `/srv/apps/blog-comments/data/waline.sqlite`.
- Produces: `comments-data init|backup|prune|verify [backup-file]`.
- Produces: backups under `/srv/backups/blog-comments/daily` and `/srv/backups/blog-comments/weekly`.

- [ ] **Step 1: Write failing deployment-contract tests**

Create `tests/unit/comments-deployment.test.ts`. Parse `deploy/comments/compose.yml` with the existing `yaml` dependency and assert:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const read = (path: string) => readFileSync(path, 'utf8')

describe('blog comments deployment', () => {
  it('pins and isolates the Waline service', () => {
    const compose = parse(read('deploy/comments/compose.yml'))
    const service = compose.services['blog-comments']
    expect(service.image).toBe('lizheming/waline:1.41.4@sha256:a3c87cb50fdb3aa786d73ac7afed492811d5dbc217866b12f3d5a4eda5c5e4bc')
    expect(service.ports).toBeUndefined()
    expect(service.networks.server_proxy.aliases).toEqual(['blog-comments'])
    expect(service.env_file).toEqual(['/srv/secrets/blog-comments/waline.env'])
    expect(service.volumes).toEqual(['/srv/apps/blog-comments/data:/app/data'])
  })

  it('keeps the approved runtime policy explicit', () => {
    const composeText = read('deploy/comments/compose.yml')
    for (const expected of [
      'SQLITE_PATH: /app/data',
      'SQLITE_DB: waline',
      'SITE_URL: https://gsk.minyako.top',
      'SERVER_URL: https://comments.minyako.top',
      'SECURE_DOMAINS: gsk.minyako.top,comments.minyako.top',
      'COMMENT_AUDIT: "false"',
      'IPQPS: "60"',
      'AKISMET_KEY: "false"',
      'DISABLE_USERAGENT: "true"',
      'DISABLE_REGION: "true"',
      'AVATAR_PROXY: "false"',
      'GRAVATAR_STR: "data:image/svg+xml',
      `MARKDOWN_CONFIG: '{"html":false}'`
    ]) expect(composeText).toContain(expected)
    expect(composeText).not.toMatch(/SMTP_|TURNSTILE|RECAPTCHA|latest/)
  })

  it('uses a consistent SQLite backup and retention contract', () => {
    const script = read('deploy/comments/bin/comments-data')
    expect(script).toContain(".backup '/backup/")
    expect(script).toContain('PRAGMA integrity_check')
    expect(script).toContain('sha256sum')
    expect(script).toContain('-mtime +14')
    expect(script).toContain('-mtime +56')
  })
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
pnpm exec vitest run tests/unit/comments-deployment.test.ts
```

Expected: FAIL because `deploy/comments/compose.yml` and data tooling do not exist.

- [ ] **Step 3: Add the fixed Compose service and schema**

Create `deploy/comments/compose.yml` with one service named `blog-comments`:

```yaml
services:
  blog-comments:
    image: lizheming/waline:1.41.4@sha256:a3c87cb50fdb3aa786d73ac7afed492811d5dbc217866b12f3d5a4eda5c5e4bc
    restart: unless-stopped
    env_file:
      - /srv/secrets/blog-comments/waline.env
    environment:
      TZ: Asia/Shanghai
      SQLITE_PATH: /app/data
      SQLITE_DB: waline
      SITE_NAME: Minyako Blog
      SITE_URL: https://gsk.minyako.top
      SERVER_URL: https://comments.minyako.top
      SECURE_DOMAINS: gsk.minyako.top,comments.minyako.top
      COMMENT_AUDIT: "false"
      IPQPS: "60"
      AKISMET_KEY: "false"
      DISABLE_USERAGENT: "true"
      DISABLE_REGION: "true"
      DISABLE_AUTHOR_NOTIFY: "true"
      AVATAR_PROXY: "false"
      GRAVATAR_STR: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"
      MARKDOWN_CONFIG: '{"html":false}'
    volumes:
      - /srv/apps/blog-comments/data:/app/data
    healthcheck:
      test: [CMD, node, -e, "fetch('http://127.0.0.1:8360/').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
      interval: 15s
      timeout: 5s
      retries: 6
      start_period: 15s
    networks:
      server_proxy:
        aliases: [blog-comments]

networks:
  server_proxy:
    external: true
```

Create `deploy/comments/waline.sqlite.sql` from Waline 1.41.4's `assets/waline.sqlite.sql`, retaining its GPL attribution comment and exact `wl_Comment`, `wl_Counter`, and `wl_Users` schema. Do not download a moving `main` branch schema during production installation.

The secret file contains exactly one `JWT_TOKEN` assignment. Generate its value interactively on the server and enter it through an editor that does not expose it in process arguments or shell history. Never create a tracked real `.env` file and never put an example secret value in the repository.

- [ ] **Step 4: Implement one reusable data script and timer**

Create POSIX `deploy/comments/bin/comments-data` with `set -eu`, explicit roots, and four subcommands:

- `init`: create `/srv/apps/blog-comments/data/waline.sqlite` only if absent, using pinned helper image `keinos/sqlite3:3.50.4@sha256:7ea29f0c7e91a8c3f315e831459d07000f34e9e9b25fbc30be2e0481b3e0450f` and the repository schema mounted read-only;
- `backup`: invoke SQLite `.backup` into a same-filesystem temporary file, run `PRAGMA integrity_check`, gzip it, write `.sha256`, and atomically move both into `daily/`;
- `prune`: delete daily pairs older than 14 days; each Sunday copy that day's verified pair into `weekly/`; delete weekly pairs older than 56 days;
- `verify <file.gz>`: verify the adjacent checksum, decompress into a private temporary directory, run `PRAGMA integrity_check`, print only counts for `wl_Comment`, replies with nonzero `rid`/`pid`, and admin users, then remove the temporary directory through a trap.

Use fixed variables, not user-provided path concatenation:

```sh
data_root=/srv/apps/blog-comments/data
backup_root=/srv/backups/blog-comments
db_file="$data_root/waline.sqlite"
sqlite_image='keinos/sqlite3:3.50.4@sha256:7ea29f0c7e91a8c3f315e831459d07000f34e9e9b25fbc30be2e0481b3e0450f'
```

Create `deploy/comments/blog-comments-backup.service` as a oneshot service executing `/usr/local/sbin/comments-data backup` followed by `prune`. Create `deploy/comments/blog-comments-backup.timer` with `OnCalendar=daily`, `Persistent=true`, and a randomized delay under 30 minutes.

- [ ] **Step 5: Document exact install, restore, upgrade, and rollback commands**

Append a “评论服务” section to `docs/deployment.md` covering:

1. server directories and modes (`/srv/apps/blog-comments`, `/srv/secrets/blog-comments`, `/srv/backups/blog-comments`);
2. interactive creation of `waline.env` with editor input, never shell history or command arguments;
3. copying Compose, schema, script and systemd units from the checked-out immutable blog commit;
4. `comments-data init`, `docker compose config`, `docker compose up -d`, and health/log checks;
5. SSH tunnel registration while no Caddy route exists;
6. backup timer enablement and `comments-data verify`;
7. a restore drill into `/srv/apps/blog-comments-restore/data` plus a temporary container bound only to `127.0.0.1`;
8. upgrade sequence: backup, record old image/digest, update fixed image, health check, rollback image first, restore DB only after confirmed incompatible migration;
9. explicit warning that blog deploy/rollback never manipulates comment service or database.

Create `docs/verification/blog-comments-acceptance.md` with unchecked evidence rows for commit SHA, image digest, DNS/TLS, root comment, deep reply, rate limit, admin deletion, outage fallback, backup checksum, restore drill and password-change confirmation. Do not put email addresses, passwords, JWT values or full IP addresses in the evidence file.

- [ ] **Step 6: Run service checks and a disposable container smoke test**

Run locally:

```powershell
pnpm exec vitest run tests/unit/comments-deployment.test.ts
docker compose -f deploy/comments/compose.yml config
pnpm build
```

On a temporary Linux directory or the server staging area, with a generated throwaway JWT and throwaway data/backup roots, run the schema initialization, start the pinned Waline container without a public host binding, wait for health, run `comments-data backup`, and run `comments-data verify` against the generated backup. Remove only the explicitly named temporary container and directories after resolving their absolute paths.

Expected: configuration and tests PASS; SQLite reports `ok`; the backup has a matching checksum; the production data root remains untouched.

- [ ] **Step 7: Commit the service slice**

```powershell
git add deploy/comments tests/unit/comments-deployment.test.ts docs/deployment.md docs/verification/blog-comments-acceptance.md
git commit -m "feat: add isolated blog comments service"
```

### Task 3: 受控生产上线、管理员注册、QQ 密码提醒与验收

**Files:**
- Create in `server-infra`: `infra/caddy/sites-available/blog-comments.caddy`
- Modify in `server-infra`: `tests/blog-infra.test.ps1`
- Modify in `server-infra`: `docs/remote-sync-table.md`
- Update in blog: `docs/verification/blog-comments-acceptance.md`

**Interfaces:**
- Consumes: healthy Docker upstream `blog-comments:8360` on `server_proxy`.
- Produces: `https://comments.minyako.top` and `https://comments.minyako.top/ui`.
- Human gate: one administrator is registered with session-provided credentials, then the temporary password is changed before public route activation.
- QQ output: one short reminder without credentials, logs, JWT, IP address or email.

- [ ] **Step 1: Create an isolated `server-infra` worktree and write the failing route test**

The root repository currently contains unrelated user changes. Do not edit or stage them. From `D:\seRver`, fetch and create a separate worktree/branch from the latest `origin/main`, then add a focused assertion to `tests/blog-infra.test.ps1` requiring:

- exactly one top-level label `comments.minyako.top`;
- `reverse_proxy blog-comments:8360`;
- the same `X-Content-Type-Options nosniff` and `Referrer-Policy strict-origin-when-cross-origin` headers as the blog route;
- no host port, root-domain route, legacy-domain redirect or fallback upstream in this file.

Run:

```powershell
pwsh -NoProfile -File tests/blog-infra.test.ps1
```

Expected: FAIL because `infra/caddy/sites-available/blog-comments.caddy` does not exist.

- [ ] **Step 2: Add the smallest Caddy route and update the service index**

Create `infra/caddy/sites-available/blog-comments.caddy`:

```caddyfile
comments.minyako.top {
    encode zstd gzip
    header {
        X-Content-Type-Options nosniff
        Referrer-Policy strict-origin-when-cross-origin
    }
    reverse_proxy blog-comments:8360
}
```

Add one `Blog comments` row to `docs/remote-sync-table.md` with local owner `D:\seRver\apps\blog`, remote app path `/srv/apps/blog-comments`, initial state `domain-bound` only after TLS and route verification, endpoint `https://comments.minyako.top`, SQLite path represented without contents, and backup path `/srv/backups/blog-comments`. Keep application details linked to the blog runbook.

Run:

```powershell
pwsh -NoProfile -File tests/blog-infra.test.ps1
```

Expected: PASS.

- [ ] **Step 3: Commit the infrastructure route independently**

```powershell
git add infra/caddy/sites-available/blog-comments.caddy tests/blog-infra.test.ps1 docs/remote-sync-table.md
git commit -m "feat: route blog comments service"
```

Do not merge or deploy this route yet.

- [ ] **Step 4: Install the comment service without a public route and register the administrator**

Deploy the Task 2 files to their documented remote paths, create the secret interactively, initialize SQLite, start the pinned container, and verify its health from the server network. Do not install/enable the Caddy route yet.

Open an SSH tunnel to the Waline service from the local machine. Use browser automation or the visible browser to register exactly one administrator with the email and temporary password supplied in this conversation. Enter both through form fields; never embed them in shell commands, URLs, screenshots, test artifacts, QQ messages or tracked files. Verify login, the empty comment list, and delete permission through the private tunnel.

- [ ] **Step 5: Send the QQ password-change reminder and stop at the human gate**

Use the `qq-notify` skill only after registration succeeds. Send one concise message equivalent to:

```text
博客评论后台管理员已通过私有通道创建并验证完成，正式评论域名尚未开放。请现在修改临时密码，完成后回到当前 Codex 任务确认；我收到确认后再继续开放评论区。不要在 QQ 中回复或转发密码。
```

Include the active task `chat_id` and continuation command required by the QQ bridge, but do not include the administrator email, temporary password, JWT, host IP or logs. Stop all rollout work and wait for the user's explicit confirmation that the password has been changed.

- [ ] **Step 6: Enable DNS/Caddy only after password-change confirmation**

After explicit confirmation:

1. create/verify the `comments.minyako.top` DNS record;
2. copy the reviewed Caddy file into the shared gateway's enabled-site directory;
3. validate the complete Caddy configuration before reload;
4. reload Caddy and verify TLS;
5. verify `/`, `/ui`, and CORS/referrer behavior from `gsk.minyako.top`;
6. enable and inspect the backup timer.

If any step fails, remove only the new enabled-site file or restore its timestamped backup, reload the last valid Caddy configuration, and leave the healthy private comment container and SQLite data intact.

- [ ] **Step 7: Run the full production acceptance and record evidence**

Using a dedicated published test article:

1. publish one guest root comment with nickname only;
2. publish a reply and a reply-to-reply; confirm both reply levels preserve target context but have only one visual indent;
3. submit twice within 60 seconds and confirm the second is rate-limited;
4. verify email, website, login, upload, emoji and pageview controls are absent as designed;
5. log in as administrator and mark/delete the test comment;
6. stop only the comment container and confirm the article remains readable with retry UI;
7. restart it and confirm comments return;
8. create a backup, verify checksum and integrity, restore to a temporary directory/container, and confirm root/reply/admin counts plus private-tunnel administrator login;
9. run `pnpm build`, the focused Playwright article tests, and `tests/blog-infra.test.ps1` against their respective repositories.

Record timestamps, commit SHAs, image digests and redacted results in `docs/verification/blog-comments-acceptance.md`. Do not record comment IPs, email addresses, passwords, JWTs or raw database rows.

- [ ] **Step 8: Commit acceptance evidence and leave both worktrees clean**

In the blog repository:

```powershell
git add docs/verification/blog-comments-acceptance.md
git commit -m "docs: verify blog comments release"
```

In `server-infra`, update the comments row to `prod-ready` only when HTTPS, logs, backup, restore and rollback evidence are complete, then commit that single documentation change. Run `git status --short` in both worktrees and confirm no unrelated files are staged or modified.

## Final verification

Before claiming completion, run and retain concise results for:

```powershell
# blog worktree
pnpm check
pnpm test:unit
pnpm build
pnpm test:e2e
docker compose -f deploy/comments/compose.yml config

# server-infra worktree
pwsh -NoProfile -File tests/blog-infra.test.ps1
```

Also verify from production that the blog remains readable with Waline stopped, the pinned image digest is running, the backup timer has a successful invocation, and the most recent backup passes checksum plus SQLite integrity validation.
