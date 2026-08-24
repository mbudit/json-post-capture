const http = require('http');
const db = require('./db');

const DEFAULTS = {
  enabled: false,
  host: '',
  port: 80,
  path: '/',
  timeout_ms: 5000,
};

const selectStmt = db.prepare('SELECT key, value FROM settings');
const upsertStmt = db.prepare(`
  INSERT INTO settings (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`);

// Result of the most recent forward attempt, kept in memory so the dashboard
// can show whether the target is actually reachable.
let lastResult = null;

function getConfig() {
  const stored = {};
  for (const row of selectStmt.all()) {
    if (row.key.startsWith('forward.')) stored[row.key.slice('forward.'.length)] = row.value;
  }

  return {
    enabled: stored.enabled === '1',
    host: stored.host || DEFAULTS.host,
    port: Number(stored.port) || DEFAULTS.port,
    path: stored.path || DEFAULTS.path,
    timeout_ms: Number(stored.timeout_ms) || DEFAULTS.timeout_ms,
  };
}

// Throws Error with a user-facing message when the submitted values are unusable.
function validate(input) {
  const enabled = input.enabled === true || input.enabled === '1';
  const host = typeof input.host === 'string' ? input.host.trim() : '';
  const port = Number(input.port);
  const timeout = Number(input.timeout_ms);
  let path = typeof input.path === 'string' ? input.path.trim() : '';

  if (enabled && !host) throw new Error('Host is required when forwarding is enabled');
  if (/^https?:\/\//i.test(host)) throw new Error('Enter the host or IP only, without http://');
  if (host && /[/\s]/.test(host)) throw new Error('Host must not contain slashes or spaces');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be between 1 and 65535');
  if (!Number.isInteger(timeout) || timeout < 100 || timeout > 60000) {
    throw new Error('Timeout must be between 100 and 60000 ms');
  }

  if (!path) path = '/';
  if (!path.startsWith('/')) path = `/${path}`;

  return { enabled, host, port, path, timeout_ms: timeout };
}

function saveConfig(input) {
  const config = validate(input);
  upsertStmt.run('forward.enabled', config.enabled ? '1' : '0');
  upsertStmt.run('forward.host', config.host);
  upsertStmt.run('forward.port', String(config.port));
  upsertStmt.run('forward.path', config.path);
  upsertStmt.run('forward.timeout_ms', String(config.timeout_ms));
  return config;
}

function record(result) {
  lastResult = { ...result, at: new Date().toISOString() };
  if (!lastResult.ok) {
    console.warn(`forward failed: ${lastResult.error || `HTTP ${lastResult.status}`}`);
  }
  return lastResult;
}

function send(config, body, contentType) {
  return new Promise((resolve) => {
    const payload = Buffer.from(body || '', 'utf8');
    const target = `http://${config.host}:${config.port}${config.path}`;

    const req = http.request(
      {
        host: config.host,
        port: config.port,
        path: config.path,
        method: 'POST',
        timeout: config.timeout_ms,
        headers: {
          'Content-Type': contentType || 'application/json',
          'Content-Length': payload.length,
        },
      },
      (res) => {
        res.resume(); // drain the response so the socket is released
        res.on('end', () => resolve(record({ ok: res.statusCode < 400, status: res.statusCode, target })));
      },
    );

    req.on('timeout', () => req.destroy(new Error(`timed out after ${config.timeout_ms} ms`)));
    req.on('error', (err) => resolve(record({ ok: false, error: err.message, target })));
    req.end(payload);
  });
}

// Fire-and-forget: the logger has already been acknowledged by the time this
// runs, so an unreachable target is recorded but never propagated back.
function forwardCapture(rawBody, contentType) {
  const config = getConfig();
  if (!config.enabled || !config.host) return;
  send(config, rawBody, contentType).catch((err) => record({ ok: false, error: err.message }));
}

// Used by the dashboard's "Send test POST" button. Awaits the result and
// forwards regardless of the enabled flag, so a target can be checked first.
function sendTest() {
  const config = getConfig();
  if (!config.host) return Promise.resolve(record({ ok: false, error: 'No host configured' }));
  const body = JSON.stringify({ test: true, source: 'json-post-capture', sent_at: new Date().toISOString() });
  return send(config, body, 'application/json');
}

module.exports = { getConfig, saveConfig, forwardCapture, sendTest, getLastResult: () => lastResult };
