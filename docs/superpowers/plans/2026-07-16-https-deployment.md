# Blog HTTPS/CD Application Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a canonical `gsk.minyako.top` static-site image, publish immutable SHA tags from `main`, and invoke a restricted, health-checked deployment with automatic rollback.

**Architecture:** The blog repository builds Astro in a pinned Node stage and serves only `dist` from an unprivileged internal Caddy on port 8080. GitHub Actions keeps PRs verification-only, publishes public GHCR images from `main`, and sends only `deploy $sha` with a validated full SHA over restricted SSH. Application-owned Compose and release logic live in this repository; host accounts and shared gateway configuration are implemented by the companion server-infra plan at `D:\seRver\docs\superpowers\plans\2026-07-16-blog-deployment-infrastructure.md`.

**Tech Stack:** Astro 7, TypeScript 6, Vitest 4, Playwright 1.61.1, Node.js 24.18.0, pnpm 11.7.0, Caddy 2.10.2 Alpine, Docker/Compose, GitHub Actions, GHCR, POSIX shell.

## Global Constraints

- Production canonical origin is exactly `https://gsk.minyako.top`.
- `minyakogsk.icu` redirection is gateway-owned and is not implemented inside Astro or the app container.
- Production images are exactly `ghcr.io/minyaako/blog:$sha`, where `$sha` is 40 lowercase hexadecimal characters; do not publish or deploy `latest`.
- Pull requests never publish images or contact the server; only `main` can publish, and only `DEPLOY_ENABLED == 'true'` can deploy.
- The runtime container runs as non-root, listens only on container port 8080, has a read-only root filesystem, and exposes no host port.
- The production server must not install Node.js or pnpm and must not receive GitHub registry credentials.
- Runtime Secrets, SSH private keys, and live `.env` values never enter Git, image layers, artifacts, or logs.
- Keep `pnpm@11.7.0`, Node 24 for CI/build, Astro static output, and the existing 36-page content surface.

---

### Task 1: Make visual regression portable across Windows and Linux

**Files:**
- Modify: `playwright.config.ts`
- Move: `tests/e2e/visual.spec.ts-snapshots/*.png` to `tests/e2e/visual.spec.ts-snapshots/win32/*.png`
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`

**Interfaces:**
- Consumes: the existing 42 Windows baselines and `tests/e2e/visual.spec.ts` names.
- Produces: platform-specific `{platform}` baseline paths and a guarded PR-only Linux baseline artifact mode controlled by repository variable `REFRESH_VISUAL_BASELINES`.

- [ ] **Step 1: Record the current failing remote evidence**

Run:

```powershell
gh run view 29404639123 --repo Minyaako/blog --log-failed
```

Expected: 32 visual cases report image dimension/pixel differences while 61 checks pass. Preserve the run URL in the eventual verification note; do not update baselines without inspecting the artifact.

- [ ] **Step 2: Separate snapshots by operating system**

Change `snapshotPathTemplate` to:

```ts
snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{platform}/{arg}-{projectName}{ext}',
```

Move all current PNGs into the `win32` subdirectory without changing their filenames. Run:

```powershell
pnpm test:visual
```

Expected: 42/42 visual tests pass on Windows using `win32` baselines.

- [ ] **Step 3: Add a guarded Linux-baseline artifact path to CI**

In the existing `verify` job, replace the unconditional E2E step with these steps:

```yaml
      - name: Run browser checks
        if: ${{ !(github.event_name == 'pull_request' && vars.REFRESH_VISUAL_BASELINES == 'true') }}
        run: pnpm test:e2e
      - name: Generate Linux visual baselines
        if: ${{ github.event_name == 'pull_request' && vars.REFRESH_VISUAL_BASELINES == 'true' }}
        run: pnpm exec playwright test tests/e2e/visual.spec.ts --update-snapshots
      - name: Upload Linux visual baselines
        if: ${{ github.event_name == 'pull_request' && vars.REFRESH_VISUAL_BASELINES == 'true' }}
        uses: actions/upload-artifact@v4
        with:
          name: linux-visual-baselines
          path: tests/e2e/visual.spec.ts-snapshots/linux/
```

Keep the existing failure artifact step. The refresh path must be impossible on `push` and `workflow_dispatch`, so a production verification cannot silently replace comparison with generation.

- [ ] **Step 4: Generate and inspect Linux baselines**

Temporarily set the repository variable, push the branch, and download the artifact:

```powershell
gh variable set REFRESH_VISUAL_BASELINES --repo Minyaako/blog --body true
git push origin codex/static-blog-core
$runId = gh run list --repo Minyaako/blog --branch codex/static-blog-core --limit 1 --json databaseId --jq '.[0].databaseId'
gh run download $runId --repo Minyaako/blog --name linux-visual-baselines --dir .tmp/linux-baselines
```

Copy the artifact contents to `tests/e2e/visual.spec.ts-snapshots/linux/`, inspect all 42 images, then disable refresh:

```powershell
gh variable set REFRESH_VISUAL_BASELINES --repo Minyaako/blog --body false
```

Expected: 42 Linux PNGs with the same route/theme/project matrix as `win32`; no page is blank, clipped, unthemed, or exposing protected content.

- [ ] **Step 5: Document the two-platform baseline rule**

Add to the README visual-baseline section:

```markdown
视觉基线按 `win32` 和 `linux` 分目录保存。Windows 本地检查使用 `win32`；GitHub Actions 使用 `linux`。只有在人工检查全部 42 张结果后，才可通过 PR 专用变量 `REFRESH_VISUAL_BASELINES=true` 生成 Linux artifact；下载并提交后立即恢复为 `false`，再让普通 PR 检查执行像素比较。
```

- [ ] **Step 6: Commit and restore the normal CI gate**

Run:

```powershell
git add playwright.config.ts .github/workflows/ci.yml README.md tests/e2e/visual.spec.ts-snapshots
git commit -m "test: stabilize visual baselines across runners"
git push origin codex/static-blog-core
gh pr checks 1 --repo Minyaako/blog --watch
```

Expected: `REFRESH_VISUAL_BASELINES=false`, the normal PR job compares Linux baselines, and all 93 Playwright checks pass.

### Task 2: Change the canonical production origin

**Files:**
- Modify: `tests/unit/foundation.test.ts`
- Modify: `src/config/site.ts`
- Modify: `astro.config.mjs`
- Modify: `README.md`

**Interfaces:**
- Consumes: `SITE.origin` used by layouts, RSS, Open Graph, and canonical URLs.
- Produces: a single canonical origin `https://gsk.minyako.top` for Astro, RSS, and Sitemap.

- [ ] **Step 1: Write the failing origin test**

Change the assertion to:

```ts
expect(SITE.origin).toBe('https://gsk.minyako.top')
```

Run:

```powershell
pnpm test:unit -- tests/unit/foundation.test.ts
```

Expected: FAIL because `SITE.origin` is still `https://minyakogsk.icu`.

- [ ] **Step 2: Update both origin sources**

Set:

```ts
// src/config/site.ts
origin: 'https://gsk.minyako.top',
```

and:

```js
// astro.config.mjs
site: 'https://gsk.minyako.top',
```

Update the README opening sentence to name `gsk.minyako.top` and explain that `minyakogsk.icu` is the legacy redirect domain.

- [ ] **Step 3: Verify generated public metadata**

Run:

```powershell
pnpm build
rg -n "https://minyakogsk\.icu" dist src astro.config.mjs README.md
rg -n "https://gsk\.minyako\.top" dist/rss.xml dist/sitemap-0.xml dist/index.html
```

Expected: build passes; no old origin appears in production source or output; the new origin appears in canonical, RSS, and Sitemap output. Historical design/plan documents are excluded from the old-domain scan.

- [ ] **Step 4: Commit**

```powershell
git add tests/unit/foundation.test.ts src/config/site.ts astro.config.mjs README.md
git commit -m "feat: adopt canonical blog origin"
```

### Task 3: Build the unprivileged static runtime image

**Files:**
- Create: `.dockerignore`
- Create: `Dockerfile`
- Create: `deploy/site.Caddyfile`
- Create: `deploy/compose.yml`
- Create: `tests/unit/deployment-config.test.ts`

**Interfaces:**
- Consumes: `pnpm-lock.yaml`, Astro `dist`, and environment variable `BLOG_IMAGE`.
- Produces: a container with `/healthz`, internal port 8080, Docker health status, and Compose service/network alias `blog` on external network `server_proxy`.

- [ ] **Step 1: Write failing deployment invariant tests**

Create `tests/unit/deployment-config.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8')

describe('production container contract', () => {
  it('builds the site with locked pnpm and serves as non-root', () => {
    const dockerfile = read('Dockerfile')
    expect(dockerfile).toContain('FROM node:24.18.0-alpine AS build')
    expect(dockerfile).toContain('corepack prepare pnpm@11.7.0 --activate')
    expect(dockerfile).toContain('RUN pnpm build')
    expect(dockerfile).toContain('FROM caddy:2.10.2-alpine')
    expect(dockerfile).toContain('addgroup -S -g 1000 caddy')
    expect(dockerfile).toContain('adduser -S -D -H -u 1000 -G caddy caddy')
    expect(dockerfile).toContain('USER caddy')
    expect(dockerfile).toContain('HEALTHCHECK')
  })

  it('has no host port and joins only the external proxy network', () => {
    const compose = read('deploy/compose.yml')
    expect(compose).toContain('image: ${BLOG_IMAGE:?BLOG_IMAGE is required}')
    expect(compose).not.toMatch(/^\s+ports:/m)
    expect(compose).toContain('read_only: true')
    expect(compose).toContain('no-new-privileges:true')
    expect(compose).toContain('external: true')
    expect(compose).toContain('server_proxy')
  })

  it('serves health without enabling internal TLS', () => {
    const caddy = read('deploy/site.Caddyfile')
    expect(caddy).toContain('auto_https off')
    expect(caddy).toContain(':8080')
    expect(caddy).toContain('respond /healthz "ok" 200')
  })
})
```

Run `pnpm test:unit -- tests/unit/deployment-config.test.ts` and expect ENOENT for `Dockerfile`.

- [ ] **Step 2: Add the build/runtime files**

Create `.dockerignore`:

```text
.git
.github
.worktrees
.astro
dist
node_modules
playwright-report
test-results
docs
tests/e2e
```

Create `deploy/site.Caddyfile`:

```caddyfile
{
    admin off
    auto_https off
    persist_config off
}

:8080 {
    root * /srv
    encode zstd gzip

    respond /healthz "ok" 200

    @immutable path /_astro/* /pagefind/*
    header @immutable Cache-Control "public, max-age=31536000, immutable"
    header {
        X-Content-Type-Options nosniff
        Referrer-Policy strict-origin-when-cross-origin
    }

    file_server
    handle_errors {
        rewrite * /404.html
        file_server
    }
}
```

Create `Dockerfile`:

```dockerfile
FROM node:24.18.0-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM caddy:2.10.2-alpine
RUN addgroup -S -g 1000 caddy \
  && adduser -S -D -H -u 1000 -G caddy caddy
COPY --from=build --chown=caddy:caddy /app/dist /srv
COPY --chown=caddy:caddy deploy/site.Caddyfile /etc/caddy/Caddyfile
USER caddy
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=6 \
  CMD wget -q --spider http://127.0.0.1:8080/healthz || exit 1
```

Create `deploy/compose.yml`:

```yaml
services:
  blog:
    image: ${BLOG_IMAGE:?BLOG_IMAGE is required}
    restart: unless-stopped
    read_only: true
    cap_drop: [ALL]
    security_opt:
      - no-new-privileges:true
    tmpfs:
      - /config:size=1m,mode=0700,uid=1000,gid=1000
      - /data:size=1m,mode=0700,uid=1000,gid=1000
    healthcheck:
      test: [CMD, wget, -q, --spider, http://127.0.0.1:8080/healthz]
      interval: 10s
      timeout: 3s
      retries: 6
      start_period: 5s
    networks:
      server_proxy:
        aliases: [blog]

networks:
  server_proxy:
    external: true
```

- [ ] **Step 3: Verify the contract and image on a Docker host**

Run locally:

```powershell
pnpm test:unit -- tests/unit/deployment-config.test.ts
```

Expected: 3/3 pass.

On the remote Docker host, build a temporary image from a copied clean tree or verify the exact image produced by Actions:

```bash
docker build -t minyako-blog:verify .
docker run -d --rm --name minyako-blog-verify --read-only --tmpfs /data --tmpfs /config -p 127.0.0.1:18080:8080 minyako-blog:verify
curl --fail --silent http://127.0.0.1:18080/healthz
docker inspect --format '{{.Config.User}} {{.State.Health.Status}}' minyako-blog-verify
docker rm -f minyako-blog-verify
```

Expected: body `ok`, user `caddy`, health `healthy`, and the temporary bind is loopback-only. Remove the temporary image after verification.

- [ ] **Step 4: Commit**

```powershell
git add .dockerignore Dockerfile deploy/site.Caddyfile deploy/compose.yml tests/unit/deployment-config.test.ts
git commit -m "feat: add immutable static site image"
```

### Task 4: Add tested release and rollback logic

**Files:**
- Create: `deploy/bin/blog-release`
- Create: `tests/deploy/blog-release.test.sh`
- Modify: `package.json`

**Interfaces:**
- Consumes: command `deploy $sha` or `status`, `/srv/apps/blog/compose.yml`, Docker, curl, and public GHCR.
- Produces: atomic `state/current`, `state/previous`, candidate health validation, stable Compose replacement, public HTTPS checks, and automatic restoration of the previous SHA.

- [ ] **Step 1: Write a shell test harness before the release program**

Create `tests/deploy/blog-release.test.sh`:

```sh
#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin" "$TMP/app/state"
touch "$TMP/app/compose.yml"

export DOCKER_LOG="$TMP/docker.log"
export ACTIVE_IMAGE="$TMP/active-image"
export BLOG_APP_DIR="$TMP/app"
export BLOG_STATE_DIR="$TMP/app/state"
export BLOG_COMPOSE_FILE="$TMP/app/compose.yml"
export DOCKER_BIN="$TMP/bin/docker"
export CURL_BIN="$TMP/bin/curl"

cat > "$DOCKER_BIN" <<'SH'
#!/bin/sh
set -eu
printf 'BLOG_IMAGE=%s %s\n' "${BLOG_IMAGE:-}" "$*" >> "$DOCKER_LOG"
case ${1:-} in
  inspect) echo healthy ;;
  compose)
    case " $* " in
      *' up '*) printf '%s\n' "$BLOG_IMAGE" > "$ACTIVE_IMAGE" ;;
    esac
    ;;
esac
SH

cat > "$CURL_BIN" <<'SH'
#!/bin/sh
set -eu
url=
for arg in "$@"; do url=$arg; done
active=$(cat "$ACTIVE_IMAGE" 2>/dev/null || true)
if test -n "${FAIL_IMAGE:-}" && printf '%s\n' "$active" | grep -q "$FAIL_IMAGE"; then
  exit 22
fi
case "$url" in
  */healthz) echo ok ;;
  */rss.xml|*/sitemap-index.xml) echo 'https://gsk.minyako.top' ;;
  */) echo '<html lang="zh-CN">' ;;
  *) : ;;
esac
SH

chmod +x "$DOCKER_BIN" "$CURL_BIN" "$ROOT/deploy/bin/blog-release"
one=1111111111111111111111111111111111111111
two=2222222222222222222222222222222222222222
three=3333333333333333333333333333333333333333

"$ROOT/deploy/bin/blog-release" deploy "$one"
test "$(cat "$BLOG_STATE_DIR/current")" = "$one"
"$ROOT/deploy/bin/blog-release" status | grep -q "current=$one"

if "$ROOT/deploy/bin/blog-release" deploy short-sha; then
  echo 'short SHA was accepted' >&2
  exit 1
fi

export FAIL_IMAGE=222222222222
if "$ROOT/deploy/bin/blog-release" deploy "$two"; then
  echo 'failed public check was accepted' >&2
  exit 1
fi
unset FAIL_IMAGE
test "$(cat "$BLOG_STATE_DIR/current")" = "$one"
grep -q "BLOG_IMAGE=ghcr.io/minyaako/blog:$one compose" "$DOCKER_LOG"

mkdir "$BLOG_STATE_DIR/deploy.lock"
if "$ROOT/deploy/bin/blog-release" deploy "$three"; then
  echo 'concurrent deployment was accepted' >&2
  exit 1
fi
rmdir "$BLOG_STATE_DIR/deploy.lock"
```

Run `bash tests/deploy/blog-release.test.sh` and expect failure because `deploy/bin/blog-release` does not exist.

- [ ] **Step 2: Implement the release state machine**

Create `deploy/bin/blog-release` with the complete state machine:

```sh
#!/bin/sh
set -eu

APP_DIR=${BLOG_APP_DIR:-/srv/apps/blog}
STATE_DIR=${BLOG_STATE_DIR:-$APP_DIR/state}
COMPOSE_FILE=${BLOG_COMPOSE_FILE:-$APP_DIR/compose.yml}
DOCKER=${DOCKER_BIN:-docker}
CURL=${CURL_BIN:-curl}
IMAGE_REPO=ghcr.io/minyaako/blog
ORIGIN=https://gsk.minyako.top
LOCK_DIR=$STATE_DIR/deploy.lock
CANDIDATE=

die() { echo "blog-release: $*" >&2; exit 1; }
valid_sha() { printf '%s\n' "$1" | grep -Eq '^[0-9a-f]{40}$'; }
atomic_write() {
  file=$1
  value=$2
  printf '%s\n' "$value" > "$file.tmp"
  mv "$file.tmp" "$file"
}
read_state() { test -f "$1" && cat "$1" || printf '%s\n' none; }
compose_up() {
  BLOG_IMAGE="$IMAGE_REPO:$1" "$DOCKER" compose -f "$COMPOSE_FILE" up -d --wait --remove-orphans
}
compose_down() {
  BLOG_IMAGE="$IMAGE_REPO:$1" "$DOCKER" compose -f "$COMPOSE_FILE" down
}
public_health() {
  test "$("$CURL" --fail --silent --show-error --retry 15 --retry-delay 2 "$ORIGIN/healthz")" = ok
  "$CURL" --fail --silent --show-error --retry 15 --retry-delay 2 "$ORIGIN/" | grep -q '<html'
  "$CURL" --fail --silent --show-error "$ORIGIN/about" >/dev/null
  "$CURL" --fail --silent --show-error "$ORIGIN/archives" >/dev/null
  "$CURL" --fail --silent --show-error "$ORIGIN/rss.xml" | grep -q "$ORIGIN"
  "$CURL" --fail --silent --show-error "$ORIGIN/sitemap-index.xml" | grep -q "$ORIGIN"
}
cleanup() {
  test -z "$CANDIDATE" || "$DOCKER" rm -f "$CANDIDATE" >/dev/null 2>&1 || true
  rmdir "$LOCK_DIR" >/dev/null 2>&1 || true
}

mkdir -p "$STATE_DIR"
case ${1:-} in
  status)
    test "$#" -eq 1 || die 'status accepts no arguments'
    printf 'current=%s\n' "$(read_state "$STATE_DIR/current")"
    printf 'previous=%s\n' "$(read_state "$STATE_DIR/previous")"
    exit 0
    ;;
  deploy)
    test "$#" -eq 2 || die 'deploy requires one full SHA'
    ;;
  *)
    die 'usage: blog-release status | deploy FULL_SHA'
    ;;
esac

sha=$2
valid_sha "$sha" || die 'SHA must be 40 lowercase hexadecimal characters'
mkdir "$LOCK_DIR" 2>/dev/null || die 'another deployment is active'
trap cleanup EXIT INT TERM

image="$IMAGE_REPO:$sha"
"$DOCKER" pull "$image"
short=$(printf '%.12s' "$sha")
CANDIDATE="blog-candidate-$short"
"$DOCKER" rm -f "$CANDIDATE" >/dev/null 2>&1 || true
"$DOCKER" run -d --name "$CANDIDATE" \
  --read-only --tmpfs /data --tmpfs /config \
  --cap-drop ALL --security-opt no-new-privileges \
  --network server_proxy "$image" >/dev/null

healthy=false
attempt=0
while test "$attempt" -lt 30; do
  status=$("$DOCKER" inspect --format '{{.State.Health.Status}}' "$CANDIDATE" 2>/dev/null || true)
  test "$status" = healthy && { healthy=true; break; }
  test "$status" = unhealthy && break
  attempt=$((attempt + 1))
  sleep 2
done
test "$healthy" = true || die 'candidate did not become healthy'

old=$(read_state "$STATE_DIR/current")
if compose_up "$sha" && public_health; then
  test "$old" = none || atomic_write "$STATE_DIR/previous" "$old"
  atomic_write "$STATE_DIR/current" "$sha"
  rm -f "$STATE_DIR/last-failure"
  echo "deployed=$sha"
  exit 0
fi

atomic_write "$STATE_DIR/last-failure" "$sha $(date -u +%Y-%m-%dT%H:%M:%SZ)"
if test "$old" != none && valid_sha "$old"; then
  compose_up "$old" || die 'rollback compose replacement failed'
  public_health || die 'rollback public health failed'
  atomic_write "$STATE_DIR/current" "$old"
  die "deployment failed; restored $old"
fi

compose_down "$sha" >/dev/null 2>&1 || true
die 'first deployment failed; no current release recorded'
```

Make the file executable. The test harness may set `DOCKER_BIN`, `CURL_BIN`, `BLOG_APP_DIR`, and `BLOG_STATE_DIR`; production uses the defaults.

- [ ] **Step 3: Add the deployment test command and run shell checks**

Add:

```json
"test:deploy": "bash tests/deploy/blog-release.test.sh"
```

Run on Linux:

```bash
bash -n deploy/bin/blog-release tests/deploy/blog-release.test.sh
shellcheck deploy/bin/blog-release tests/deploy/blog-release.test.sh
pnpm test:deploy
```

Expected: syntax and ShellCheck pass; initial deploy, invalid SHA, status, failed-target rollback, and lock contention tests all pass.

- [ ] **Step 4: Commit**

```powershell
git add deploy/bin/blog-release tests/deploy/blog-release.test.sh package.json
git commit -m "feat: add health-checked blog release command"
```

### Task 5: Extend GitHub Actions from verification to gated publication and deployment

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `tests/unit/deployment-config.test.ts`

**Interfaces:**
- Consumes: `GITHUB_TOKEN`, repository variables `DEPLOY_ENABLED`, `DEPLOY_HOST`, `DEPLOY_USER`, and production secrets `DEPLOY_SSH_PRIVATE_KEY`, `DEPLOY_SSH_KNOWN_HOSTS`.
- Produces: `verify -> publish-image -> deploy-production` with SHA-only images and a restricted native SSH command.

- [ ] **Step 1: Extend invariant tests before the workflow**

Add assertions that `.github/workflows/ci.yml` contains:

```ts
const workflow = read('.github/workflows/ci.yml')
expect(workflow).toContain('permissions:')
expect(workflow).toContain('packages: write')
expect(workflow).toContain('ghcr.io/minyaako/blog:${{ github.sha }}')
expect(workflow).toContain("vars.DEPLOY_ENABLED == 'true'")
expect(workflow).toContain("github.ref == 'refs/heads/main'")
expect(workflow).toContain('deploy ${{ github.sha }}')
expect(workflow).not.toContain(':latest')
```

Run the deployment-config test and expect failure.

- [ ] **Step 2: Add least-privilege triggers and jobs**

Keep `pull_request` and `push: branches: [main]`, add `workflow_dispatch`, and set root permissions:

```yaml
permissions:
  contents: read
```

Keep `verify` as the only PR job. Add `publish-image`:

```yaml
  publish-image:
    if: ${{ github.ref == 'refs/heads/main' && github.event_name != 'pull_request' }}
    needs: verify
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ghcr.io/minyaako/blog:${{ github.sha }}
```

Add `deploy-production`:

```yaml
  deploy-production:
    if: ${{ github.ref == 'refs/heads/main' && github.event_name != 'pull_request' && vars.DEPLOY_ENABLED == 'true' }}
    needs: publish-image
    runs-on: ubuntu-latest
    environment: production
    concurrency:
      group: blog-production
      cancel-in-progress: false
    steps:
      - name: Configure restricted SSH
        env:
          SSH_KEY: ${{ secrets.DEPLOY_SSH_PRIVATE_KEY }}
          KNOWN_HOSTS: ${{ secrets.DEPLOY_SSH_KNOWN_HOSTS }}
        run: |
          install -m 700 -d "$HOME/.ssh"
          printf '%s\n' "$SSH_KEY" > "$HOME/.ssh/id_ed25519"
          chmod 600 "$HOME/.ssh/id_ed25519"
          printf '%s\n' "$KNOWN_HOSTS" > "$HOME/.ssh/known_hosts"
          chmod 600 "$HOME/.ssh/known_hosts"
      - name: Deploy immutable image
        run: >-
          ssh -o BatchMode=yes
          "${{ vars.DEPLOY_USER }}@${{ vars.DEPLOY_HOST }}"
          "deploy ${{ github.sha }}"
```

- [ ] **Step 3: Validate workflow policy**

Run:

```powershell
pnpm test:unit -- tests/unit/deployment-config.test.ts
rg -n "latest|pull_request|packages: write|DEPLOY_ENABLED|deploy \$\{\{ github.sha \}\}" .github/workflows/ci.yml
```

Expected: invariant tests pass; `latest` is absent; publication and deployment are both main-only; deployment is additionally gated.

- [ ] **Step 4: Commit**

```powershell
git add .github/workflows/ci.yml tests/unit/deployment-config.test.ts
git commit -m "ci: publish and deploy immutable blog images"
```

### Task 6: Write the application deployment runbook

**Files:**
- Create: `docs/deployment.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: Compose/release interfaces from Tasks 3-5 and the server-infra bootstrap plan.
- Produces: exact operator steps for status, logs, first release, rollback verification, and key rotation.

- [ ] **Step 1: Write the runbook with fixed commands**

Document:

```markdown
# Production Deployment

- Canonical origin: `https://gsk.minyako.top`
- Legacy redirect: `https://minyakogsk.icu`
- Image: `ghcr.io/minyaako/blog:$sha`, where `$sha` is the deployed full commit SHA
- Runtime: `/srv/apps/blog`
- Status: `ssh blog-deploy@124.223.13.233 status`
- Container logs: `sudo docker compose -f /srv/apps/blog/compose.yml logs --tail 200 blog`
- Gateway logs: `sudo docker logs --tail 200 server-caddy`

The first merge keeps `DEPLOY_ENABLED=false`. After the SHA image exists, make the GHCR package Public, verify `docker pull` without credentials, complete server-infra bootstrap, set the production SSH secrets and repository variables, set `DEPLOY_ENABLED=true`, and manually dispatch `main`. Never paste the private key or secret values into issues, logs, or this file.
```

Include exact `curl` checks for `/`, `/about`, `/archives`, `/rss.xml`, `/sitemap-index.xml`, `/healthz`, and the legacy 308 Location. Explain that `status` is allowed over the restricted key, while manual rollback is performed by dispatching a known-good main SHA through an administrator-approved path; do not document a generic shell login for the Actions key.

- [ ] **Step 2: Link the runbook from README**

Add a short “生产部署” section linking `docs/deployment.md` and clearly state that the app repository does not own the shared Caddy base.

- [ ] **Step 3: Commit**

```powershell
git add docs/deployment.md README.md
git commit -m "docs: add blog deployment runbook"
```

### Task 7: Run the application release gate and hand off to infrastructure

**Files:**
- Create after verification: `docs/verification/https-cd-application-acceptance.md`

**Interfaces:**
- Consumes: every previous task.
- Produces: a green application PR containing the image and remote-command contract required by the server-infra plan.

- [ ] **Step 1: Run clean local checks**

Ensure no Astro dev server is occupying port 4321, because Playwright otherwise reuses it and misses Pagefind production output. Run:

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm test:e2e
git diff --check
```

Expected: locked install, 12 or more unit tests including deployment invariants, 36 generated pages, 93/93 browser checks, and no whitespace errors.

- [ ] **Step 2: Verify the Linux-only deployment assets**

Run on an Ubuntu environment:

```bash
bash -n deploy/bin/blog-release tests/deploy/blog-release.test.sh
shellcheck deploy/bin/blog-release tests/deploy/blog-release.test.sh
pnpm test:deploy
docker build -t minyako-blog:acceptance .
docker run -d --name minyako-blog-acceptance --read-only --tmpfs /data --tmpfs /config -p 127.0.0.1:18080:8080 minyako-blog:acceptance
curl --fail --silent http://127.0.0.1:18080/healthz
docker inspect --format '{{.Config.User}} {{.State.Health.Status}}' minyako-blog-acceptance
docker rm -f minyako-blog-acceptance
docker image rm minyako-blog:acceptance
```

Expected: shell checks pass, health body is `ok`, user is `caddy`, and health is `healthy`.

- [ ] **Step 3: Record acceptance without claiming production deployment**

Create `docs/verification/https-cd-application-acceptance.md` with the verified commit SHA, exact command results, image user/health, PR check URL, and these explicit exclusions: no GHCR package has been made public, no deployment secret has been configured, no `/srv/apps/blog` service has been started, and no Caddy domain route has changed.

- [ ] **Step 4: Commit, push, and require green PR checks**

```powershell
git add docs/verification/https-cd-application-acceptance.md
git commit -m "docs: record application deployment acceptance"
git push origin codex/static-blog-core
gh pr checks 1 --repo Minyaako/blog --watch
```

Expected: the draft PR is mergeable and all required checks pass. Do not merge until the server-infra bootstrap assets have been reviewed and `DEPLOY_ENABLED=false` is confirmed.
