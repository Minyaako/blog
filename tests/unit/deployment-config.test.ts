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
