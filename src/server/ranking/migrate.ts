import type { DatabaseSync } from 'node:sqlite'

export const RANKING_SCHEMA_VERSION = 1
const APPLICATION_ID = 0x52414e4b

/** Explicit deployment step; opening a store never initializes an empty database. */
export function migrateRankingDatabase(db: DatabaseSync): void {
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE')
  try {
    const version = Number(db.prepare('PRAGMA user_version').get()!.user_version)
    if (version === RANKING_SCHEMA_VERSION) {
      assertRankingSchema(db)
      db.exec('COMMIT')
      return
    }
    if (version !== 0 || db.prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' LIMIT 1").get()) {
      throw new Error('Unsupported ranking database schema; explicit migration required')
    }
    db.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, created_at TEXT NOT NULL) STRICT;
      CREATE TABLE auth_identities (
        provider TEXT NOT NULL, subject TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
        PRIMARY KEY (provider, subject)
      ) STRICT;
      CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
        csrf_token TEXT NOT NULL, expires_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX sessions_expiry ON sessions(expires_at);
      CREATE TABLE rankings (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id),
        source_ranking_id TEXT, source_version_id TEXT, current_version_id TEXT,
        hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
        CHECK ((source_ranking_id IS NULL) = (source_version_id IS NULL)),
        FOREIGN KEY (source_ranking_id, source_version_id) REFERENCES versions(ranking_id, id),
        FOREIGN KEY (id, current_version_id) REFERENCES versions(ranking_id, id)
      ) STRICT;
      CREATE TABLE submissions (
        id TEXT PRIMARY KEY, ranking_id TEXT NOT NULL REFERENCES rankings(id),
        author_id TEXT NOT NULL REFERENCES users(id), base_version_id TEXT,
        payload TEXT NOT NULL CHECK (json_valid(payload)), request_id TEXT NOT NULL, request_digest TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'published', 'rejected', 'withdrawn')),
        submitted_at TEXT NOT NULL, processed_at TEXT, reason TEXT, published_version_id TEXT,
        UNIQUE (author_id, request_id), UNIQUE (ranking_id, id),
        FOREIGN KEY (ranking_id, base_version_id) REFERENCES versions(ranking_id, id),
        FOREIGN KEY (ranking_id, published_version_id) REFERENCES versions(ranking_id, id),
        CHECK ((status = 'pending') = (processed_at IS NULL)),
        CHECK ((status = 'published') = (published_version_id IS NOT NULL)),
        CHECK (status != 'rejected' OR length(trim(reason)) > 0)
      ) STRICT;
      CREATE UNIQUE INDEX one_pending_per_ranking ON submissions(ranking_id) WHERE status = 'pending';
      CREATE INDEX submissions_author_time ON submissions(author_id, submitted_at DESC);
      CREATE INDEX submissions_status_time ON submissions(status, submitted_at DESC);
      CREATE TABLE versions (
        id TEXT PRIMARY KEY, ranking_id TEXT NOT NULL REFERENCES rankings(id), number INTEGER NOT NULL CHECK(number > 0),
        parent_version_id TEXT, submission_id TEXT NOT NULL UNIQUE,
        payload TEXT NOT NULL CHECK (json_valid(payload)), published_at TEXT NOT NULL,
        UNIQUE (ranking_id, id), UNIQUE (ranking_id, number),
        FOREIGN KEY (ranking_id, parent_version_id) REFERENCES versions(ranking_id, id),
        FOREIGN KEY (ranking_id, submission_id) REFERENCES submissions(ranking_id, id)
      ) STRICT;
      CREATE TABLE moderation_events (
        id TEXT PRIMARY KEY, ranking_id TEXT NOT NULL REFERENCES rankings(id), submission_id TEXT REFERENCES submissions(id),
        action TEXT NOT NULL CHECK(action IN ('approve', 'reject', 'withdraw', 'hide', 'restore')),
        actor_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, reason TEXT
      ) STRICT;
      CREATE TRIGGER immutable_version_update BEFORE UPDATE ON versions BEGIN SELECT RAISE(ABORT, 'Published versions are immutable'); END;
      CREATE TRIGGER immutable_version_delete BEFORE DELETE ON versions BEGIN SELECT RAISE(ABORT, 'Published versions are immutable'); END;
      CREATE TRIGGER immutable_ranking_identity BEFORE UPDATE OF id, owner_id, source_ranking_id, source_version_id ON rankings
        WHEN NEW.id IS NOT OLD.id OR NEW.owner_id IS NOT OLD.owner_id OR NEW.source_ranking_id IS NOT OLD.source_ranking_id OR NEW.source_version_id IS NOT OLD.source_version_id
        BEGIN SELECT RAISE(ABORT, 'Ranking identity is immutable'); END;
      CREATE TRIGGER immutable_submission_content BEFORE UPDATE OF id, ranking_id, author_id, base_version_id, payload, request_id, request_digest, submitted_at ON submissions
        BEGIN SELECT RAISE(ABORT, 'Submitted content is immutable'); END;
      CREATE TRIGGER submission_transition BEFORE UPDATE ON submissions WHEN OLD.status != 'pending' OR NEW.status = 'pending'
        BEGIN SELECT RAISE(ABORT, 'Invalid submission transition'); END;
      CREATE TRIGGER submission_owner BEFORE INSERT ON submissions
        WHEN NEW.author_id IS NOT (SELECT owner_id FROM rankings WHERE id = NEW.ranking_id)
        BEGIN SELECT RAISE(ABORT, 'Submission owner mismatch'); END;
      CREATE TRIGGER version_chain BEFORE INSERT ON versions
        WHEN NEW.parent_version_id IS NOT (SELECT current_version_id FROM rankings WHERE id = NEW.ranking_id)
          OR NEW.number != COALESCE((SELECT number + 1 FROM versions WHERE id = NEW.parent_version_id), 1)
          OR NOT EXISTS (SELECT 1 FROM submissions WHERE id = NEW.submission_id AND ranking_id = NEW.ranking_id AND status = 'pending' AND payload = NEW.payload AND base_version_id IS NEW.parent_version_id)
        BEGIN SELECT RAISE(ABORT, 'Invalid version chain or submission'); END;
      CREATE TRIGGER submission_publication BEFORE UPDATE ON submissions WHEN NEW.status = 'published'
        AND NOT EXISTS (SELECT 1 FROM versions WHERE id = NEW.published_version_id AND submission_id = NEW.id AND ranking_id = NEW.ranking_id)
        BEGIN SELECT RAISE(ABORT, 'Publication mismatch'); END;
      PRAGMA application_id = ${APPLICATION_ID};
      PRAGMA user_version = ${RANKING_SCHEMA_VERSION};
    `)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function assertRankingSchema(db: DatabaseSync): void {
  if (Number(db.prepare('PRAGMA user_version').get()!.user_version) !== RANKING_SCHEMA_VERSION ||
      Number(db.prepare('PRAGMA application_id').get()!.application_id) !== APPLICATION_ID) {
    throw new Error('Ranking database is missing or incompatible; run the explicit migration first')
  }
  // Preparing these statements checks required columns without touching data.
  for (const sql of [
    'SELECT id, display_name, created_at FROM users LIMIT 0',
    'SELECT provider, subject, user_id FROM auth_identities LIMIT 0',
    'SELECT token_hash, user_id, csrf_token, expires_at FROM sessions LIMIT 0',
    'SELECT id, owner_id, source_ranking_id, source_version_id, current_version_id, hidden FROM rankings LIMIT 0',
    'SELECT id, ranking_id, author_id, base_version_id, payload, request_id, request_digest, status, submitted_at, processed_at, reason, published_version_id FROM submissions LIMIT 0',
    'SELECT id, ranking_id, number, parent_version_id, submission_id, payload, published_at FROM versions LIMIT 0',
    'SELECT id, ranking_id, submission_id, action, actor_id, created_at, reason FROM moderation_events LIMIT 0',
  ]) db.prepare(sql)
  const objects = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type IN ('trigger', 'index')").all().map(row => row.name))
  for (const name of ['one_pending_per_ranking', 'immutable_version_update', 'immutable_version_delete', 'immutable_ranking_identity', 'immutable_submission_content', 'submission_transition', 'submission_owner', 'version_chain', 'submission_publication']) {
    if (!objects.has(name)) throw new Error(`Ranking database constraint is missing: ${name}`)
  }
}
