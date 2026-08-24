const http = require('http');
const db = require('./db');

const DEFAULT_TIMEOUT = 5000;

const listStmt = db.prepare('SELECT * FROM forward_targets ORDER BY id');
const getStmt = db.prepare('SELECT * FROM forward_targets WHERE id = ?');
const insertStmt = db.prepare(`
  INSERT INTO forward_targets (enabled, host, port, path, timeout_ms, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const updateStmt = db.prepare(`
  UPDATE forward_targets SET enabled = ?, host = ?, port = ?, path = ?, timeout_ms = ?
  WHERE id = ?
`);
const deleteStmt = db.prepare('DELETE FROM forward_targets WHERE id = ?');

// Result of each target's most recent forward attempt, kept in memory so the
// dashboard can show whether it's actually reachable. Keyed by target id.
const lastResults = new Map();

// Throws Error with a user-facing message when the submitted values are unusable.
function validate(input) {
  const enabled = input.enabled === undefined ? true : (input.enabled === true || input.enabled === '1');
  const host = typeof input.host === 'string' ? input.host.trim() : '';
  const port = Number(input.port);
  const timeout = input.timeout_ms === undefined ? DEFAULT_TIMEOUT : Number(input.timeout_ms);
  let path = typeof input.path === 'string' ? input.path.trim() : '';

  if (!host) throw new Error('Host is required');
  if (/^https?:\/\//i.test(host)) throw new Error('Enter the host or IP only, without http://');
  if (/[/\s]/.test(host)) throw new Error('Host must not contain slashes or spaces');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be between 1 and 65535');
  if (!Number.isInteger(timeout) || timeout < 100 || timeout > 60000) {
    throw new Error('Timeout must be between 100 and 60000 ms');
  }

  if (!path) path = '/';
  if (!path.startsWith('/')) path = `/${path}`;

  return { enabled, host, port, path, timeout_ms: timeout };
}

function rowToTarget(row) {
  return {
    id: row.id,
    enabled: !!row.enabled,
    host: row.host,
    port: row.port,
    path: row.path,
    timeout_ms: row.timeout_ms,
    lastResult: lastResults.get(row.id) || null,
  };
}

function listTargets() {
  return listStmt.all().map(rowToTarget);
}

function createTarget(input) {
  const config = validate(input);
  const info = insertStmt.run(
    config.enabled ? 1 : 0,
    config.host,
    config.port,
    config.path,
    config.timeout_ms,
    new Date().toISOString(),
  );
  return rowToTarget(getStmt.get(Number(info.lastInsertRowid)));
}

function updateTarget(id, input) {
  const existing = getStmt.get(id);
  if (!existing) throw new Error('Target not found');
  const config = validate(input);
  updateStmt.run(config.enabled ? 1 : 0, config.host, config.port, config.path, config.timeout_ms, id);
  return rowToTarget(getStmt.get(id));
}

function deleteTarget(id) {
  const info = deleteStmt.run(id);
  lastResults.delete(id);
  return info.changes > 0;
}

function record(id, result) {
  const entry = { ...result, at: new Date().toISOString() };
  lastResults.set(id, entry);
  if (!entry.ok) {
    console.warn(`forward to target ${id} failed: ${entry.error || `HTTP ${entry.status}`}`);
  }
  return entry;
}

function send(target, body, contentType) {
  return new Promise((resolve) => {
    const payload = Buffer.from(body || '', 'utf8');
    const url = `http://${target.host}:${target.port}${target.path}`;

    const req = http.request(
      {
        host: target.host,
        port: target.port,
        path: target.path,
        method: 'POST',
        timeout: target.timeout_ms,
        headers: {
          'Content-Type': contentType || 'application/json',
          'Content-Length': payload.length,
        },
      },
      (res) => {
        res.resume(); // drain the response so the socket is released
        res.on('end', () => resolve(record(target.id, { ok: res.statusCode < 400, status: res.statusCode, target: url })));
      },
    );

    req.on('timeout', () => req.destroy(new Error(`timed out after ${target.timeout_ms} ms`)));
    req.on('error', (err) => resolve(record(target.id, { ok: false, error: err.message, target: url })));
    req.end(payload);
  });
}

// Fire-and-forget to every enabled target: the logger has already been
// acknowledged by the time this runs, so an unreachable target is recorded
// but never propagated back, and one slow target never blocks the others.
function forwardCapture(rawBody, contentType) {
  for (const row of listStmt.all()) {
    if (!row.enabled) continue;
    send(row, rawBody, contentType).catch((err) => record(row.id, { ok: false, error: err.message }));
  }
}

// Used by the dashboard's "Test" button. Sends regardless of the target's
// enabled flag, so a target can be checked before switching it on.
function testTarget(id) {
  const row = getStmt.get(id);
  if (!row) return Promise.resolve(null);
  const body = JSON.stringify({ test: true, source: 'json-post-capture', sent_at: new Date().toISOString() });
  return send(row, body, 'application/json');
}

module.exports = { listTargets, createTarget, updateTarget, deleteTarget, forwardCapture, testTarget };
