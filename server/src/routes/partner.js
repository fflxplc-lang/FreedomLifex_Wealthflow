// Partner (broking) revenue such as Motilal Oswal (MOFSL) — kept separate from MF trail.
import { Router } from 'express';
import multer from 'multer';
import { db, audit, tx, getSetting, setSetting } from '../db.js';
import { requireAdmin, scopeUser } from '../auth.js';
import { parsePartner } from '../parsers/registrar.js';
import { parseJSON, upper } from '../util.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

function sharingFor(partner) {
  const all = getSetting('partnerSharing') || {};
  return all[partner] || { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 };
}

// The client's mapping when a statement row arrives; later mapping changes don't touch it.
function snapshotOf(clientId) {
  const h = clientId ? parseJSON(db.prepare('SELECT hierarchy FROM clients WHERE id = ?').get(clientId)?.hierarchy, {}) : {};
  return Object.keys(h).length ? JSON.stringify(h) : null;
}

// Payout per person from the "mentor" (our) share, using level percentages.
function payoutRows(rows, partner) {
  const share = sharingFor(partner);
  const clients = new Map(db.prepare('SELECT id, hierarchy FROM clients').all().map((c) => [c.id, parseJSON(c.hierarchy, {})]));
  const per = new Map();
  for (const x of rows) {
    if (!x.client_id) continue;
    const h = parseJSON(x.map_snapshot, null) || clients.get(x.client_id) || {};
    for (const [lvl, uid] of Object.entries(h)) {
      const pct = Number(share[lvl] || 0);
      if (!pct || !uid) continue;
      per.set(Number(uid), (per.get(Number(uid)) || 0) + x.mentor * pct / 100);
    }
  }
  return per;
}

r.post('/upload', requireAdmin, upload.single('file'), (req, res) => {
  const partner = upper(req.body.partner || 'MOFSL');
  const period = req.body.period;
  if (!/^\d{4}-\d{2}$/.test(period || '')) throw new Error('Pick the statement month');
  const rows = parsePartner(req.file.buffer, req.file.originalname);
  const total = rows.reduce((s, x) => s + x.total, 0);
  const batchId = tx(() => {
    const id = Number(db.prepare(`INSERT INTO batches(file_name, kind, source, variant, period, rows, raw_rows, total, raw_total, created_by)
      VALUES(?, 'partner', ?, 'STATEMENT', ?, ?, ?, ?, ?, ?)`).run(req.file.originalname, partner, period, rows.length, rows.length, total, total, req.user.id).lastInsertRowid);
    const ins = db.prepare(`INSERT INTO partner_rows(batch_id, partner, period, code, client_name, segment, total, mentor, partner_share, client_id, map_snapshot) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const x of rows) {
      const cid = db.prepare('SELECT client_id FROM partner_codes WHERE partner = ? AND code = ?').get(partner, x.code)?.client_id ?? null;
      ins.run(id, partner, period, x.code, x.client_name, x.segment, x.total, x.mentor, x.partner_share, cid, snapshotOf(cid));
    }
    return id;
  });
  audit(req.user, 'PARTNER_IMPORT', `${partner} ${period}: ${rows.length} row(s), ₹${total.toFixed(2)} imported`);
  res.json({ batchId, rows: rows.length, total });
});

const live = "JOIN batches t ON t.id = p.batch_id AND t.status = 'live'";

r.get('/', (req, res) => {
  const partner = upper(req.query.partner || 'MOFSL');
  const month = req.query.month || '';
  const uid = scopeUser(req);
  const where = `p.partner = ? AND (? = '' OR p.period = ?)`;
  const args = [partner, month, month];
  const rows = db.prepare(`SELECT p.* FROM partner_rows p ${live} WHERE ${where}`).all(...args);
  const per = payoutRows(rows, partner);
  const users = new Map(db.prepare('SELECT id, name, code, level FROM users').all().map((u) => [u.id, u]));
  const payouts = [...per.entries()].map(([id, amount]) => ({ ...users.get(id), amount })).filter((x) => !uid || x.id === uid).sort((a, b) => b.amount - a.amount);
  const sum = (k) => rows.reduce((s, x) => s + (x[k] || 0), 0);
  const months = db.prepare(`SELECT p.period, COUNT(*) rows, COUNT(DISTINCT p.code) codes, SUM(p.total) total, SUM(p.mentor) mentor, SUM(p.partner_share) partner_share,
      COUNT(DISTINCT CASE WHEN p.client_id IS NULL THEN p.code END) unmapped
    FROM partner_rows p ${live} WHERE p.partner = ? GROUP BY p.period ORDER BY p.period DESC`).all(partner);
  const segments = db.prepare(`SELECT p.segment, COUNT(*) rows, SUM(p.total) total, SUM(p.mentor) ours FROM partner_rows p ${live}
    WHERE ${where} GROUP BY p.segment ORDER BY total DESC`).all(...args);
  const unmapped = db.prepare(`SELECT p.code, MAX(p.client_name) client_name, COUNT(*) rows, SUM(p.total) total, SUM(p.mentor) mentor
    FROM partner_rows p ${live} WHERE p.partner = ? AND p.client_id IS NULL GROUP BY p.code ORDER BY total DESC`).all(partner);
  const byClient = db.prepare(`SELECT p.code, COALESCE(c.name, MAX(p.client_name)) name, c.id client_id, SUM(p.total) total, SUM(p.mentor) mentor
    FROM partner_rows p ${live} LEFT JOIN clients c ON c.id = p.client_id WHERE ${where} GROUP BY p.code ORDER BY total DESC LIMIT 500`).all(...args);
  res.json({
    partner, kpis: { total: sum('total'), mentor: sum('mentor'), partner: sum('partner_share'), payout: payouts.reduce((s, x) => s + x.amount, 0) },
    sharing: sharingFor(partner), months, segments, unmapped, byClient, payouts,
    partners: db.prepare('SELECT DISTINCT partner FROM partner_rows').all().map((x) => x.partner),
  });
});

r.put('/sharing', requireAdmin, (req, res) => {
  const partner = upper(req.body.partner || 'MOFSL');
  const all = getSetting('partnerSharing') || {};
  all[partner] = req.body.sharing;
  setSetting('partnerSharing', all);
  audit(req.user, 'PARTNER_SHARING', `${partner} sharing updated: ${Object.entries(req.body.sharing).map(([l, p]) => `L${l} ${p}%`).join(', ')}`);
  res.json({ ok: true });
});

r.post('/map', requireAdmin, (req, res) => {
  const partner = upper(req.body.partner || 'MOFSL');
  const { code, clientId } = req.body;
  db.prepare('INSERT INTO partner_codes(partner, code, client_id) VALUES(?, ?, ?) ON CONFLICT(partner, code) DO UPDATE SET client_id = excluded.client_id')
    .run(partner, upper(code), Number(clientId));
  const n = db.prepare('UPDATE partner_rows SET client_id = ?, map_snapshot = ? WHERE partner = ? AND code = ?').run(Number(clientId), snapshotOf(Number(clientId)), partner, upper(code)).changes;
  audit(req.user, 'PARTNER_MAP', `${partner}: 1 client code(s) mapped, ${n} row(s) re-attributed`);
  res.json({ ok: true, rows: n });
});

export default r;
