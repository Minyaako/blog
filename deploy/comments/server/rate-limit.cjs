'use strict'

const { DatabaseSync } = require('node:sqlite')

const DEFAULT_DATABASE = '/app/data/waline.sqlite'
const DEFAULT_LIMIT = 10
const DEFAULT_WINDOW_SECONDS = 600

function createSqliteEventStore(databasePath = DEFAULT_DATABASE) {
  const initialize = (database) => {
    database.exec(`
      CREATE TABLE IF NOT EXISTS wl_RateLimitEvent (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ip TEXT NOT NULL,
        insertedAt DATETIME NOT NULL DEFAULT (datetime('now', 'localtime'))
      );
      CREATE INDEX IF NOT EXISTS wl_RateLimitEvent_ip_insertedAt
        ON wl_RateLimitEvent (ip, insertedAt);
    `)
  }

  return {
    reserve(ip, windowSeconds, limit) {
      const database = new DatabaseSync(databasePath)
      let transactionOpen = false

      try {
        initialize(database)
        database.exec('BEGIN IMMEDIATE')
        transactionOpen = true
        database.prepare(`
          DELETE FROM wl_RateLimitEvent
          WHERE insertedAt <= datetime('now', 'localtime', ?)
        `).run(`-${windowSeconds} seconds`)

        const row = database.prepare(`
          SELECT count(*) AS count, min(insertedAt) AS oldest
          FROM wl_RateLimitEvent
          WHERE ip = ?
        `).get(ip)
        const count = Number(row?.count ?? 0)

        if (count >= limit) {
          database.exec('COMMIT')
          transactionOpen = false
          const oldest = typeof row?.oldest === 'string'
            ? Date.parse(`${row.oldest.replace(' ', 'T')}+08:00`)
            : Number.NaN
          const retryAfter = Number.isFinite(oldest)
            ? Math.max(1, Math.ceil((oldest + windowSeconds * 1000 - Date.now()) / 1000))
            : windowSeconds
          return { allowed: false, retryAfter }
        }

        const result = database.prepare(`
          INSERT INTO wl_RateLimitEvent (ip) VALUES (?)
        `).run(ip)
        database.exec('COMMIT')
        transactionOpen = false
        return { allowed: true, eventId: Number(result.lastInsertRowid) }
      } catch (error) {
        if (transactionOpen) database.exec('ROLLBACK')
        throw error
      } finally {
        database.close()
      }
    },

    release(eventId) {
      const database = new DatabaseSync(databasePath)
      try {
        initialize(database)
        database.prepare('DELETE FROM wl_RateLimitEvent WHERE id = ?').run(eventId)
      } finally {
        database.close()
      }
    }
  }
}

function createSlidingWindowMiddleware({
  eventStore,
  limit = DEFAULT_LIMIT,
  windowSeconds = DEFAULT_WINDOW_SECONDS
}) {
  const queues = new Map()

  return async (ctx, next) => {
    const isCommentPost = ctx.method === 'POST' && ctx.path === '/api/comment'
    const isAdministrator = ctx.state?.userInfo?.type === 'administrator'

    if (!isCommentPost || isAdministrator) {
      await next()
      return
    }

    const key = ctx.ip
    const previous = queues.get(key) ?? Promise.resolve()
    let openGate
    const gate = new Promise((resolve) => { openGate = resolve })
    const tail = previous.then(() => gate)
    queues.set(key, tail)
    await previous

    let eventId
    try {
      const reservation = eventStore.reserve(key, windowSeconds, limit)
      if (!reservation.allowed) {
        ctx.status = 429
        ctx.set('Retry-After', String(reservation.retryAfter ?? windowSeconds))
        ctx.body = {
          errno: 429,
          errmsg: '发言稍微有些频繁，请在 10 分钟窗口释放后再试。'
        }
        return
      }

      eventId = reservation.eventId
      try {
        await next()
      } catch (error) {
        if (eventId !== undefined) eventStore.release(eventId)
        throw error
      }

      const failed = (ctx.status !== undefined && ctx.status >= 400) ||
        (typeof ctx.body?.errno === 'number' && ctx.body.errno !== 0)
      if (failed && eventId !== undefined) eventStore.release(eventId)
    } finally {
      openGate()
      if (queues.get(key) === tail) queues.delete(key)
    }
  }
}

const limit = Number.parseInt(process.env.COMMENT_RATE_LIMIT ?? '', 10) || DEFAULT_LIMIT
const windowSeconds = Number.parseInt(process.env.COMMENT_RATE_WINDOW_SECONDS ?? '', 10) || DEFAULT_WINDOW_SECONDS

module.exports = {
  createSlidingWindowMiddleware,
  createSqliteEventStore,
  middlewares: [
    createSlidingWindowMiddleware({
      eventStore: createSqliteEventStore(),
      limit,
      windowSeconds
    })
  ]
}
