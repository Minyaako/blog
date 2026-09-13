import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'

const directories: string[] = []
const cli = resolve('scripts/ranking-db.ts')
function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'ranking-cli-'))
  directories.push(directory)
  const database = join(directory, 'ranking.sqlite')
  const run = (args: string[], extra: NodeJS.ProcessEnv = {}) => spawnSync(process.execPath,
    ['--experimental-transform-types', cli, ...args], {
      env: {
        ...process.env, NODE_ENV: 'test', RANKING_DATABASE: database, RANKING_WRITE_ENABLED: 'false',
        RANKING_WALINE_URL: 'http://127.0.0.1:4336', ...extra,
      },
      encoding: 'utf8', timeout: 15_000,
    })
  return { directory, database, run }
}
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

describe('explicit ranking database maintenance', () => {
  it('does not create a missing database during check, and refuses to initialize it twice', () => {
    const { database, run } = setup()
    expect(run(['check']).status).toBe(1)
    expect(existsSync(database)).toBe(false)
    expect(run(['init']).status).toBe(0)
    expect(run(['check']).status).toBe(0)
    const before = readFileSync(database)
    expect(run(['init']).status).toBe(1)
    expect(readFileSync(database)).toEqual(before)
  })

  it('rejects relative database paths and migrations without maintenance mode', () => {
    const { run } = setup()
    expect(run(['init'], { RANKING_DATABASE: 'ranking.sqlite' }).status).toBe(1)
    expect(run(['init']).status).toBe(0)
    expect(run(['migrate'], { RANKING_WRITE_ENABLED: 'true' }).status).toBe(1)
    expect(run(['migrate']).status).toBe(0)
  })

  it('rejects a missing required database constraint without repairing it', () => {
    const { database, run } = setup()
    expect(run(['init']).status).toBe(0)
    const db = new DatabaseSync(database)
    db.exec('DROP TRIGGER immutable_version_update')
    db.close()
    expect(run(['check']).status).toBe(1)
  })

  it('backs up committed WAL data consistently and never overwrites a destination', () => {
    const { database, directory, run } = setup()
    expect(run(['init']).status).toBe(0)
    const db = new DatabaseSync(database)
    db.exec("PRAGMA journal_mode=WAL; INSERT INTO users VALUES ('backup-user', '备份测试', '2026-09-13T00:00:00.000Z')")
    try {
      const destination = join(directory, 'backup.sqlite')
      expect(run(['backup', destination]).status).toBe(0)
      const snapshot = new DatabaseSync(destination, { readOnly: true })
      expect(snapshot.prepare('SELECT display_name FROM users WHERE id = ?').get('backup-user')?.display_name).toBe('备份测试')
      snapshot.close()
      const before = readFileSync(destination)
      expect(run(['backup', destination]).status).toBe(1)
      expect(readFileSync(destination)).toEqual(before)
      expect(run(['backup', database]).status).toBe(1)
    } finally { db.close() }
  })

  it('only seeds explicitly isolated test files, without printing session tokens', () => {
    const { directory, run } = setup()
    expect(run(['seed', '--test-only']).status).toBe(1)
    const path = join(directory, '.ranking-data', 'test-e2e.sqlite')
    expect(run(['seed'], { RANKING_DATABASE: path }).status).toBe(1)
    expect(run(['seed', '--test-only'], { RANKING_DATABASE: path, NODE_ENV: 'production' }).status).toBe(1)
    const result = run(['seed', '--test-only'], { RANKING_DATABASE: path })
    expect(result.stderr, result.stdout).not.toContain('Error:')
    expect(result.status).toBe(0)
    const fixture = JSON.parse(readFileSync(path.replace('.sqlite', '.fixture.json'), 'utf8'))
    expect(fixture.admin.id).toBe('00000000-0000-4000-8000-000000000001')
    expect(fixture.admin.walineToken).toBe('test-token-admin')
    expect(fixture.author.walineToken).toBe('test-token-author')
    expect(fixture.versionId).toMatch(/^[0-9a-f-]{36}$/)
    expect(`${result.stdout}${result.stderr}`).not.toContain(fixture.author.token)
    expect(`${result.stdout}${result.stderr}`).not.toContain(fixture.author.walineToken)
    const seeded = new DatabaseSync(path, { readOnly: true })
    try {
      const identities = seeded.prepare('SELECT provider, subject, user_id FROM auth_identities ORDER BY subject').all()
      expect(identities).toEqual(expect.arrayContaining([
        { provider: 'waline:http://127.0.0.1:4336', subject: 'test-admin', user_id: '00000000-0000-4000-8000-000000000001' },
        { provider: 'waline:http://127.0.0.1:4336', subject: 'test-author', user_id: '00000000-0000-4000-8000-000000000002' },
      ]))
    } finally { seeded.close() }
    expect(run(['seed', '--test-only'], { RANKING_DATABASE: path }).status).toBe(0)
  })

  it('refuses test seeding if the database contains another identity', () => {
    const { directory, run } = setup()
    const path = join(directory, '.ranking-data', 'test-other.sqlite')
    mkdirSync(join(directory, '.ranking-data'))
    expect(run(['init'], { RANKING_DATABASE: path }).status).toBe(0)
    const db = new DatabaseSync(path)
    db.exec("INSERT INTO users VALUES ('existing-real-user', 'Original', '2026-09-13')")
    db.close()
    expect(run(['seed', '--test-only'], { RANKING_DATABASE: path }).status).toBe(1)
    expect(existsSync(path.replace('.sqlite', '.fixture.json'))).toBe(false)
  })
})
