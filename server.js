const express = require('express');
const path = require('path');
const db = require('./db');
const forward = require('./forward');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const API_KEY = process.env.CAPTURE_API_KEY || null;

app.use(express.static(path.join(__dirname, 'public')));

// Data loggers are inconsistent about Content-Type, so capture the raw
// body as text and parse it ourselves rather than relying on express.json().
app.use(express.text({ type: '*/*', limit: '5mb' }));

function checkApiKey(req, res, next) {
  if (!API_KEY) return next();
  const key = req.header('x-api-key') || req.query.apikey;
  if (key === API_KEY) return next();
  return res.status(401).json({ error: 'unauthorized' });
}

function extractStation(parsed, paramStation) {
  if (paramStation) return paramStation;
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    for (const key of ['station', 'station_name', 'station_id', 'logger', 'site', 'name']) {
      if (typeof parsed[key] === 'string') return parsed[key];
    }
  }
  return null;
}

const insertStmt = db.prepare(`
  INSERT INTO captures (received_at, source_ip, station, content_type, headers, raw_body, is_valid_json)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

app.post(['/api/capture', '/api/capture/:station'], checkApiKey, (req, res) => {
  const rawBody = typeof req.body === 'string' ? req.body : '';
  let parsed = null;
  let isValid = 0;
  try {
    parsed = JSON.parse(rawBody);
    isValid = 1;
  } catch (e) {
    // Not valid JSON — still store the raw text so nothing is lost.
  }

  const station = extractStation(parsed, req.params.station);
  const receivedAt = new Date().toISOString();
  const sourceIp = req.ip;
  const contentType = req.header('content-type') || '';
  const headers = JSON.stringify(req.headers);

  const info = insertStmt.run(receivedAt, sourceIp, station, contentType, headers, rawBody, isValid);

  // Acknowledge the logger first — forwarding happens after the response so a
  // slow or unreachable target can never stall or fail the capture.
  res.status(200).json({ status: 'ok', id: Number(info.lastInsertRowid) });

  forward.forwardCapture(rawBody, contentType);
});

app.get('/api/captures', checkApiKey, (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const total = db.prepare('SELECT COUNT(*) AS count FROM captures').get().count;
  const totalPages = Math.max(Math.ceil(total / limit), 1);
  const currentPage = Math.min(page, totalPages);
  const offset = (currentPage - 1) * limit;
  const rows = db.prepare(`
    SELECT id, received_at, source_ip, station, content_type, raw_body, is_valid_json
    FROM captures ORDER BY id DESC LIMIT ? OFFSET ?
  `).all(limit, offset);

  const result = rows.map((r) => ({
    id: r.id,
    received_at: r.received_at,
    source_ip: r.source_ip,
    station: r.station,
    content_type: r.content_type,
    is_valid_json: !!r.is_valid_json,
    size: r.raw_body ? r.raw_body.length : 0,
    preview: r.raw_body ? r.raw_body.slice(0, 200) : '',
  }));

  res.json({ items: result, page: currentPage, limit, total, totalPages });
});

app.get('/api/captures/:id', checkApiKey, (req, res) => {
  const row = db.prepare('SELECT * FROM captures WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json({
    ...row,
    is_valid_json: !!row.is_valid_json,
    headers: row.headers ? JSON.parse(row.headers) : {},
  });
});

app.delete('/api/captures/:id', checkApiKey, (req, res) => {
  const info = db.prepare('DELETE FROM captures WHERE id = ?').run(req.params.id);
  res.json({ deleted: Number(info.changes) });
});

function parseJsonBody(req, res) {
  try {
    // express.text() handles every content type, so parse the body ourselves.
    return JSON.parse(typeof req.body === 'string' ? req.body : '{}');
  } catch (e) {
    res.status(400).json({ error: 'body must be JSON' });
    return null;
  }
}

app.get('/api/forward/targets', checkApiKey, (req, res) => {
  res.json({ targets: forward.listTargets() });
});

app.post('/api/forward/targets', checkApiKey, (req, res) => {
  const input = parseJsonBody(req, res);
  if (input === null) return;
  try {
    res.status(201).json({ target: forward.createTarget(input) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/forward/targets/:id', checkApiKey, (req, res) => {
  const input = parseJsonBody(req, res);
  if (input === null) return;
  try {
    res.json({ target: forward.updateTarget(Number(req.params.id), input) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/forward/targets/:id', checkApiKey, (req, res) => {
  const deleted = forward.deleteTarget(Number(req.params.id));
  if (!deleted) return res.status(404).json({ error: 'not found' });
  res.json({ deleted: true });
});

app.post('/api/forward/targets/:id/test', checkApiKey, async (req, res) => {
  const result = await forward.testTarget(Number(req.params.id));
  if (!result) return res.status(404).json({ error: 'not found' });
  res.json({ result });
});

app.listen(PORT, HOST, () => {
  console.log(`json-post-capture listening on http://${HOST}:${PORT}`);
  console.log(`Dashboard:      http://localhost:${PORT}`);
  console.log(`Capture URL:    http://<this-machine-ip>:${PORT}/api/capture`);
});
