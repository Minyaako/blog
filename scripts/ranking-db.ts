import { closeSync, existsSync, lstatSync, mkdirSync, openSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, resolve } from 'node:path'
import { DatabaseSync, backup } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import { assertRankingSchema, migrateRankingDatabase } from '../src/server/ranking/migrate.ts'
import { RankingStore } from '../src/server/ranking/store.ts'

export const TEST_ADMIN_ID = '00000000-0000-4000-8000-000000000001'
export const TEST_AUTHOR_ID = '00000000-0000-4000-8000-000000000002'
const DEFAULT_TEST_WALINE_URL = 'http://127.0.0.1:4336'
export const TEST_ADMIN_WALINE_TOKEN = 'test-token-admin'
export const TEST_AUTHOR_WALINE_TOKEN = 'test-token-author'

function testWalineProvider(value: string | undefined): string {
  let url: URL
  try { url = new URL(value || DEFAULT_TEST_WALINE_URL) } catch { throw new Error('RANKING_WALINE_URL must be a valid test URL') }
  if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error('RANKING_WALINE_URL must use HTTPS or a loopback HTTP test URL')
  }
  return `waline:${url.href.replace(/\/+$/, '')}`
}

function prepareTestPath(args: string[], env: NodeJS.ProcessEnv) {
  const path = env.RANKING_DATABASE
  if (args.length !== 1 || args[0] !== '--test-only' || env.NODE_ENV === 'production' ||
    !path || !isAbsolute(path) || basename(dirname(path)) !== '.ranking-data' ||
    !/^test-[a-z0-9-]+\.sqlite$/.test(basename(path))) {
    throw new Error('seed requires --test-only and an absolute .ranking-data/test-NAME.sqlite path outside production')
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  if (lstatSync(dirname(path)).isSymbolicLink() || resolve(dirname(path)) !== realpathSync(dirname(path))) {
    throw new Error('Test data directory must not redirect through symlinks')
  }
}

function seed(db: DatabaseSync, path: string, env: NodeJS.ProcessEnv) {
  if (db.prepare('SELECT id FROM users WHERE id NOT IN (?, ?) LIMIT 1').get(TEST_ADMIN_ID, TEST_AUTHOR_ID)) {
    throw new Error('Test seed refuses a database with non-test users')
  }
  const createdAt = new Date().toISOString()
  for (const [id, name] of [[TEST_ADMIN_ID, '测试管理员'], [TEST_AUTHOR_ID, '测试作者']]) {
    db.prepare('INSERT OR IGNORE INTO users (id, display_name, created_at) VALUES (?, ?, ?)').run(id!, name!, createdAt)
  }
  const provider = testWalineProvider(env.RANKING_WALINE_URL)
  for (const [subject, userId] of [['test-admin', TEST_ADMIN_ID], ['test-author', TEST_AUTHOR_ID]]) {
    const existing = db.prepare('SELECT user_id FROM auth_identities WHERE provider = ? AND subject = ?').get(provider, subject)
    if (existing && String(existing.user_id) !== userId) throw new Error('Test seed refuses a conflicting Waline identity')
    db.prepare('INSERT OR IGNORE INTO auth_identities (provider, subject, user_id) VALUES (?, ?, ?)').run(provider, subject, userId)
  }
  const store = new RankingStore(db, { adminIds: [TEST_ADMIN_ID] })
  const submission = store.submit(TEST_AUTHOR_ID, {
    requestId: '00000000-0000-4000-8000-000000000010',
    payload: {
      schemaVersion: 1, title: '社区示例榜单', description: '隔离验收数据', categoryId: 'games',
      items: [
        { itemId: '00000000-0000-4000-8000-000000000011', name: '第一项', note: '第一项说明' },
        { itemId: '00000000-0000-4000-8000-000000000012', name: '第二项' },
        { itemId: '00000000-0000-4000-8000-000000000013', name: '第三项' },
      ],
    },
  })
  const published = store.review(TEST_ADMIN_ID, submission.id, 'approve')
  const fixture = {
    admin: { id: TEST_ADMIN_ID, walineToken: TEST_ADMIN_WALINE_TOKEN, ...store.createSession(TEST_ADMIN_ID) },
    author: { id: TEST_AUTHOR_ID, walineToken: TEST_AUTHOR_WALINE_TOKEN, ...store.createSession(TEST_AUTHOR_ID) },
    rankingId: submission.rankingId, versionId: published.publishedVersionId,
  }
  const fixturePath = path.replace(/\.sqlite$/, '.fixture.json')
  if (existsSync(fixturePath) && (!lstatSync(fixturePath).isFile() || lstatSync(fixturePath).isSymbolicLink())) {
    throw new Error('Fixture destination must be a regular file')
  }
  writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, { mode: 0o600 })
  return 'Isolated test fixtures prepared'
}

function databasePath(value: string | undefined) {
  if (!value || !isAbsolute(value)) throw new Error('RANKING_DATABASE must be an absolute file path')
  if (!existsSync(dirname(value))) throw new Error('Database directory must be prepared by an administrator')
  if (existsSync(value) && (!lstatSync(value).isFile() || lstatSync(value).isSymbolicLink())) {
    throw new Error('Database must be a regular file, not a symlink')
  }
  return resolve(value)
}

function integrity(db: DatabaseSync) {
  const rows = db.prepare('PRAGMA integrity_check').all()
  if (rows.length !== 1 || rows[0]?.integrity_check !== 'ok') throw new Error('Database integrity check failed')
  if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Database foreign key check failed')
}

export async function runRankingDatabaseCommand(args: string[], env = process.env) {
  const [command, ...options] = args
  if (!['init', 'migrate', 'check', 'backup', 'users', 'seed'].includes(command ?? '')) {
    throw new Error('Usage: ranking:db init | migrate | check | backup ABSOLUTE_DESTINATION | users | seed --test-only')
  }
  if (command === 'seed') prepareTestPath(options, env)
  const path = databasePath(env.RANKING_DATABASE)
  if (command === 'init') {
    if (options.length) throw new Error('init accepts no arguments')
    // Exclusive creation prevents accidentally treating an existing database as a new one.
    closeSync(openSync(path, 'wx', 0o600))
  } else if (command === 'seed' && !existsSync(path)) {
    closeSync(openSync(path, 'wx', 0o600))
  } else if (!existsSync(path)) {
    throw new Error('Database does not exist; run init explicitly before starting the application')
  }
  if (command === 'migrate' && env.RANKING_WRITE_ENABLED !== 'false') {
    throw new Error('Migration requires RANKING_WRITE_ENABLED=false and application writes stopped')
  }
  if (command === 'migrate' && options.length) throw new Error('migrate accepts no arguments')
  const readOnly = ['check', 'backup', 'users'].includes(command!)
  const db = new DatabaseSync(path, { readOnly })
  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000')
    if (command === 'seed') {
      migrateRankingDatabase(db)
      return seed(db, path, env)
    }
    if (command === 'init' || command === 'migrate') {
      migrateRankingDatabase(db)
      assertRankingSchema(db)
      integrity(db)
      return 'Database schema ready'
    }
    assertRankingSchema(db)
    if (command === 'backup') {
      if (options.length !== 1) throw new Error('backup requires one absolute destination')
      const destination = databasePath(options[0])
      if (realpathSync(dirname(destination)) === realpathSync(dirname(path)) && destination === path) {
        throw new Error('Backup destination must differ from database')
      }
      closeSync(openSync(destination, 'wx', 0o600))
      try {
        await backup(db, destination)
        const snapshot = new DatabaseSync(destination, { readOnly: true })
        try { assertRankingSchema(snapshot); integrity(snapshot) } finally { snapshot.close() }
      } catch (error) {
        unlinkSync(destination)
        throw error
      }
      return 'Consistent backup created and checked'
    }
    if (command === 'users') {
      if (options.length) throw new Error('users accepts no arguments')
      return JSON.stringify(db.prepare('SELECT id, display_name FROM users ORDER BY created_at').all(), null, 2)
    }
    if (options.length) throw new Error('check accepts no arguments')
    integrity(db)
    return 'Database schema and integrity ready'
  } finally {
    db.close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runRankingDatabaseCommand(process.argv.slice(2)).then(
    (message) => process.stdout.write(`${message}\n`),
    (error: unknown) => {
      process.stderr.write(`ranking-db: ${error instanceof Error ? error.message : 'command failed'}\n`)
      process.exitCode = 1
    },
  )
}
