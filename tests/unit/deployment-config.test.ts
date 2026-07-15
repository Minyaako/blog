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
  services?: { blog?: ComposeService }
  networks?: Record<string, { external?: boolean }>
}

const read = (path: string) => readFileSync(path, 'utf8').replaceAll('\r\n', '\n')

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

  expect(runtime).toContain(addGroup)
  expect(runtime).toContain(addUser)
  expect(runtime.match(/^COPY .+$/gm)).toEqual([copySite, copyConfig])
  expect(runtime.match(/^USER .+$/gm)).toEqual([user])

  for (const instruction of [addGroup, addUser]) {
    expect(runtime.indexOf(instruction)).toBeLessThan(runtime.indexOf(copySite))
    expect(runtime.indexOf(instruction)).toBeLessThan(runtime.indexOf(copyConfig))
    expect(runtime.indexOf(instruction)).toBeLessThan(runtime.indexOf(user))
  }
  expect(runtime.indexOf(copySite)).toBeLessThan(runtime.indexOf(user))
  expect(runtime.indexOf(copyConfig)).toBeLessThan(runtime.indexOf(user))

  expect(runtime).toMatch(/^EXPOSE 8080$/m)
  expect(runtime).toContain('HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=6')
  expect(runtime).toContain('http://127.0.0.1:8080/healthz')
}

const assertComposeContract = (source: string) => {
  const compose = parse(source) as ComposeDocument
  const blog = compose.services?.blog

  expect(blog?.image).toBe('${BLOG_IMAGE:?BLOG_IMAGE is required}')
  expect(blog?.ports).toBeUndefined()
  expect(blog?.volumes).toBeUndefined()
  expect(blog?.read_only).toBe(true)
  expect(blog?.cap_drop).toEqual(['ALL'])
  expect(blog?.security_opt).toContain('no-new-privileges:true')
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
  expect(caddyfile).toContain('admin off')
  expect(caddyfile).toContain('auto_https off')
  expect(caddyfile).toContain('persist_config off')
  expect(caddyfile).toContain(':8080 {')
  expect(caddyfile).toContain('root * /srv')
  expect(caddyfile).toContain('respond /healthz "ok" 200')
  expect(caddyfile).toMatch(/^ {4}file_server$/m)
  expect(caddyfile).toMatch(
    /handle_errors \{\s+rewrite \* \/404\.html\s+file_server\s+\}/,
  )
  expect(caddyfile).toContain('X-Content-Type-Options nosniff')
  expect(caddyfile).toContain('Referrer-Policy strict-origin-when-cross-origin')
  expect(caddyfile).toContain('@immutable path /_astro/* /pagefind/*')
  expect(caddyfile).toContain(
    'header @immutable Cache-Control "public, max-age=31536000, immutable"',
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

  it('excludes private planning and environment files from the build context', () => {
    const ignored = read('.dockerignore').split('\n')

    expect(ignored).toContain('.superpowers')
    expect(ignored).toContain('.env*')
  })
})
