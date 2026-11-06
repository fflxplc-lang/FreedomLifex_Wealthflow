import { Router } from 'express';
import { db } from '../db.js';
import { scopeUser } from '../auth.js';
import { shiftPeriod, isRedemption } from '../util.js';

const r = Router();
export const LIVE = "JOIN batches t ON t.id = b.batch_id AND t.status = 'live'";

export function latestPeriod() {
  return db.prepare(`SELECT MAX(b.period) p FROM brokerage b ${LIVE}`).get().p
    || new Date().toISOString().slice(0, 7);
}

function rangeFor(scope) {
  const end = latestPeriod();
  if (scope === 'month') return [end, end];
  if (scope === 'quarter') return [shiftPeriod(end, -2), end];
  if (scope === 'year') return [shiftPeriod(end, -11), end];
  return ['0000-00', '9999-99'];
}

r.get('/', (req, res) => {
  const uid = scopeUser(req);
  const [from, to] = rangeFor(req.query.range);
  const inRange = 'b.period BETWEEN ? AND ?';

  // Restrict a non-admin to brokerage on clients where they earn something.
  const mine = uid ? 'AND b.id IN (SELECT brokerage_id FROM payout_lines WHERE user_id = ?)' : '';
  const p = (...a) => (uid ? [...a, uid] : a);

  const gross = db.prepare(`SELECT COALESCE(SUM(b.amount),0) s, COUNT(*) c FROM brokerage b ${LIVE} WHERE ${inRange} ${mine}`).get(...p(from, to));
  const pool = uid
    ? db.prepare(`SELECT COALESCE(SUM(l.amount),0) s FROM payout_lines l JOIN brokerage b ON b.id = l.brokerage_id ${LIVE} WHERE ${inRange} AND l.user_id = ?`).get(from, to, uid)
    : db.prepare(`SELECT COALESCE(SUM(l.amount),0) s FROM payout_lines l JOIN brokerage b ON b.id = l.brokerage_id ${LIVE} WHERE ${inRange} AND l.user_id IS NOT NULL`).get(from, to);
  const clients = uid
    ? db.prepare(`SELECT COUNT(DISTINCT b.client_id) c FROM brokerage b ${LIVE} WHERE b.id IN (SELECT brokerage_id FROM payout_lines WHERE user_id = ?)`).get(uid).c
    : db.prepare('SELECT COUNT(*) c FROM clients').get().c;
  const txCount = db.prepare(`SELECT COUNT(*) c FROM transactions x JOIN batches t ON t.id = x.batch_id AND t.status='live'`).get().c + gross.c;

  // Compliance: ARN / EUIN missing or expiring within 30 days.
  const soon = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const compliance = [];
  for (const u of db.prepare('SELECT id, name, code, arn, arn_valid, euin, euin_valid FROM users WHERE active = 1 ORDER BY name').all()) {
    if (uid && u.id !== uid) continue;
    for (const [k, v, d] of [['ARN', u.arn, u.arn_valid], ['EUIN', u.euin, u.euin_valid]]) {
      if (!v) compliance.push({ userId: u.id, name: u.name, code: u.code, kind: k, status: 'MISSING' });
      else if (d && d <= soon) compliance.push({ userId: u.id, name: u.name, code: u.code, kind: k, status: d < new Date().toISOString().slice(0, 10) ? 'EXPIRED' : 'EXPIRING', date: d });
    }
  }

  const latest = latestPeriod();
  const topBy = req.query.top === 'brokerage' ? 'brokerage' : 'aum';
  const topClients = db.prepare(`
    SELECT c.id, c.name, c.pan,
      COALESCE(SUM(CASE WHEN b.period = ? THEN b.aum END),0) aum,
      COALESCE(SUM(b.amount),0) brokerage, COUNT(b.id) txns
    FROM clients c JOIN brokerage b ON b.client_id = c.id ${LIVE}
    WHERE ${inRange} ${mine}
    GROUP BY c.id ORDER BY ${topBy} DESC LIMIT 10`).all(...p(latest, from, to));

  // Recent redemptions in the last 60 days of imported transactions.
  const lastTx = db.prepare(`SELECT MAX(trxn_date) d FROM transactions`).get().d;
  let redemptions = [];
  if (lastTx) {
    const since = new Date(new Date(lastTx).getTime() - 60 * 864e5).toISOString().slice(0, 10);
    const own = uid ? `AND x.client_id IN (SELECT DISTINCT b.client_id FROM brokerage b JOIN payout_lines l ON l.brokerage_id = b.id WHERE l.user_id = ?)` : '';
    redemptions = db.prepare(`SELECT x.investor, x.scheme, x.trxn_date, x.trxn_type, x.amount FROM transactions x
      JOIN batches t ON t.id = x.batch_id AND t.status='live' WHERE x.trxn_date >= ? ${own} ORDER BY x.trxn_date DESC LIMIT 400`).all(...(uid ? [since, uid] : [since]))
      .filter((x) => isRedemption(x.trxn_type)).slice(0, 25);
  }

  const months = [];
  for (let i = 5; i >= 0; i--) months.push(shiftPeriod(latest, -i));
  const revenue = months.map((m) => {
    const g = db.prepare(`SELECT COALESCE(SUM(b.amount),0) s FROM brokerage b ${LIVE} WHERE b.period = ? ${mine}`).get(...p(m)).s;
    const share = db.prepare(`SELECT COALESCE(SUM(l.amount),0) s FROM payout_lines l WHERE l.period = ? AND ${uid ? 'l.user_id = ?' : 'l.user_id IS NOT NULL'}`).get(...(uid ? [m, uid] : [m])).s;
    return { period: m, gross: g, share };
  });

  const top = (col) => db.prepare(`SELECT ${col} name, SUM(b.amount) v FROM brokerage b ${LIVE} WHERE ${inRange} ${mine} AND ${col} <> '' GROUP BY ${col} ORDER BY v DESC LIMIT 1`).get(...p(from, to));
  const producers = { amc: top('b.amc'), investor: top('b.investor'), scheme: top('b.scheme') };

  const categories = db.prepare(`SELECT COALESCE(b.category,'Other') name, SUM(b.amount) value FROM brokerage b ${LIVE} WHERE ${inRange} ${mine} GROUP BY 1 ORDER BY value DESC`).all(...p(from, to));

  const leaderboard = db.prepare(`
    SELECT u.id, u.name, u.level, SUM(l.amount) earnings, COUNT(DISTINCT l.brokerage_id) txns
    FROM payout_lines l JOIN users u ON u.id = l.user_id
    JOIN brokerage b ON b.id = l.brokerage_id ${LIVE}
    WHERE ${inRange} GROUP BY u.id ORDER BY earnings DESC LIMIT 5`).all(from, to);

  res.json({
    range: { from, to, latest },
    kpis: { gross: gross.s, pool: pool.s, clients, transactions: txCount },
    compliance, topClients, redemptions, revenue, producers, categories, leaderboard,
  });
});

// Notifications are operational (imports, approvals), so only admins get them.
r.get('/notifications', (req, res) => {
  if (req.user.role !== 'admin') return res.json([]);
  res.json(db.prepare('SELECT * FROM notifications ORDER BY id DESC LIMIT 30').all());
});
r.post('/notifications/read', (req, res) => {
  if (req.user.role !== 'admin') return res.json({ ok: true });
  db.prepare('UPDATE notifications SET read = 1').run();
  res.json({ ok: true });
});

// Global search across clients, users and folios.
r.get('/search', (req, res) => {
  const q = `%${String(req.query.q || '').trim()}%`;
  if (q === '%%') return res.json([]);
  const uid = scopeUser(req);
  // Non-admins only find clients they are mapped on.
  const own = uid ? 'AND c.id IN (SELECT c2.id FROM clients c2, json_each(c2.hierarchy) j WHERE j.value = ?)' : '';
  const o = uid ? [uid] : [];
  const clients = db.prepare(`SELECT c.id, c.name, c.pan FROM clients c WHERE (c.name LIKE ? OR c.pan LIKE ?) ${own} LIMIT 8`).all(q, q, ...o)
    .map((c) => ({ type: 'client', id: c.id, label: c.name, sub: c.pan }));
  const users = uid ? [] : db.prepare('SELECT id, name, email FROM users WHERE name LIKE ? OR email LIKE ? OR code LIKE ? LIMIT 5').all(q, q, q)
    .map((u) => ({ type: 'user', id: u.id, label: u.name, sub: u.email }));
  const folios = db.prepare(`SELECT f.folio, c.name, c.id FROM folios f JOIN clients c ON c.id = f.client_id WHERE f.folio LIKE ? ${own} LIMIT 5`).all(q, ...o)
    .map((f) => ({ type: 'client', id: f.id, label: f.name, sub: `Folio ${f.folio}` }));
  res.json([...clients, ...folios, ...users]);
});

export default r;
