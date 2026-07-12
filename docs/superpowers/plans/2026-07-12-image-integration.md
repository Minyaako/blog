# Image Asset Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Archive the seven source PNG files in the server shared asset library, commit only optimized WebP derivatives to the blog, and connect them to the avatar, one-minute home crossfade, and four existing article headers.

**Architecture:** Source PNG files are verified and uploaded to `/srv/shared-assets/source-images/minyako/blog/2026-initial/`, then removed from the blog worktree. The static Astro site serves named WebP derivatives from `public/images`; `HeroBanner.astro` owns a dependency-free two-slide timer, while article frontmatter remains the single source of cover metadata.

**Tech Stack:** Astro 7, TypeScript, CSS, browser JavaScript, Playwright, Vitest, FFmpeg/libwebp, OpenSSH/SCP, Ubuntu `sha256sum`.

## Global Constraints

- The blog Git repository stores WebP derivatives only; no source PNG may be committed.
- The server source directory is exactly `/srv/shared-assets/source-images/minyako/blog/2026-initial/`.
- The source library is not a Caddy public root and receives no public URL in this task.
- Home rotation interval is exactly 60,000 ms and the opacity transition is approximately 1.2 seconds.
- `prefers-reduced-motion: reduce` disables automatic rotation and leaves slide one active.
- Images `3.png` through `6.png` are headers for the four existing articles only; they are not inserted into MDX bodies.
- Sensitive-card, RSS, search, and social-image protections remain intact.
- Existing archive hover and filtering issues remain out of scope.
- Do not modify or stage the root repository's pre-existing untracked Chinese documentation files.

---

### Task 1: Archive and Verify Source PNG Files

**Files:**
- Source only: `pics/head.png`, `pics/1.png` through `pics/6.png`
- Remote create: `/srv/shared-assets/source-images/minyako/blog/2026-initial/profile/avatar.png`
- Remote create: `/srv/shared-assets/source-images/minyako/blog/2026-initial/home/hero-01.png`
- Remote create: `/srv/shared-assets/source-images/minyako/blog/2026-initial/home/hero-02.png`
- Remote create: `/srv/shared-assets/source-images/minyako/blog/2026-initial/posts/{academic,engineering,life,games}.png`
- Remote create: `/srv/shared-assets/source-images/minyako/blog/2026-initial/SHA256SUMS`

**Interfaces:**
- Consumes: the seven user-provided PNG files and SSH alias `tencent-server`.
- Produces: seven remotely archived originals whose SHA-256 hashes match the local inputs.

- [ ] **Step 1: Record local source hashes and dimensions**

Run a PowerShell read-only inventory using `Get-FileHash -Algorithm SHA256` and `System.Drawing.Image::FromFile`. Expected: seven PNG files; `head.png` plus `1.png`–`6.png`, all with non-zero dimensions and unique hashes.

- [ ] **Step 2: Create the private remote collection structure**

Run:

```powershell
ssh tencent-server "install -d -m 0750 /srv/shared-assets/source-images/minyako/blog/2026-initial/{profile,home,posts}"
```

Expected: command exits 0; no Caddy configuration is changed.

- [ ] **Step 3: Upload sources under descriptive names**

Use `scp` for these exact mappings:

```text
head.png -> profile/avatar.png
1.png    -> home/hero-01.png
2.png    -> home/hero-02.png
3.png    -> posts/academic.png
4.png    -> posts/engineering.png
5.png    -> posts/life.png
6.png    -> posts/games.png
```

- [ ] **Step 4: Verify the remote copies before removing local sources**

Run remote `sha256sum` for all seven descriptive files, compare each hash with Step 1, and write the verified remote output to `SHA256SUMS`. Expected: seven exact matches and remote file count 7, excluding the checksum manifest.

- [ ] **Step 5: Preserve the local inputs until WebP derivation is complete**

Do not remove `pics/` in this task. Task 2 consumes these verified local copies and removes them only after all WebP outputs decode successfully.

### Task 2: Produce Repository WebP Derivatives

**Files:**
- Create: `public/images/profile/avatar.webp`
- Create: `public/images/home/hero-01.webp`
- Create: `public/images/home/hero-02.webp`
- Create: `public/images/posts/academic-cover.webp`
- Create: `public/images/posts/engineering-cover.webp`
- Create: `public/images/posts/life-cover.webp`
- Create: `public/images/posts/games-cover.webp`
- Remove after verification: `pics/`

**Interfaces:**
- Consumes: the seven locally verified PNGs from Task 1.
- Produces: seven browser-delivery WebP paths referenced by Tasks 3 and 4.

- [ ] **Step 1: Convert all PNG sources with libwebp**

For each source, run FFmpeg with `-c:v libwebp -quality 82 -compression_level 6`, preserving original dimensions and aspect ratio. Use the exact output paths above and overwrite only those named derivatives.

- [ ] **Step 2: Validate outputs**

Use `ffprobe` to assert codec `webp`, expected non-zero width/height, and one video frame for every file. Confirm each WebP is smaller than its source PNG. Expected: seven valid WebP images.

- [ ] **Step 3: Remove the temporary local PNG directory**

After Tasks 1 and 2 both pass, remove the seven files and the now-empty `pics/` directory. Run `git status --short` and confirm no `.png` path from `pics/` is staged or tracked.

- [ ] **Step 4: Commit the delivery assets**

```powershell
git add public/images/profile/avatar.webp public/images/home/hero-01.webp public/images/home/hero-02.webp public/images/posts/*.webp
git commit -m "assets: add optimized blog imagery"
```

### Task 3: Implement the One-Minute Home Crossfade

**Files:**
- Modify: `tests/e2e/home.spec.ts`
- Modify: `src/components/HeroBanner.astro`
- Modify: `src/components/ProfileStrip.astro`

**Interfaces:**
- Consumes: `/images/home/hero-01.webp`, `/images/home/hero-02.webp`, and `/images/profile/avatar.webp`.
- Produces: `[data-hero-slide]`, `[data-active='true']`, and a 60,000 ms accessible rotation contract.

- [ ] **Step 1: Write failing home rotation tests**

Add a Playwright test that installs the browser clock before navigation, confirms two `[data-hero-slide]` images exist, confirms slide one has `data-active="true"`, advances 60,000 ms, and expects slide two to become active. Add a second test with reduced motion enabled that advances 120,000 ms and expects slide one to remain active.

- [ ] **Step 2: Run the focused tests to verify red state**

Run:

```powershell
pnpm exec playwright test tests/e2e/home.spec.ts --project=desktop
```

Expected: new tests fail because the existing component has only one image and no active-slide state.

- [ ] **Step 3: Implement the slides and timer**

Render two absolutely stacked images. Give the active image opacity 1 and inactive image opacity 0, with `transition: opacity 1.2s ease`. A component script must:

```ts
const intervalMs = 60_000
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
```

It starts one interval only when motion is allowed and the page is visible, clears it when hidden, restarts it when visible, and updates `data-active` plus `aria-hidden`. Use meaningful Chinese alt text. Update the caption to state that third-party rights are retained.

- [ ] **Step 4: Replace the profile image path**

Update `ProfileStrip.astro` to `/images/profile/avatar.webp`, retain the existing circular crop, and set intrinsic dimensions to the derivative's real dimensions.

- [ ] **Step 5: Verify and commit home behavior**

Run the focused home tests on desktop and mobile, then `pnpm check`. Expected: rotation, reduced-motion, layout, and overflow tests pass with zero Astro diagnostics.

```powershell
git add src/components/HeroBanner.astro src/components/ProfileStrip.astro tests/e2e/home.spec.ts
git commit -m "feat: add timed home imagery"
```

### Task 4: Connect Four Existing Article Headers

**Files:**
- Modify: `src/content/posts/academic/embodied-ai-reading.mdx`
- Modify: `src/content/posts/engineering/astro-content-architecture.mdx`
- Modify: `src/content/posts/life/july-field-notes.mdx`
- Modify: `src/content/posts/games/visual-novel-memory.mdx`
- Modify: `src/layouts/ArticleLayout.astro`
- Modify: `tests/e2e/article.spec.ts`
- Modify: `tests/e2e/warnings.spec.ts`

**Interfaces:**
- Consumes: the four `/images/posts/*-cover.webp` derivatives.
- Produces: correct `cover.url`, `cover.alt`, and `cover.credit` metadata plus a sensitive article header visible only after confirmation.

- [ ] **Step 1: Write failing article-header tests**

For the academic, engineering, and life routes, assert `.cover img` has the expected WebP suffix. For the game route, assert the content dialog is visible, click “确认并继续”, then assert `.cover img` ends in `/images/posts/games-cover.webp`.

- [ ] **Step 2: Run focused tests to verify red state**

Run desktop `article.spec.ts` and `warnings.spec.ts`. Expected: WebP path assertions fail and the sensitive page has no header image.

- [ ] **Step 3: Update frontmatter only**

Set the four cover URLs to their mapped WebP paths. Write accurate Chinese alt text and `credit: 用户提供图片`. Do not modify the inline life/game `<figure>` elements in MDX.

- [ ] **Step 4: Render the sensitive header behind the warning gate**

Allow `ArticleLayout.astro` to render the configured cover for every article. Preserve the existing safe social-image condition, `toPostCard()` cover suppression, RSS safe conversion, and Pagefind exclusion. The native dialog remains the first interaction and obscures the page until confirmation.

- [ ] **Step 5: Verify safety and commit article mapping**

Run article, warning, listing, search, and RSS safety tests. Expected: all pass; protected cards and feed items still contain no game cover URL.

```powershell
git add src/content/posts src/layouts/ArticleLayout.astro tests/e2e/article.spec.ts tests/e2e/warnings.spec.ts
git commit -m "feat: map article header imagery"
```

### Task 5: Visual Acceptance and Local Handoff

**Files:**
- Modify: `tests/e2e/visual.spec.ts-snapshots/*.png`
- Create: `docs/verification/image-integration-acceptance.md`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: reviewed visual baselines, durable source/derivative evidence, and a live local URL.

- [ ] **Step 1: Run the complete non-visual gate**

Run `pnpm check`, `pnpm test:unit`, `pnpm build`, and focused functional E2E tests. Expected: zero diagnostics, 11+ unit tests, 36 static pages, and no browser failures.

- [ ] **Step 2: Update and inspect visual baselines**

Run the visual suite with `--update-snapshots`, inspect representative desktop/mobile/tablet images for avatar crop, hero crop, one-minute initial state, article focal points, dark-mode contrast, and warning coverage, then rerun without update. Expected: all 42 visual tests pass with no pixel differences on the second run.

- [ ] **Step 3: Write acceptance evidence**

Record local derivative sizes, remote source path and verified hash count, changed routes, test results, visual observations, rights caveat, and the deferred archive/motion work in `docs/verification/image-integration-acceptance.md`. Do not record secret credentials or private keys.

- [ ] **Step 4: Commit acceptance evidence and baselines**

```powershell
git add tests/e2e/visual.spec.ts-snapshots docs/verification/image-integration-acceptance.md
git commit -m "test: accept integrated blog imagery"
```

- [ ] **Step 5: Ensure the local development server is available**

Reuse the existing `127.0.0.1:4321` process when healthy; otherwise start `pnpm dev --host 127.0.0.1 --port 4321` in a hidden process. Verify `http://127.0.0.1:4321/`, `/archives`, and all four post routes return HTTP 200.
