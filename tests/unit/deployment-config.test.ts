import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

type ComposeService = {
  image?: string
  ports?: unknown
  volumes?: unknown
  read_only?: boolean
  cap_drop?: string[]
  security_opt?: string[]
  tmpfs?: string[]
  healthcheck?: {
    test?: string[]
    interval?: string
    timeout?: string
    retries?: number
    start_period?: string
  }
  networks?: Record<string, { aliases?: string[] }>
}

type ComposeDocument = {
  services?: Record<string, ComposeService>
  networks?: Record<string, { external?: boolean }>
}

type WorkflowStep = {
  name?: string
  uses?: string
  if?: string
  run?: string
  env?: Record<string, string>
  with?: Record<string, unknown>
}

type WorkflowJob = {
  if?: string
  needs?: string | string[]
  'runs-on'?: string
  permissions?: Record<string, string>
  environment?: string
  concurrency?: {
    group?: string
    'cancel-in-progress'?: boolean
  }
  steps?: WorkflowStep[]
}

type WorkflowDocument = {
  on?: Record<string, unknown>
  permissions?: Record<string, string>
  jobs?: Record<string, WorkflowJob>
}

const read = (path: string) => readFileSync(path, 'utf8').replaceAll('\r\n', '\n')

const assertDockerIgnoreContract = (source: string) => {
  const rules = source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
  const githubRules = rules.filter((rule) => rule.includes('.github'))
  const negations = rules.filter((rule) => rule.startsWith('!'))

  expect(githubRules).toEqual([
    '.github/*',
    '!.github/workflows',
    '.github/workflows/*',
    '!.github/workflows/ci.yml',
  ])
  expect(negations).toEqual([
    '!.github/workflows',
    '!.github/workflows/ci.yml',
  ])
}

const stripCaddyComment = (line: string) => {
  let quoted = false

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === '\\' && quoted) {
      index += 1
    } else if (character === '"') {
      quoted = !quoted
    } else if (character === '#' && !quoted) {
      return line.slice(0, index)
    }
  }

  return line
}

const normalizeCaddyfile = (source: string) =>
  source
    .split('\n')
    .map(stripCaddyComment)
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .join('\n')

const expectedCaddyfile = normalizeCaddyfile(`
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
`)

const assertDockerContract = (dockerfile: string) => {
  expect(dockerfile.match(/^FROM .+$/gm)).toEqual([
    'FROM node:24.18.0-alpine AS build',
    'FROM caddy:2.10.2-alpine',
  ])
  expect(dockerfile).toContain('corepack prepare pnpm@11.7.0 --activate')
  expect(dockerfile).toContain('RUN pnpm build')

  const runtime = dockerfile.slice(dockerfile.indexOf('FROM caddy:2.10.2-alpine'))
  const addGroup = 'addgroup -S -g 1000 caddy'
  const addUser = 'adduser -S -D -H -u 1000 -G caddy caddy'
  const copySite = 'COPY --from=build --chown=caddy:caddy /app/dist /srv'
  const copyConfig = 'COPY --chown=caddy:caddy deploy/site.Caddyfile /etc/caddy/Caddyfile'
  const user = 'USER caddy'
  const removeFileCapabilities = 'setcap -r /usr/bin/caddy'

  expect(runtime).toContain(removeFileCapabilities)
  expect(runtime).toContain(addGroup)
  expect(runtime).toContain(addUser)
  expect(runtime.indexOf(addGroup)).toBeLessThan(runtime.indexOf(addUser))
  expect(runtime.match(/^COPY .+$/gm)).toEqual([copySite, copyConfig])
  expect(runtime.match(/^USER .+$/gm)).toEqual([user])

  for (const instruction of [addGroup, addUser]) {
    expect(runtime.indexOf(instruction)).toBeLessThan(runtime.indexOf(copySite))
    expect(runtime.indexOf(instruction)).toBeLessThan(runtime.indexOf(copyConfig))
    expect(runtime.indexOf(instruction)).toBeLessThan(runtime.indexOf(user))
  }
  expect(runtime.indexOf(copySite)).toBeLessThan(runtime.indexOf(user))
  expect(runtime.indexOf(copyConfig)).toBeLessThan(runtime.indexOf(user))
  expect(runtime.indexOf(removeFileCapabilities)).toBeLessThan(runtime.indexOf(user))

  expect(runtime).toMatch(/^EXPOSE 8080$/m)
  expect(runtime).toContain('HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=6')
  expect(runtime).toMatch(
    /^ {2}CMD wget -q --spider http:\/\/127\.0\.0\.1:8080\/healthz \|\| exit 1$/m,
  )
}

const assertComposeContract = (source: string) => {
  const compose = parse(source) as ComposeDocument
  const blog = compose.services?.blog

  expect(Object.keys(compose.services ?? {})).toEqual(['blog'])
  expect(blog?.image).toBe('${BLOG_IMAGE:?BLOG_IMAGE is required}')
  expect(blog?.ports).toBeUndefined()
  expect(blog?.volumes).toBeUndefined()
  expect(blog?.read_only).toBe(true)
  expect(blog?.cap_drop).toEqual(['ALL'])
  expect(blog?.security_opt).toEqual(['no-new-privileges:true'])
  expect(blog?.tmpfs).toHaveLength(2)
  expect(blog?.tmpfs).toEqual(
    expect.arrayContaining([
      '/config:size=1m,mode=0700,uid=1000,gid=1000',
      '/data:size=1m,mode=0700,uid=1000,gid=1000',
    ]),
  )
  expect(blog?.healthcheck).toEqual({
    test: ['CMD', 'wget', '-q', '--spider', 'http://127.0.0.1:8080/healthz'],
    interval: '10s',
    timeout: '3s',
    retries: 6,
    start_period: '5s',
  })
  expect(Object.keys(blog?.networks ?? {})).toEqual(['server_proxy'])
  expect(blog?.networks?.server_proxy?.aliases).toEqual(['blog'])
  expect(Object.keys(compose.networks ?? {})).toEqual(['server_proxy'])
  expect(compose.networks?.server_proxy?.external).toBe(true)
}

const assertCaddyContract = (caddyfile: string) => {
  const normalized = normalizeCaddyfile(caddyfile)

  expect(normalized).toBe(expectedCaddyfile)
  expect(normalized).toContain('admin off')
  expect(normalized).toContain('auto_https off')
  expect(normalized).toContain('persist_config off')
  expect(normalized).toContain(':8080 {')
  expect(normalized).toContain('root * /srv')
  expect(normalized).toContain('respond /healthz "ok" 200')
  expect(normalized).toMatch(/^file_server$/m)
  expect(normalized).toMatch(
    /handle_errors \{\s+rewrite \* \/404\.html\s+file_server\s+\}/,
  )
  expect(normalized).toContain('X-Content-Type-Options nosniff')
  expect(normalized).toContain('Referrer-Policy strict-origin-when-cross-origin')
  expect(normalized).toContain('@immutable path /_astro/* /pagefind/*')
  expect(normalized).toContain(
    'header @immutable Cache-Control "public, max-age=31536000, immutable"',
  )
}

const findStep = (job: WorkflowJob, use: string) =>
  job.steps?.find((step) => step.uses === use)

const assertWorkflowContract = (source: string) => {
  const workflow = parse(source) as WorkflowDocument
  const triggers = workflow.on ?? {}
  const jobs = workflow.jobs ?? {}
  const verify = jobs.verify ?? {}
  const publishMedia = jobs['publish-media'] ?? {}
  const publish = jobs['publish-image'] ?? {}
  const deploy = jobs['deploy-production'] ?? {}

  expect(Object.keys(triggers).sort()).toEqual([
    'pull_request',
    'push',
    'workflow_dispatch',
  ])
  expect(triggers.push).toEqual({ branches: ['main'] })
  expect(workflow.permissions).toEqual({ contents: 'read' })
  expect(Object.keys(jobs)).toEqual([
    'verify',
    'publish-media',
    'publish-image',
    'deploy-production',
  ])

  expect(verify.if).toBeUndefined()
  expect(verify.permissions).toBeUndefined()
  expect(
    verify.steps?.some(
      (step) =>
        step.run ===
        'sh -n deploy/bin/blog-release tests/deploy/blog-release.test.sh',
    ),
  ).toBe(true)
  expect(
    verify.steps?.some((step) => step.run === 'pnpm test:deploy'),
  ).toBe(true)
  expect(JSON.stringify(verify)).not.toMatch(/DEPLOY_|secrets\./)
  expect(JSON.stringify(verify)).not.toMatch(/id-token|MEDIA_TENCENT_|MEDIA_COS_/)

  expect(publishMedia.needs).toBe('verify')
  expect(publishMedia.if).toBe(
    "${{ github.ref == 'refs/heads/main' && github.event_name != 'pull_request' }}",
  )
  expect(publishMedia.environment).toBe('production')
  expect(publishMedia.permissions).toEqual({ contents: 'read', 'id-token': 'write' })
  expect(JSON.stringify(publishMedia)).not.toMatch(/secrets\./)

  expect(publish.if).toBe(
    "${{ github.ref == 'refs/heads/main' && github.event_name != 'pull_request' }}",
  )
  expect(publish.needs).toEqual(['verify', 'publish-media'])
  expect(publish.permissions).toEqual({ contents: 'read', packages: 'write' })
  expect(findStep(publish, 'actions/checkout@v4')).toBeDefined()
  expect(findStep(publish, 'docker/setup-buildx-action@v3')).toBeDefined()
  const login = findStep(publish, 'docker/login-action@v3')
  expect(login?.if).toBe(
    "${{ github.event_name == 'push' && github.run_attempt == 1 }}",
  )
  expect(login?.with).toEqual({
    registry: 'ghcr.io',
    username: '${{ github.actor }}',
    password: '${{ secrets.GITHUB_TOKEN }}',
  })
  const buildAndPush = findStep(publish, 'docker/build-push-action@v6')
  expect(buildAndPush?.if).toBe(
    "${{ github.event_name == 'push' && github.run_attempt == 1 }}",
  )
  expect(buildAndPush?.with).toEqual({
    context: '.',
    push: true,
    tags: 'ghcr.io/minyaako/blog:${{ github.sha }}',
  })
  expect(
    publish.steps?.find((step) => step.name === 'Verify immutable image exists'),
  ).toEqual({
    name: 'Verify immutable image exists',
    if: "${{ github.event_name == 'workflow_dispatch' || github.run_attempt != 1 }}",
    run: 'docker buildx imagetools inspect ghcr.io/minyaako/blog:${{ github.sha }}',
  })
  expect(JSON.stringify(publish)).not.toMatch(/DEPLOY_/)

  expect(deploy.if).toBe(
    "${{ github.ref == 'refs/heads/main' && github.event_name != 'pull_request' && vars.DEPLOY_ENABLED == 'true' }}",
  )
  expect(deploy.needs).toBe('publish-image')
  expect(deploy.environment).toBe('production')
  expect(deploy.permissions).toBeUndefined()
  expect(deploy.concurrency).toEqual({
    group: 'blog-production',
    'cancel-in-progress': false,
  })

  const configureSsh = deploy.steps?.find(
    (step) => step.name === 'Configure restricted SSH',
  )
  expect(configureSsh?.env).toEqual({
    SSH_KEY: '${{ secrets.DEPLOY_SSH_PRIVATE_KEY }}',
    KNOWN_HOSTS: '${{ secrets.DEPLOY_SSH_KNOWN_HOSTS }}',
  })
  expect(configureSsh?.run).toContain('install -m 700 -d "$HOME/.ssh"')
  expect(configureSsh?.run).toContain(
    'printf \'%s\\n\' "$SSH_KEY" > "$HOME/.ssh/id_ed25519"',
  )
  expect(configureSsh?.run).toContain('chmod 600 "$HOME/.ssh/id_ed25519"')
  expect(configureSsh?.run).toContain(
    'printf \'%s\\n\' "$KNOWN_HOSTS" > "$HOME/.ssh/known_hosts"',
  )
  expect(configureSsh?.run).toContain('chmod 600 "$HOME/.ssh/known_hosts"')

  const deployImage = deploy.steps?.find(
    (step) => step.name === 'Deploy immutable image',
  )
  expect(deployImage?.run).toContain('ssh -o BatchMode=yes')
  expect(deployImage?.run).toContain('-o ServerAliveInterval=30')
  expect(deployImage?.run).toContain('-o ServerAliveCountMax=20')
  expect(deployImage?.run).toContain(
    '"${{ vars.DEPLOY_USER }}@${{ vars.DEPLOY_HOST }}"',
  )
  expect(deployImage?.run).toContain('"deploy ${{ github.sha }}"')

  expect(source).not.toContain(':latest')
  expect(source.match(/packages:\s*write/g)).toHaveLength(1)
  expect(source.match(/vars\.DEPLOY_/g)).toHaveLength(3)
  expect(source.match(/secrets\.DEPLOY_/g)).toHaveLength(2)

  const workflowOutsideDeploy = {
    ...workflow,
    jobs: Object.fromEntries(
      Object.entries(jobs).filter(([name]) => name !== 'deploy-production'),
    ),
  }
  expect(JSON.stringify(workflowOutsideDeploy)).not.toMatch(
    /(?:vars|secrets)\.DEPLOY_/,
  )
}

describe('production container contract', () => {
  const dockerfile = read('Dockerfile')
  const compose = read('deploy/compose.yml')
  const caddyfile = read('deploy/site.Caddyfile')

  it('accepts the production Dockerfile', () => {
    assertDockerContract(dockerfile)
  })

  it('rejects creating the runtime user after USER', () => {
    const creationLines = [
      'RUN addgroup -S -g 1000 caddy \\',
      '  && adduser -S -D -H -u 1000 -G caddy caddy',
    ]
    const mutated = dockerfile
      .split('\n')
      .filter((line) => !creationLines.includes(line))
      .join('\n')
      .replace('USER caddy', `USER caddy\n${creationLines.join('\n')}`)

    expect(() => assertDockerContract(mutated)).toThrow()
  })

  it('rejects COPY instructions without caddy ownership', () => {
    const mutated = dockerfile.replaceAll('--chown=caddy:caddy ', '')

    expect(() => assertDockerContract(mutated)).toThrow()
  })

  it('rejects retaining upstream Caddy file capabilities', () => {
    const mutated = dockerfile.replace('RUN setcap -r /usr/bin/caddy\n', '')

    expect(() => assertDockerContract(mutated)).toThrow()
  })

  it('rejects creating the user before its group', () => {
    const addGroup = 'RUN addgroup -S -g 1000 caddy \\'
    const addUser = '  && adduser -S -D -H -u 1000 -G caddy caddy'
    const mutated = dockerfile.replace(
      `${addGroup}\n${addUser}`,
      `${addUser}\n${addGroup}`,
    )

    expect(() => assertDockerContract(mutated)).toThrow()
  })

  it('rejects a health command that does not probe the endpoint', () => {
    const mutated = dockerfile.replace(
      'CMD wget -q --spider http://127.0.0.1:8080/healthz || exit 1',
      'CMD true http://127.0.0.1:8080/healthz',
    )

    expect(() => assertDockerContract(mutated)).toThrow()
  })

  it('accepts the production Compose structure', () => {
    assertComposeContract(compose)
  })

  it.each([
    ['cap_drop', compose.replace('    cap_drop: [ALL]\n', '')],
    [
      'tmpfs',
      compose.replace(
        '    tmpfs:\n      - /config:size=1m,mode=0700,uid=1000,gid=1000\n      - /data:size=1m,mode=0700,uid=1000,gid=1000\n',
        '',
      ),
    ],
    [
      'healthcheck',
      compose.replace(
        '    healthcheck:\n      test: [CMD, wget, -q, --spider, http://127.0.0.1:8080/healthz]\n      interval: 10s\n      timeout: 3s\n      retries: 6\n      start_period: 5s\n',
        '',
      ),
    ],
    ['blog network alias', compose.replace('        aliases: [blog]\n', '')],
  ])('rejects Compose without %s', (_name, mutated) => {
    expect(() => assertComposeContract(mutated)).toThrow()
  })

  it('rejects an additional service with host ports and volumes', () => {
    const mutated = compose.replace(
      'services:\n',
      'services:\n  debug:\n    image: busybox\n    ports: ["8081:80"]\n    volumes: ["/tmp:/tmp"]\n',
    )

    expect(() => assertComposeContract(mutated)).toThrow()
  })

  it('rejects additional relaxed security options', () => {
    const mutated = compose.replace(
      '      - no-new-privileges:true\n',
      '      - no-new-privileges:true\n      - seccomp:unconfined\n',
    )

    expect(() => assertComposeContract(mutated)).toThrow()
  })

  it('accepts the production Caddyfile', () => {
    assertCaddyContract(caddyfile)
  })

  it.each([
    ['static file serving', caddyfile.replace('    file_server\n', '')],
    [
      '404 handling',
      caddyfile.replace(
        '    handle_errors {\n        rewrite * /404.html\n        file_server\n    }\n',
        '',
      ),
    ],
  ])('rejects Caddy without %s', (_name, mutated) => {
    expect(() => assertCaddyContract(mutated)).toThrow()
  })

  it('rejects the wrong listener even when a comment contains the expected one', () => {
    const mutated = caddyfile.replace(':8080 {', '# :8080 {\n:9090 {')

    expect(() => assertCaddyContract(mutated)).toThrow()
  })

  it('rejects an unhealthy response even when a comment contains the expected one', () => {
    const mutated = caddyfile.replace(
      '    respond /healthz "ok" 200',
      '    # respond /healthz "ok" 200\n    respond /healthz "ok" 503',
    )

    expect(() => assertCaddyContract(mutated)).toThrow()
  })

  it('excludes private planning and environment files from the build context', () => {
    const ignored = read('.dockerignore').split('\n')

    expect(ignored).toContain('.superpowers')
    expect(ignored).toContain('.env*')
  })

  it('includes only the workflow required by container build tests', () => {
    assertDockerIgnoreContract(read('.dockerignore'))
  })

  it.each([
    '!.github/*',
    '!.github/workflows/*',
    '!.github/workflows/deploy.yml',
    '!.github/actions',
    '.github/',
    '/.github',
    '.github/**',
    '!**',
  ])('rejects a broader Docker context rule: %s', (rule) => {
    const mutated = `${read('.dockerignore')}\n${rule}\n`

    expect(() => assertDockerIgnoreContract(mutated)).toThrow()
  })
})

describe('GitHub Actions release contract', () => {
  const workflow = read('.github/workflows/ci.yml')

  it('accepts the least-privilege verify, publish, and deploy workflow', () => {
    assertWorkflowContract(workflow)
  })

  it.each([
    [
      'deployment without the explicit enable gate',
      workflow.replace(" && vars.DEPLOY_ENABLED == 'true'", ''),
    ],
    [
      'a mutable latest image tag',
      workflow.replace(
        'ghcr.io/minyaako/blog:${{ github.sha }}',
        'ghcr.io/minyaako/blog:latest',
      ),
    ],
    [
      'publishing from pull requests',
      workflow.replace(
        "github.event_name != 'pull_request'",
        "github.event_name == 'pull_request'",
      ),
    ],
    [
      'a privileged pull-request trigger',
      workflow.replace(
        '  pull_request:\n',
        '  pull_request:\n  pull_request_target:\n',
      ),
    ],
    [
      'package write permission at workflow scope',
      workflow.replace(
        'permissions:\n  contents: read',
        'permissions:\n  contents: read\n  packages: write',
      ),
    ],
  ])('rejects %s', (_name, mutated) => {
    expect(() => assertWorkflowContract(mutated)).toThrow()
  })
})
