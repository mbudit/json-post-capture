const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'captures.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS captures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    received_at TEXT NOT NULL,
    source_ip TEXT,
    station TEXT,
    content_type TEXT,
    headers TEXT,
    raw_body TEXT,
    is_valid_json INTEGER NOT NULL
  )
`);

// Forwarding targets editable from the dashboard, so they can be added,
// changed, or removed without restarting the container.
db.exec(`
  CREATE TABLE IF NOT EXISTS forward_targets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    enabled INTEGER NOT NULL DEFAULT 1,
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    path TEXT NOT NULL DEFAULT '/',
    timeout_ms INTEGER NOT NULL DEFAULT 5000,
    created_at TEXT NOT NULL
  )
`);

module.exports = db;
