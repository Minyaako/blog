import { createRequire } from 'node:module'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { createSlidingWindowMiddleware, createSqliteEventStore } = require('../../deploy/comments/server/rate-limit.cjs') as {
  createSlidingWindowMiddleware(options: {
    eventStore: {
      reserve(ip: string, windowSeconds: number, limit: number): { allowed: boolean; eventId?: number; retryAfter?: number }
      release(eventId: number): void
    }
    limit: number
    windowSeconds: number
  }): (ctx: RateLimitContext, next: () => Promise<void>) => Promise<void>
  createSqliteEventStore(databasePath: string): {
    reserve(ip: string, windowSeconds: number, limit: number): { allowed: boolean; eventId?: number; retryAfter?: number }
    release(eventId: number): void
  }
}

interface RateLimitContext {
  method: string
  path: string
  ip: string
  status?: number
  body?: { errno: number; errmsg: string }
  state?: { userInfo?: { type?: string } }
  set(name: string, value: string): void
}

const createContext = (ip = '203.0.113.10'): RateLimitContext => ({
  method: 'POST',
  path: '/api/comment',
  ip,
  set: vi.fn()
})

describe('Waline sliding-window rate limit', () => {
  it('allows ten comments in ten minutes and rejects the eleventh with retry guidance', async () => {
    let saved = 0
    const eventStore = {
      reserve: () => saved >= 10
        ? { allowed: false, retryAfter: 420 }
        : { allowed: true, eventId: ++saved },
      release: vi.fn()
    }
    const middleware = createSlidingWindowMiddleware({
      limit: 10,
      windowSeconds: 600,
      eventStore
    })

    for (let index = 0; index < 10; index += 1) {
      const ctx = createContext()
      await middleware(ctx, async () => undefined)
      expect(ctx.status).toBeUndefined()
    }

    const rejected = createContext()
    const next = vi.fn()
    await middleware(rejected, next)

    expect(next).not.toHaveBeenCalled()
    expect(rejected.status).toBe(429)
    expect(rejected.body).toEqual({
      errno: 429,
      errmsg: '发言稍微有些频繁，请在 10 分钟窗口释放后再试。'
    })
    expect(rejected.set).toHaveBeenCalledWith('Retry-After', '420')
  })

  it('serializes concurrent comments from the same IP at the window boundary', async () => {
    let saved = 9
    const eventStore = {
      reserve: () => saved >= 10
        ? { allowed: false, retryAfter: 60 }
        : { allowed: true, eventId: ++saved },
      release: vi.fn()
    }
    const middleware = createSlidingWindowMiddleware({
      limit: 10,
      windowSeconds: 600,
      eventStore
    })
    const first = createContext()
    const second = createContext()

    await Promise.all([
      middleware(first, async () => {
        await Promise.resolve()
      }),
      middleware(second, async () => undefined)
    ])

    expect(saved).toBe(10)
    expect([first.status, second.status].filter((status) => status === 429)).toHaveLength(1)
  })

  it('leaves reads, unrelated posts, and administrator comments untouched', async () => {
    const middleware = createSlidingWindowMiddleware({
      limit: 10,
      windowSeconds: 600,
      eventStore: {
        reserve: () => ({ allowed: false, retryAfter: 60 }),
        release: vi.fn()
      }
    })
    const contexts = [
      { ...createContext(), method: 'GET' },
      { ...createContext(), path: '/api/token' },
      { ...createContext(), state: { userInfo: { type: 'administrator' } } }
    ]

    for (const ctx of contexts) {
      const next = vi.fn().mockResolvedValue(undefined)
      await middleware(ctx, next)
      expect(next).toHaveBeenCalledOnce()
      expect(ctx.status).toBeUndefined()
    }
  })

  it('releases a reservation when Waline rejects the comment', async () => {
    const release = vi.fn()
    const middleware = createSlidingWindowMiddleware({
      limit: 10,
      windowSeconds: 600,
      eventStore: {
        reserve: () => ({ allowed: true, eventId: 7 }),
        release
      }
    })

    await expect(middleware(createContext(), async () => { throw new Error('write failed') })).rejects.toThrow('write failed')
    expect(release).toHaveBeenCalledWith(7)
  })

  it('keeps submission events independent from comment deletion and expires them after the window', () => {
    const root = mkdtempSync(join(tmpdir(), 'comment-rate-limit-'))
    const databasePath = join(root, 'waline.sqlite')

    try {
      const database = new DatabaseSync(databasePath)
      database.exec('CREATE TABLE wl_Comment (id INTEGER PRIMARY KEY, ip TEXT); INSERT INTO wl_Comment (ip) VALUES (\'203.0.113.10\'); DELETE FROM wl_Comment;')
      database.close()
      const store = createSqliteEventStore(databasePath)

      for (let index = 0; index < 10; index += 1) {
        expect(store.reserve('203.0.113.10', 600, 10).allowed).toBe(true)
      }
      expect(store.reserve('203.0.113.10', 600, 10).allowed).toBe(false)

      const editor = new DatabaseSync(databasePath)
      editor.exec("UPDATE wl_RateLimitEvent SET insertedAt = datetime('now', 'localtime', '-601 seconds')")
      editor.close()
      expect(store.reserve('203.0.113.10', 600, 10).allowed).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
