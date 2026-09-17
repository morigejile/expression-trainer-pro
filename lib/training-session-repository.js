'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const {randomUUID} = require('node:crypto');
const {sessionError, requireId, normalizeStart} = require('./training-session-data');

const SCHEMA_VERSION = 1;

function openTrainingSessionRepository(root) {
  fs.mkdirSync(root, {recursive: true});
  const filename = path.join(root, 'sessions.sqlite');
  // Inspect existing files read-only before any journal, migration, or recovery write.
  if (fs.existsSync(filename)) {
    const probe = new DatabaseSync(filename, {readOnly: true});
    try { checkVersion(probe); } finally { probe.close(); }
  }
  const db = new DatabaseSync(filename);
  let closed = false;
  try {
    checkVersion(db);
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000; PRAGMA synchronous = FULL;');
    if (db.prepare('PRAGMA user_version').get().user_version === 0) {
      transaction(() => {
        db.exec(`
          CREATE TABLE sessions (
            id TEXT PRIMARY KEY,
            status TEXT NOT NULL CHECK(status IN ('recording','finalizing','completed','incomplete','corrupt')),
            created_at TEXT NOT NULL,
            completed_at TEXT,
            duration_ms INTEGER,
            facts_json TEXT NOT NULL,
            quality_json TEXT NOT NULL DEFAULT '[]',
            deletion_pending INTEGER NOT NULL DEFAULT 0 CHECK(deletion_pending IN (0,1))
          ) STRICT;
          CREATE INDEX sessions_history ON sessions(created_at DESC, id DESC);
          CREATE TABLE transcripts (
            session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
            text TEXT NOT NULL,
            segments_json TEXT NOT NULL
          ) STRICT;
          CREATE TABLE artifacts (
            session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
            state TEXT NOT NULL CHECK(state IN ('staging','available','missing','corrupt','deleted')),
            relative_path TEXT NOT NULL,
            byte_length INTEGER,
            sha256 TEXT
          ) STRICT;
          PRAGMA user_version = 1;
        `);
      });
    }
  } catch (error) {
    db.close();
    throw error;
  }

  function checkVersion(connection) {
    const version = connection.prepare('PRAGMA user_version').get().user_version;
    if (version > SCHEMA_VERSION) {
      throw sessionError('UNSUPPORTED_SCHEMA', 'Training history was created by a newer app. Upgrade to open it.');
    }
  }

  function transaction(action) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function create(input) {
    const facts = normalizeStart(input);
    const id = randomUUID();
    db.prepare('INSERT INTO sessions(id, status, created_at, facts_json) VALUES (?, ?, ?, ?)')
      .run(id, 'recording', facts.createdAt, JSON.stringify(facts));
    return get(id);
  }

  function get(id) {
    requireId(id);
    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
    if (!row) return null;
    const base = {id, schemaVersion: SCHEMA_VERSION, status: row.status, createdAt: row.created_at,
      completedAt: row.completed_at, durationMs: row.duration_ms, deletionPending: Boolean(row.deletion_pending)};
    try {
      const facts = normalizeStart(JSON.parse(row.facts_json));
      const dataQuality = JSON.parse(row.quality_json);
      if (!Array.isArray(dataQuality)) throw new Error('Invalid quality flags');
      const transcriptRow = db.prepare('SELECT * FROM transcripts WHERE session_id = ?').get(id);
      let transcript = null;
      if (transcriptRow) {
        const segments = JSON.parse(transcriptRow.segments_json);
        if (!Array.isArray(segments)) throw new Error('Invalid segments');
        transcript = {id: `${id}-transcript`, source: 'local-asr', revision: 1,
          text: transcriptRow.text, segments};
      }
      if (row.status === 'completed' && !transcript) throw new Error('Missing transcript');
      return {...facts, ...base, dataQuality, transcript, artifact: artifact(id)};
    } catch {
      return {...base, status: 'corrupt', dataQuality: [], transcript: null, artifact: null};
    }
  }

  function artifact(id) {
    const row = db.prepare('SELECT * FROM artifacts WHERE session_id = ?').get(id);
    return row ? {id: `${id}-audio`, sessionId: id, kind: 'audio', state: row.state,
      relativePath: row.relative_path, byteLength: row.byte_length, sha256: row.sha256,
      mediaType: 'audio/wav', sampleRateHz: 16000, channels: 1} : null;
  }

  function list({limit = 100, offset = 0} = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000 || !Number.isInteger(offset) || offset < 0) {
      throw sessionError('INVALID_SESSION', 'Invalid history page');
    }
    return db.prepare(`SELECT id, status, created_at AS createdAt, completed_at AS completedAt,
      duration_ms AS durationMs, deletion_pending AS deletionPending FROM sessions
      ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).all(limit, offset)
      .map(row => ({...row, status: get(row.id).status, deletionPending: Boolean(row.deletionPending)}));
  }

  function beginFinalization(id) {
    transaction(() => {
      const record = get(id);
      if (!record) throw sessionError('SESSION_NOT_FOUND', 'Training session no longer exists');
      if (record.deletionPending || !['recording', 'incomplete'].includes(record.status)) {
        throw sessionError('SESSION_BUSY', 'Training session cannot be finalized');
      }
      db.prepare("UPDATE sessions SET status = 'finalizing' WHERE id = ?").run(id);
      db.prepare(`INSERT INTO artifacts(session_id, state, relative_path) VALUES (?, 'staging', ?)
        ON CONFLICT(session_id) DO UPDATE SET state = 'staging', byte_length = NULL, sha256 = NULL`)
        .run(id, `audio/${id}.wav`);
    });
  }

  function complete(id, facts, audio) {
    transaction(() => {
      const row = get(id);
      if (!row || row.status !== 'finalizing' || row.deletionPending) {
        throw sessionError('SESSION_BUSY', 'Training session cannot be finalized');
      }
      db.prepare('INSERT INTO transcripts(session_id, text, segments_json) VALUES (?, ?, ?)')
        .run(id, facts.transcript.text, JSON.stringify(facts.transcript.segments));
      db.prepare("UPDATE artifacts SET state = 'available', byte_length = ?, sha256 = ? WHERE session_id = ?")
        .run(audio.byteLength, audio.sha256, id);
      db.prepare(`UPDATE sessions SET status = 'completed', completed_at = ?, duration_ms = ?, quality_json = ?
        WHERE id = ?`).run(facts.completedAt, facts.durationMs, JSON.stringify(facts.dataQuality), id);
    });
  }

  return {
    create, get, list, artifact, beginFinalization, complete,
    allArtifacts: () => db.prepare('SELECT session_id FROM artifacts').all().map(row => artifact(row.session_id)),
    markIncomplete: id => db.prepare("UPDATE sessions SET status = 'incomplete' WHERE id = ? AND status = 'finalizing'").run(id),
    recover: () => db.exec("UPDATE sessions SET status = 'incomplete' WHERE status IN ('recording', 'finalizing')"),
    setArtifactState: (id, state) => db.prepare('UPDATE artifacts SET state = ? WHERE session_id = ?').run(state, id),
    markDeleting: id => db.prepare("UPDATE sessions SET deletion_pending = 1, status = 'incomplete' WHERE id = ?").run(id),
    remove: id => db.prepare('DELETE FROM sessions WHERE id = ?').run(id),
    close() { if (!closed) { db.close(); closed = true; } }
  };
}

module.exports = {openTrainingSessionRepository, SCHEMA_VERSION};
