import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import playwrightConfig from '../../playwright.config'

const read = (path: string) => readFileSync(path, 'utf8').replaceAll('\r\n', '\n')

describe('production Node runtime contract', () => {
  it('uses a pinned non-root standalone runtime and checks the schema before startup', () => {
    const dockerfile = read('Dockerfile')
    expect(dockerfile.match(/^FROM .+$/gm)).toEqual([
      'FROM node:24.18.0-alpine AS build', 'FROM node:24.18.0-alpine',
    ])
    expect(dockerfile).toContain('corepack prepare pnpm@11.7.0 --activate')
    expect(dockerfile).toMatch(/RUN --mount=type=secret,id=youtube_data_api_key[\s\S]*?fi; pnpm build/)
    expect(dockerfile).toContain('export YOUTUBE_DATA_API_KEY="$(cat /run/secrets/youtube_data_api_key)"')
    expect(dockerfile).not.toMatch(/^(?:ARG|ENV)\s+YOUTUBE_DATA_API_KEY/m)
    expect(dockerfile).toContain('RUN pnpm prune --prod')
    expect(dockerfile).toMatch(/^USER node$/m)
    expect(dockerfile).toMatch(/^EXPOSE 8080$/m)
    expect(dockerfile).toContain('RANKING_WRITE_ENABLED=false')
    expect(dockerfile).toContain('scripts/ranking-db.ts check && exec node scripts/blog-server.mjs')
    expect(dockerfile).not.toMatch(/ranking-db\.ts (init|migrate)/)
    const runtime = dockerfile.slice(dockerfile.lastIndexOf('FROM '))
    expect(runtime.match(/^COPY .+$/gm)?.every((line) => line.includes('--chown=node:node'))).toBe(true)
    expect(dockerfile).toContain('CMD wget -q --spider http://127.0.0.1:8080/healthz || exit 1')
  })

  it('requires prepared storage and restricted runtime configuration without public ports', () => {
    const compose = parse(read('deploy/compose.yml'))
    expect(Object.keys(compose.services)).toEqual(['blog'])
    const blog = compose.services.blog
    expect(blog.image).toBe('${BLOG_IMAGE:?BLOG_IMAGE is required}')
    expect(blog.ports).toBeUndefined()
    expect(blog.read_only).toBe(true)
    expect(blog.cap_drop).toEqual(['ALL'])
    expect(blog.security_opt).toEqual(['no-new-privileges:true'])
    expect(blog.env_file).toEqual(['${RANKING_ENV_FILE:?RANKING_ENV_FILE is required}'])
    expect(blog.environment.RANKING_DATABASE).toBe('/var/lib/blog-ranking/ranking.sqlite')
    expect(blog.volumes).toEqual([{
      type: 'bind', source: '${RANKING_DATA_DIR:?RANKING_DATA_DIR is required}',
      target: '/var/lib/blog-ranking', bind: { create_host_path: false },
    }])
    expect(blog.tmpfs).toEqual(['/tmp:size=16m,mode=0700,uid=1000,gid=1000'])
    expect(blog.healthcheck.test).toEqual(['CMD', 'wget', '-q', '--spider', 'http://127.0.0.1:8080/healthz'])
    expect(blog.networks).toEqual({ server_proxy: { aliases: ['blog'] } })
    expect(compose.networks).toEqual({ server_proxy: { external: true } })
  })

  it('excludes secrets, databases, private plans and fixture tokens from the build context', () => {
    const rules = read('.dockerignore').split('\n').map((rule) => rule.trim())
    for (const rule of ['.env*', '.superpowers', '.ranking-data', '*.sqlite', '*.sqlite-wal', '*.sqlite-shm']) {
      expect(rules).toContain(rule)
    }
    expect(rules.filter((rule) => rule.startsWith('!'))).toEqual([
      '!.github/workflows', '!.github/workflows/ci.yml',
      '!.github/workflows/pages-preview.yml', '!.github/workflows/sync-editor-preview.yml',
    ])
  })

  it('indexes only the generated client pages', () => {
    expect(JSON.parse(read('package.json')).scripts['build:search']).toBe('pagefind --site dist/client')
  })
})

describe('release trust boundaries', () => {
  it('requires verification and media publication before image deployment', () => {
    const { jobs } = parse(read('.github/workflows/ci.yml'))
    expect(Object.keys(jobs)).toEqual(['verify', 'publish-media', 'publish-image', 'deploy-production'])
    expect(jobs.verify.if).toBeUndefined()
    expect(jobs.verify.needs).toBeUndefined()
    expect(jobs['publish-media'].needs).toBe('verify')
    expect(jobs['publish-image'].needs).toEqual(['verify', 'publish-media'])
    expect(jobs['deploy-production'].needs).toBe('publish-image')
    expect(jobs['publish-media'].environment).toBe('production')
    expect(jobs['deploy-production'].environment).toBe('production')
    expect(jobs['deploy-production'].concurrency).toEqual({
      group: 'blog-production', 'cancel-in-progress': false,
    })
    expect(jobs.verify.steps.some((step: { run?: string }) => step.run === 'pnpm test:deploy')).toBe(true)
    expect(jobs.verify.steps.some((step: { run?: string }) => step.run === 'pnpm build')).toBe(true)
  })

  it('builds an immutable image only on the first push attempt and inspects it on reruns', () => {
    const { jobs } = parse(read('.github/workflows/ci.yml'))
    const image = jobs['publish-image']
    const findAction = (uses: string) => image.steps.find((step: { uses?: string }) => step.uses === uses)
    const firstPush = "${{ github.event_name == 'push' && github.run_attempt == 1 }}"
    expect(findAction('actions/checkout@v4')).toBeDefined()
    expect(findAction('docker/setup-buildx-action@v3')).toBeDefined()
    expect(findAction('docker/login-action@v3')).toEqual({
      uses: 'docker/login-action@v3', if: firstPush,
      with: {
        registry: 'ccr.ccs.tencentyun.com',
        username: '${{ secrets.TCR_USERNAME }}', password: '${{ secrets.TCR_PASSWORD }}',
      },
    })
    expect(findAction('docker/build-push-action@v6')).toEqual({
      uses: 'docker/build-push-action@v6', if: firstPush,
      with: { context: '.', push: true, tags: 'ccr.ccs.tencentyun.com/minyako-blog/blog:${{ github.sha }}',
        secrets: 'youtube_data_api_key=${{ secrets.YOUTUBE_DATA_API_KEY }}\n' },
    })
    expect(image.steps.find((step: { name?: string }) => step.name === 'Verify immutable image exists')).toEqual({
      name: 'Verify immutable image exists',
      if: "${{ github.event_name == 'workflow_dispatch' || github.run_attempt != 1 }}",
      run: 'docker buildx imagetools inspect ccr.ccs.tencentyun.com/minyako-blog/blog:${{ github.sha }}',
    })
    expect(image.steps).toHaveLength(5)
    const deployStep = jobs['deploy-production'].steps.find((step: { name?: string }) => step.name === 'Deploy immutable image')
    expect(deployStep.run).toContain('"deploy ${{ github.sha }}"')
    expect(deployStep.run).toContain('ssh -o BatchMode=yes')
  })

  it('keeps production writes and secrets out of pull-request verification', () => {
    const source = read('.github/workflows/ci.yml')
    const workflow = parse(source)
    expect(Object.keys(workflow.on).sort()).toEqual(['pull_request', 'push', 'workflow_dispatch'])
    expect(workflow.on.push).toEqual({ branches: ['main'] })
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(JSON.stringify(workflow.jobs.verify)).not.toMatch(/DEPLOY_|secrets\.|id-token|MEDIA_TENCENT_|MEDIA_COS_/)
    for (const name of ['publish-media', 'publish-image', 'deploy-production']) {
      expect(workflow.jobs[name].if).toContain("github.ref == 'refs/heads/main'")
      expect(workflow.jobs[name].if).toContain("github.event_name != 'pull_request'")
    }
    expect(workflow.jobs['deploy-production'].if).toContain("vars.DEPLOY_ENABLED == 'true'")
    expect(workflow.jobs['deploy-production'].concurrency['cancel-in-progress']).toBe(false)
    expect(workflow.jobs['publish-media'].permissions).toEqual({ contents: 'read', 'id-token': 'write' })
    expect(workflow.jobs['publish-image'].permissions).toEqual({ contents: 'read' })
    expect(source).not.toContain(':latest')
    expect(source).not.toMatch(/packages:\s*write/)
    expect(source).toContain('ccr.ccs.tencentyun.com/minyako-blog/blog:${{ github.sha }}')
  })

  it('checks production compatibility but initializes only the isolated candidate', () => {
    const release = read('deploy/bin/blog-release')
    expect(release).toContain('scripts/ranking-db.ts check')
    expect(release).not.toContain('scripts/ranking-db.ts migrate')
    expect(release).toContain('--tmpfs /var/lib/blog-ranking:uid=1000,gid=1000,mode=0700,size=16m')
    expect(release).toContain('"$ORIGIN/api/ranking/ready/"')
    expect(release).not.toMatch(/(?:rm|unlink).*ranking\.sqlite/)
    const candidate = release.slice(release.indexOf('"$DOCKER" run -d'), release.indexOf('healthy=false'))
    expect(candidate).not.toMatch(/--(?:publish|mount|volume|env-file)\b/)
    expect(candidate).toContain('--env RANKING_WRITE_ENABLED=false')
    expect(candidate).toContain('scripts/ranking-db.ts init')
  })
})

it('allows enough time for the Playwright cold build', () => {
  const configured = playwrightConfig.webServer
  const servers = Array.isArray(configured) ? configured : configured ? [configured] : []
  const blog = servers.find(server => server.command.includes('pnpm build'))
  expect(blog?.timeout).toBe(120_000)
  expect(blog?.env?.RANKING_WALINE_URL).toMatch(/^http:\/\/127\.0\.0\.1:/)
  expect(servers.some(server => server.command.includes('tests/fixtures/waline-server.mjs'))).toBe(true)
})
