// SQLite persistence using Node's built-in driver (no native build step needed).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'wealthflow.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,           -- not unique: a BM and their RM ID share one
  code TEXT,
  gst TEXT,
  pan TEXT,
  parent_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  sharing_pct REAL DEFAULT 0,
  role TEXT DEFAULT 'ops',          -- admin | ops | partner
  level INTEGER DEFAULT 1,          -- primary level 1..7
  extra_levels TEXT DEFAULT '[]',   -- JSON array of extra levels
  custom_split TEXT,                -- JSON {level: pct} overrides global split
  password_hash TEXT NOT NULL,
  bank TEXT DEFAULT '{}',
  address TEXT DEFAULT '{}',
  arn TEXT, arn_valid TEXT, euin TEXT, euin_valid TEXT,
  signature TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  pan TEXT,
  email TEXT,
  mobile TEXT,
  hierarchy TEXT DEFAULT '{}',      -- JSON {"1": userId, "2": userId, ...}
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_clients_pan ON clients(pan);
CREATE TABLE IF NOT EXISTS folios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  folio TEXT NOT NULL,
  client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  UNIQUE(folio, client_id)
);
CREATE INDEX IF NOT EXISTS idx_folios_folio ON folios(folio);
CREATE TABLE IF NOT EXISTS folio_master (
  folio TEXT PRIMARY KEY,
  investor TEXT, pan TEXT, email TEXT, mobile TEXT, amc TEXT,
  source TEXT, batch_id INTEGER
);
CREATE TABLE IF NOT EXISTS batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_name TEXT NOT NULL,
  kind TEXT NOT NULL,               -- transactions | folio | brokerage
  source TEXT NOT NULL,             -- CAMS | KARVY
  variant TEXT,                     -- WBR2 / MFSD201 / WBR9 / MFSD211 / NORMAL / SIF
  period TEXT,                      -- YYYY-MM settlement month
  rows INTEGER DEFAULT 0,
  raw_rows INTEGER DEFAULT 0,
  total REAL DEFAULT 0,
  raw_total REAL DEFAULT 0,
  status TEXT DEFAULT 'live',       -- live | deleted
  deleted_at TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER REFERENCES batches(id) ON DELETE CASCADE,
  folio TEXT, investor TEXT, pan TEXT, amc TEXT, scheme TEXT,
  trxn_date TEXT, trxn_type TEXT, amount REAL, units REAL, nav REAL,
  client_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tx_folio ON transactions(folio);
CREATE TABLE IF NOT EXISTS brokerage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER REFERENCES batches(id) ON DELETE CASCADE,
  period TEXT,
  folio TEXT, investor TEXT, pan TEXT, amc TEXT, scheme TEXT, category TEXT,
  trxn_date TEXT, trxn_type TEXT, amount REAL DEFAULT 0, aum REAL DEFAULT 0,
  client_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_brk_period ON brokerage(period);
CREATE INDEX IF NOT EXISTS idx_brk_folio ON brokerage(folio);
CREATE INDEX IF NOT EXISTS idx_brk_client ON brokerage(client_id);
CREATE TABLE IF NOT EXISTS payout_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brokerage_id INTEGER REFERENCES brokerage(id) ON DELETE CASCADE,
  period TEXT,
  user_id INTEGER,                  -- NULL = company
  level INTEGER,
  pct REAL,
  amount REAL
);
CREATE INDEX IF NOT EXISTS idx_pl_user ON payout_lines(user_id, period);
CREATE INDEX IF NOT EXISTS idx_pl_brk ON payout_lines(brokerage_id);
CREATE TABLE IF NOT EXISTS rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  amc TEXT, scheme TEXT NOT NULL, period TEXT, rate REAL, source TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
-- Scheme code -> name, learned from transaction and folio files, so CAMS brokerage rows
-- (which only carry a scheme code) can show the scheme name.
CREATE TABLE IF NOT EXISTS scheme_codes (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS name_map (
  kind TEXT NOT NULL,               -- amc | scheme
  original TEXT NOT NULL,
  standard TEXT NOT NULL,
  PRIMARY KEY (kind, original)
);
CREATE TABLE IF NOT EXISTS partner_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER,
  partner TEXT, period TEXT, code TEXT, client_name TEXT, segment TEXT,
  total REAL, mentor REAL, partner_share REAL,
  client_id INTEGER
);
CREATE TABLE IF NOT EXISTS partner_codes (
  partner TEXT, code TEXT, client_id INTEGER, PRIMARY KEY (partner, code)
);
CREATE TABLE IF NOT EXISTS settlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, period TEXT, base REAL, gst REAL, tds REAL, net REAL,
  status TEXT DEFAULT 'pending',    -- pending | approved | rejected
  created_at TEXT DEFAULT (datetime('now')),
  decided_at TEXT,
  UNIQUE(user_id, period)
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, period TEXT, amount REAL, paid_on TEXT, reference TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS month_locks (period TEXT PRIMARY KEY, locked_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT DEFAULT (datetime('now')),
  user_id INTEGER, user_name TEXT, action TEXT, description TEXT
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT DEFAULT (datetime('now')),
  title TEXT, body TEXT, read INTEGER DEFAULT 0
);
`);

// A database used with the short-lived "brokerage from rates" version: put the registrar's
// brokerage amounts back (run Recalculate afterwards to rebuild payouts).
if (db.prepare('PRAGMA table_info(brokerage)').all().some((c) => c.name === 'reg_amount')) {
  db.exec('UPDATE brokerage SET amount = reg_amount WHERE reg_amount IS NOT NULL AND amount <> reg_amount');
}

// clients.lead_by (added later): the L4+ who brought the lead when a subordinate handles the client.
// One email can now hold several accounts (a BM and their RM ID). SQLite can't drop a UNIQUE
// constraint, so older databases rebuild the users table once. RM IDs made earlier as name+rm@ move
// to their BM's email.
{
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get()?.sql || '';
  if (/email\s+TEXT\s+UNIQUE/i.test(sql)) {
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN');
    try {
      db.exec(sql.replace(/CREATE TABLE (IF NOT EXISTS )?"?users"?/i, 'CREATE TABLE users_new').replace(/email(\s+)TEXT\s+UNIQUE/i, 'email$1TEXT'));
      db.exec('INSERT INTO users_new SELECT * FROM users; DROP TABLE users; ALTER TABLE users_new RENAME TO users;');
      db.exec(`UPDATE users SET email = (SELECT p.email FROM users p WHERE p.id = users.parent_id)
        WHERE email LIKE '%+rm@%' AND level <= 3
          AND (SELECT lower(p.email) FROM users p WHERE p.id = users.parent_id) = lower(replace(users.email, '+rm@', '@'))`);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; } finally { db.exec('PRAGMA foreign_keys = ON'); }
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)');
}
if (!db.prepare('PRAGMA table_info(clients)').all().some((c) => c.name === 'lead_by')) db.exec('ALTER TABLE clients ADD COLUMN lead_by INTEGER');
// brokerage/partner_rows.map_snapshot (added later): the client mapping a row was first split with,
// so mapping changes only affect brokerage that arrives afterwards.
for (const t of ['brokerage', 'partner_rows']) {
  if (!db.prepare(`PRAGMA table_info(${t})`).all().some((c) => c.name === 'map_snapshot')) db.exec(`ALTER TABLE ${t} ADD COLUMN map_snapshot TEXT`);
}

export const LEVEL_NAMES = {
  1: 'Ninja', 2: 'Super Ninja', 3: 'Sherpa', 4: 'Master Sherpa',
  5: 'Monks', 6: 'Zen Monks', 7: 'Company',
};

export const DEFAULT_SETTINGS = {
  rmMaxLevel: 3,
  // Lead policy: top share for L5-L7; own-lead % for L1-L3 (rest of the pool to their L4+
  // manager); leadFee: what an L4+ keeps when they pass their lead to a subordinate.
  sharing: { top: { 5: 5, 6: 5, 7: 5 }, rates: { 1: 25, 2: 50, 3: 75 }, leadFee: 25 },
  firm: {
    name: 'NEXTFREEDOM LIFEX PRIVATE LIMITED', state: 'Maharashtra', gstin: '27AAICN8490L1ZO',
    pan: '', stateCode: '27', address1: 'Flat No B-404, Valencia Building, Bhakti Park',
    address2: 'Wadala East, Antop Hill, Mumbai - 400037', hsn: '997152', tds: 2, gst: 18,
  },
  invoice: { gstEnabled: false, gstPct: 18, tdsEnabled: true, tdsPct: 2 },
  partnerSharing: { MOFSL: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 } },
};

export function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : structuredClone(DEFAULT_SETTINGS[key]);
}
export function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}

export function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function audit(user, action, description) {
  db.prepare('INSERT INTO audit(user_id, user_name, action, description) VALUES(?, ?, ?, ?)')
    .run(user?.id ?? null, user?.name ?? 'System', action, description);
}
export function notify(title, body) {
  db.prepare('INSERT INTO notifications(title, body) VALUES(?, ?)').run(title, body);
}

// First boot: create the root admin so the login page works.
const adminCount = db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'admin'").get().c;
if (!adminCount) {
  const email = process.env.ADMIN_EMAIL || 'admin@wealthflow.com';
  const pass = process.env.ADMIN_PASSWORD || 'Admin@123';
  db.prepare(`INSERT INTO users(name, email, code, role, level, password_hash)
              VALUES('System Administrator', ?, 'ADMIN-001', 'admin', 6, ?)`)
    .run(email, bcrypt.hashSync(pass, 10));
  console.log(`Created admin account ${email} / ${pass}`);
}
