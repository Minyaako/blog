import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const read = (path: string) => readFileSync(path, 'utf8')

const hasDockerDaemon = () => {
  if (process.platform === 'win32' || !existsSync('/var/run/docker.sock')) return false

  try {
    execFileSync('docker', ['info'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

describe('blog comments deployment', () => {
  it('pins and isolates the Waline service with the approved runtime policy', () => {
    const compose = parse(read('deploy/comments/compose.yml'))
    const service = compose.services['blog-comments']

    expect(service.image).toBe('lizheming/waline:1.41.4@sha256:a3c87cb50fdb3aa786d73ac7afed492811d5dbc217866b12f3d5a4eda5c5e4bc')
    expect(service.ports).toBeUndefined()
    expect(service.networks.server_proxy.aliases).toEqual(['blog-comments'])
    expect(service.env_file).toEqual(['/srv/secrets/blog-comments/waline.env'])
    expect(service.volumes).toEqual(['/srv/apps/blog-comments/data:/app/data'])
    expect(service.environment).toMatchObject({
      SQLITE_PATH: '/app/data',
      SQLITE_DB: 'waline',
      SITE_URL: 'https://gsk.minyako.top',
      SERVER_URL: 'https://comments.minyako.top',
      SECURE_DOMAINS: 'gsk.minyako.top,comments.minyako.top',
      COMMENT_AUDIT: 'false',
      IPQPS: '60',
      AKISMET_KEY: 'false',
      DISABLE_USERAGENT: 'true',
      DISABLE_REGION: 'true',
      AVATAR_PROXY: 'false',
      MARKDOWN_CONFIG: '{"html":false}'
    })
    expect(service.environment.GRAVATAR_STR).toMatch(/^data:image\/svg\+xml/)
    expect(JSON.stringify(service)).not.toMatch(/SMTP_|TURNSTILE|RECAPTCHA|latest/)
  })

  it('initializes, backs up, verifies, and prunes a disposable SQLite database', () => {
    if (!hasDockerDaemon()) return

    const root = mkdtempSync(join(tmpdir(), 'blog-comments-data-'))
    const env = {
      ...process.env,
      COMMENTS_DATA_ROOT: join(root, 'data'),
      COMMENTS_BACKUP_ROOT: join(root, 'backups'),
      COMMENTS_SCHEMA: join(process.cwd(), 'deploy/comments/waline.sqlite.sql')
    }
    const script = 'deploy/comments/bin/comments-data'

    execFileSync('sh', [script, 'init'], { env, stdio: 'pipe' })
    const backup = execFileSync('sh', [script, 'backup'], { env, encoding: 'utf8' }).trim()
    const report = execFileSync('sh', [script, 'verify', backup], { env, encoding: 'utf8' })
    execFileSync('sh', [script, 'prune'], { env, stdio: 'pipe' })

    expect(backup).toMatch(/waline-\d{8}T\d{6}Z\.sqlite\.gz$/)
    expect(report).toContain('integrity=ok')
    expect(report).toContain('comments=0')
    expect(report).toContain('replies=0')
    expect(report).toContain('admins=0')
  }, 30_000)

  it('reads root-private backup directories as root inside helper containers', () => {
    const script = read('deploy/comments/bin/comments-data')
    const readonlyBackupMount = '--mount "type=bind,src=$daily,dst=/backup,readonly"'
    const mountIndex = script.indexOf(readonlyBackupMount)
    const verificationRun = script.slice(script.lastIndexOf('"$docker_bin" run --rm', mountIndex))

    expect(verificationRun).toMatch(
      /^"\$docker_bin" run --rm \\\n\s+--user 0:0 \\\n\s+--mount[^\n]+"\$sqlite_image"/m
    )
  })
})
