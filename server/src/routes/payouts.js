// Payout ledger: what each person earned, what was paid, and what is still owed.
import { Router } from 'express';
import multer from 'multer';
import { db, audit, getSetting, tx } from '../db.js';
import { requireAdmin, scopeUser } from '../auth.js';
import { invoiceTax } from '../services/tax.js';
import { parseTable, cell } from '../parsers/registrar.js';
import { parseJSON, round2, clean, norm, num, toISODate } from '../util.js';
import { LIVE, latestPeriod } from './dashboard.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function partnerEarnings(period, cmp) {
  // Partner (MOFSL etc.) payouts per user for a period comparison ('=' or '<').
  const all = getSetting('partnerSharing') || {};
  const clients = new Map(db.prepare('SELECT id, hierarchy FROM clients').all().map((c) => [c.id, parseJSON(c.hierarchy, {})]));
  const per = new Map();
  const rows = db.prepare(`SELECT p.partner, p.mentor, p.client_id, p.map_snapshot FROM partner_rows p JOIN batches t ON t.id = p.batch_id AND t.status = 'live'
    WHERE p.client_id IS NOT NULL AND p.period ${cmp} ?`).all(period);
  for (const x of rows) {
    const share = all[x.partner] || {};
    for (const [lvl, uid] of Object.entries(parseJSON(x.map_snapshot, null) || clients.get(x.client_id) || {})) {
      const pct = Number(share[lvl] || 0);
      if (pct) per.set(Number(uid), (per.get(Number(uid)) || 0) + x.mentor * pct / 100);
    }
  }
  return per;
}

function ledger(period, product) {
  const users = db.prepare('SELECT id, name, code, level, gst FROM users WHERE active = 1').all();
  const mf = (cmp) => new Map(db.prepare(`SELECT l.user_id, SUM(l.amount) s FROM payout_lines l JOIN brokerage b ON b.id = l.brokerage_id ${LIVE}
    WHERE l.user_id IS NOT NULL AND l.period ${cmp} ? GROUP BY l.user_id`).all(period).map((x) => [x.user_id, x.s]));
  const useMf = product !== 'partner', usePartner = product !== 'mf';
  const earnedNow = useMf ? mf('=') : new Map(), earnedBefore = useMf ? mf('<') : new Map();
  const pNow = usePartner ? partnerEarnings(period, '=') : new Map(), pBefore = usePartner ? partnerEarnings(period, '<') : new Map();
  const paid = (cmp) => new Map(db.prepare(`SELECT user_id, SUM(amount) s FROM payments WHERE period ${cmp} ? GROUP BY user_id`).all(period).map((x) => [x.user_id, x.s]));
  const paidNow = paid('='), paidBefore = paid('<');
  const approved = new Set(db.prepare("SELECT user_id FROM settlements WHERE period = ? AND status = 'approved'").all(period).map((x) => x.user_id));
  const tax = (_u, base) => { const t = invoiceTax(base); return { ...t, payable: t.net }; };
  return users.map((u) => {
    const earned = (earnedNow.get(u.id) || 0) + (pNow.get(u.id) || 0);
    const before = (earnedBefore.get(u.id) || 0) + (pBefore.get(u.id) || 0);
    const t = tax(u, earned);
    const brought = round2(tax(u, before).payable - (paidBefore.get(u.id) || 0));
    const p = paidNow.get(u.id) || 0;
    return {
      id: u.id, name: u.name, code: u.code, level: u.level, broughtFwd: brought, earned: round2(earned),
      gst: round2(t.gst), tds: round2(t.tds), payable: round2(t.payable), paid: round2(p),
      owed: round2(brought + t.payable - p), estimated: !approved.has(u.id),
    };
  }).filter((x) => x.earned || x.broughtFwd || x.paid).sort((a, b) => b.owed - a.owed);
}

r.get('/', (req, res) => {
  const period = req.query.period || latestPeriod();
  const uid = scopeUser(req);
  let rows = ledger(period, req.query.product || 'all');
  if (uid) rows = rows.filter((x) => x.id === uid);
  const sum = (k) => round2(rows.reduce((s, x) => s + x[k], 0));

  // Attribution health — money that may be reaching the wrong person.
  const noRM = db.prepare(`SELECT c.id, c.name, SUM(b.amount) gross FROM clients c JOIN brokerage b ON b.client_id = c.id ${LIVE}
    WHERE b.period = ? AND (c.hierarchy IS NULL OR c.hierarchy = '{}') GROUP BY c.id`).all(period);
  const shared = db.prepare(`SELECT f.folio, GROUP_CONCAT(c.name, ' | ') clients,
      (SELECT COALESCE(SUM(b.amount),0) FROM brokerage b ${LIVE} WHERE b.folio = f.folio AND b.period = ?) gross
    FROM folios f JOIN clients c ON c.id = f.client_id GROUP BY f.folio HAVING COUNT(*) > 1`).all(period);
  const periods = db.prepare(`SELECT DISTINCT b.period FROM brokerage b ${LIVE} UNION SELECT DISTINCT period FROM partner_rows ORDER BY 1 DESC`).all().map((x) => x.period);

  res.json({
    period, periods, rows,
    kpis: { broughtFwd: sum('broughtFwd'), earned: sum('earned'), people: rows.filter((x) => x.earned).length, gst: sum('gst'), payable: sum('payable'), paid: sum('paid'), owed: sum('owed') },
    health: {
      noRM: { count: noRM.length, amount: noRM.reduce((s, x) => s + x.gross, 0), items: noRM },
      shared: { count: shared.length, amount: shared.reduce((s, x) => s + x.gross, 0), items: shared },
    },
  });
});

r.post('/payments', requireAdmin, (req, res) => {
  const { userId, period, amount, paidOn, reference } = req.body;
  if (!userId || !period || !(Number(amount) > 0)) throw new Error('Person, month and a positive amount are required');
  db.prepare('INSERT INTO payments(user_id, period, amount, paid_on, reference) VALUES(?, ?, ?, ?, ?)')
    .run(Number(userId), period, Number(amount), paidOn || new Date().toISOString().slice(0, 10), reference || null);
  const u = db.prepare('SELECT name FROM users WHERE id = ?').get(userId);
  audit(req.user, 'PAYMENT_RECORDED', `₹${Number(amount).toFixed(2)} paid to ${u?.name} for ${period}${reference ? ` (ref ${reference})` : ''}`);
  res.json({ ok: true });
});

r.get('/payments', (req, res) => {
  const uid = scopeUser(req) || (req.query.userId ? Number(req.query.userId) : null);
  res.json(db.prepare(`SELECT p.*, u.name FROM payments p JOIN users u ON u.id = p.user_id ${uid ? 'WHERE p.user_id = ?' : ''} ORDER BY p.id DESC LIMIT 500`).all(...(uid ? [uid] : [])));
});

// Columns: Name or ARN code, Amount, Date, Reference (month comes from the form).
r.post('/payments/import', requireAdmin, upload.single('file'), (req, res) => {
  const period = req.body.period;
  const t = parseTable(req.file.buffer, req.file.originalname);
  const users = db.prepare('SELECT id, name, code FROM users').all();
  const out = { recorded: 0, skipped: [] };
  tx(() => {
    for (const row of t.data) {
      const who = clean(cell(row, t.cols, 'rm') || cell(row, t.cols, 'investor') || cell(row, t.cols, 'code'));
      const amount = num(cell(row, t.cols, 'amount'));
      const u = users.find((x) => norm(x.code) === norm(who) || norm(x.name) === norm(who));
      if (!u || !(amount > 0)) { out.skipped.push(who || '(blank)'); continue; }
      db.prepare('INSERT INTO payments(user_id, period, amount, paid_on, reference) VALUES(?, ?, ?, ?, ?)')
        .run(u.id, period, amount, toISODate(cell(row, t.cols, 'date')) || new Date().toISOString().slice(0, 10), clean(cell(row, t.cols, 'type')) || null);
      out.recorded++;
    }
  });
  audit(req.user, 'PAYMENT_IMPORT', `${out.recorded} payment(s) imported for ${period}`);
  res.json(out);
});

export default r;
