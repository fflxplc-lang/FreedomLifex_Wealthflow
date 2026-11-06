import { Router } from 'express';
import multer from 'multer';
import { db, getSetting, setSetting, audit, notify, tx, LEVEL_NAMES } from '../db.js';
import { requireAdmin, scopeUser, teamOf } from '../auth.js';
import { recalculate, chainFor, leadByError } from '../services/payout.js';
import { invoiceTax } from '../services/tax.js';
import { linkFolio } from '../services/mapping.js';
import { parseTable, cell } from '../parsers/registrar.js';
import { parseJSON, shiftPeriod, editDistance, norm, clean, upper, periodLabel, round2 } from '../util.js';
import { LIVE, latestPeriod } from './dashboard.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

// Year / month filter → SQL fragment on b.period.
function periodFilter(q) {
  const y = q.year && q.year !== 'all' ? String(q.year) : null;
  const m = q.month && q.month !== 'all' ? String(q.month).padStart(2, '0') : null;
  if (y && m) return { sql: 'b.period = ?', args: [`${y}-${m}`], label: `${y}-${m}` };
  if (y) return { sql: "b.period LIKE ?", args: [`${y}-%`], label: `Full Year ${y}` };
  if (m) return { sql: "b.period LIKE ?", args: [`%-${m}`], label: `Month ${m}` };
  return { sql: '1 = 1', args: [], label: 'All periods' };
}

// Whose numbers: admins may look at anyone via ?userId, others only at themselves.
const targetUser = (req) => (req.user.role === 'admin' ? (req.query.userId ? Number(req.query.userId) : req.user.id) : scopeUser(req));

r.get('/summary', (req, res) => {
  const pf = periodFilter(req.query);
  const uid = scopeUser(req);
  const mine = uid ? 'AND b.id IN (SELECT brokerage_id FROM payout_lines WHERE user_id = ?)' : '';
  const a = (...x) => (uid ? [...x, uid] : x);
  const totals = db.prepare(`SELECT COALESCE(SUM(b.amount),0) gross, COUNT(*) c FROM brokerage b ${LIVE} WHERE ${pf.sql} ${mine}`).get(...a(...pf.args));
  const myNet = db.prepare(`SELECT COALESCE(SUM(l.amount),0) s FROM payout_lines l JOIN brokerage b ON b.id = l.brokerage_id ${LIVE} WHERE ${pf.sql} AND l.user_id = ?`).get(...pf.args, req.user.id).s;
  const months = db.prepare(`SELECT b.period, COUNT(*) volume, SUM(b.amount) gross FROM brokerage b ${LIVE} WHERE ${pf.sql} ${mine} GROUP BY b.period ORDER BY b.period DESC`).all(...a(...pf.args));
  // Payout pool = everything credited to people (the company's part is excluded).
  const poolOf = db.prepare(`SELECT COALESCE(SUM(l.amount),0) s FROM payout_lines l JOIN brokerage b ON b.id = l.brokerage_id ${LIVE} WHERE l.period = ? AND l.user_id IS NOT NULL ${mine}`);
  for (const m of months) m.pool = poolOf.get(...a(m.period)).s;
  res.json({ gross: totals.gross, myNet, transactions: totals.c, months });
});

const taxFor = (_user, base) => invoiceTax(base);

r.get('/monthly', (req, res) => {
  const pf = periodFilter(req.query);
  const uid = targetUser(req);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
  const rows = db.prepare(`SELECT l.period, COUNT(DISTINCT l.brokerage_id) txs, SUM(l.amount) share FROM payout_lines l
    JOIN brokerage b ON b.id = l.brokerage_id ${LIVE} WHERE ${pf.sql} AND l.user_id = ? GROUP BY l.period ORDER BY l.period DESC`).all(...pf.args, uid)
    .map((x) => {
      const s = db.prepare('SELECT status FROM settlements WHERE user_id = ? AND period = ?').get(uid, x.period);
      return { ...x, ...taxFor(user, x.share), status: s?.status || null };
    });
  res.json({ invoice: { ...getSetting('invoice'), gstPct: invoiceTax(0).gstPct }, rows, user: { id: user?.id, name: user?.name, gst: user?.gst } });
});

r.put('/invoice-settings', requireAdmin, (req, res) => {
  const cur = getSetting('invoice');
  setSetting('invoice', { ...cur, ...req.body });
  audit(req.user, 'INVOICE_SETTINGS', `Invoice taxes: GST ${req.body.gstEnabled ?? cur.gstEnabled ? `${req.body.gstPct ?? cur.gstPct ?? 18}%` : 'off'}, TDS ${req.body.tdsEnabled ?? cur.tdsEnabled ? `${req.body.tdsPct ?? cur.tdsPct}%` : 'off'}`);
  res.json(getSetting('invoice'));
});

// Submit a month for settlement approval (goes to the admin Approvals Queue).
r.post('/settlements', (req, res) => {
  const uid = targetUser({ ...req, query: req.body });
  const period = req.body.period;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
  const base = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM payout_lines WHERE user_id = ? AND period = ?').get(uid, period).s;
  if (!base) throw new Error('Nothing to settle for this period');
  const t = taxFor(user, base);
  db.prepare(`INSERT INTO settlements(user_id, period, base, gst, tds, net, status) VALUES(?, ?, ?, ?, ?, ?, 'pending')
    ON CONFLICT(user_id, period) DO UPDATE SET base = excluded.base, gst = excluded.gst, tds = excluded.tds, net = excluded.net, status = 'pending', decided_at = NULL`)
    .run(uid, period, base, t.gst, t.tds, t.net);
  const pending = db.prepare("SELECT COUNT(*) c FROM settlements WHERE status = 'pending'").get().c;
  notify('Pending Approvals', `${pending} invoice(s) waiting for settlement approval.`);
  audit(req.user, 'SETTLEMENT_SUBMIT', `${user.name} submitted ${period} for approval (₹${t.net})`);
  res.json({ ok: true });
});

r.get('/invoice', (req, res) => {
  const uid = targetUser(req);
  const period = req.query.period;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
  const base = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM payout_lines WHERE user_id = ? AND period = ?').get(uid, period).s;
  const t = taxFor(user, base);
  const firm = getSetting('firm');
  const addr = parseJSON(user.address, {});
  const bank = parseJSON(user.bank, {});
  const sameState = (addr.state || '').toLowerCase() === (firm.state || '').toLowerCase();
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const inr = (n) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><title>Invoice ${esc(user.name)} ${period}</title>
<style>body{font-family:Inter,Arial,sans-serif;color:#0f172a;max-width:800px;margin:32px auto;padding:0 24px}
h1{font-size:22px;margin:0}table{width:100%;border-collapse:collapse;margin-top:16px}td,th{border:1px solid #cbd5e1;padding:8px;text-align:left;font-size:13px}
th{background:#f1f5f9}.r{text-align:right}.grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:20px;font-size:13px}
.muted{color:#64748b}.sig{margin-top:48px;text-align:right}@media print{button{display:none}}</style></head><body>
<button onclick="print()" style="float:right;padding:8px 16px">Print / Save PDF</button>
<h1>TAX INVOICE</h1><div class="muted">Commission for ${periodLabel(period)} · Invoice WF-${uid}-${period.replace('-', '')}</div>
<div class="grid"><div><b>From</b><br>${esc(user.name)}<br>${esc(addr.street || '')}<br>${esc([addr.city, addr.state, addr.pincode].filter(Boolean).join(', '))}<br>
${user.gst ? `GSTIN: ${esc(user.gst)}<br>` : ''}${user.pan ? `PAN: ${esc(user.pan)}<br>` : ''}${user.code ? `ARN / Code: ${esc(user.code)}` : ''}</div>
<div><b>To</b><br>${esc(firm.name)}<br>${esc(firm.address1)}<br>${esc(firm.address2)}<br>GSTIN: ${esc(firm.gstin)}<br>State code: ${esc(firm.stateCode)}</div></div>
<table><tr><th>Description</th><th>HSN/SAC</th><th class="r">Amount</th></tr>
<tr><td>Mutual fund distribution commission — ${periodLabel(period)}</td><td>${esc(firm.hsn)}</td><td class="r">${inr(base)}</td></tr>
${t.gst ? (sameState
    ? `<tr><td colspan="2">CGST ${t.gstPct / 2}%</td><td class="r">${inr(t.gst / 2)}</td></tr><tr><td colspan="2">SGST ${t.gstPct / 2}%</td><td class="r">${inr(t.gst / 2)}</td></tr>`
    : `<tr><td colspan="2">IGST ${t.gstPct}%</td><td class="r">${inr(t.gst)}</td></tr>`) : ''}
${t.tds ? `<tr><td colspan="2">Less TDS</td><td class="r">−${inr(t.tds)}</td></tr>` : ''}
<tr><th colspan="2">Net payable</th><th class="r">${inr(t.net)}</th></tr></table>
<div class="grid"><div><b>Bank details</b><br>${esc(bank.holder || user.name)}<br>${esc(bank.bankName || '')} ${esc(bank.branch || '')}<br>A/c ${esc(bank.account || '')}<br>IFSC ${esc(bank.ifsc || '')}</div></div>
<div class="sig">${user.signature ? `<img src="${esc(user.signature)}" style="max-height:60px"><br>` : ''}Authorised Signatory</div></body></html>`);
});

r.get('/client-wise', (req, res) => {
  const pf = periodFilter(req.query);
  const uid = scopeUser(req);
  const me = req.user.id;
  const latest = latestPeriod();
  const mine = uid ? 'AND b.id IN (SELECT brokerage_id FROM payout_lines WHERE user_id = ?)' : '';
  const rows = db.prepare(`
    SELECT COALESCE(c.name, MAX(b.investor), 'unknown') name, COALESCE(c.pan, MAX(b.pan)) pan, c.id client_id,
      COUNT(*) txs, SUM(b.amount) gross,
      (SELECT SUM(b2.aum) FROM brokerage b2 WHERE b2.client_id = c.id AND b2.period = ?) aum,
      (SELECT COALESCE(SUM(l.amount),0) FROM payout_lines l JOIN brokerage b3 ON b3.id = l.brokerage_id
         WHERE l.user_id = ? AND b3.client_id = c.id) myShare
    FROM brokerage b ${LIVE} LEFT JOIN clients c ON c.id = b.client_id
    WHERE ${pf.sql} ${mine} GROUP BY COALESCE(c.id, 'f' || b.folio) ORDER BY gross DESC`).all(latest, me, ...pf.args, ...(uid ? [uid] : []));
  res.json({ rows, aumPeriod: latest });
});

r.get('/logs', (req, res) => {
  const pf = periodFilter(req.query);
  const uid = targetUser(req);
  const admin = req.user.role === 'admin' && !req.query.userId;
  const page = Math.max(1, Number(req.query.page) || 1);
  const rows = db.prepare(`
    SELECT b.id, b.trxn_date date, b.period, COALESCE(c.name, b.investor) investor, b.scheme, b.amount gross,
      l.pct myRate, COALESCE(l.amount, 0) myShare
    FROM brokerage b ${LIVE} LEFT JOIN clients c ON c.id = b.client_id
    LEFT JOIN payout_lines l ON l.brokerage_id = b.id AND l.user_id = ?
    WHERE ${pf.sql} ${admin ? '' : 'AND l.id IS NOT NULL'}
    ORDER BY b.trxn_date DESC, b.id DESC LIMIT 200 OFFSET ?`).all(uid, ...pf.args, (page - 1) * 200);
  res.json({ rows, page });
});

r.get('/team', (req, res) => {
  const pf = periodFilter(req.query);
  const uid = scopeUser(req);
  // A mentor looking at their own view sees themselves plus each direct report.
  const ids = uid && uid === req.user.id && req.user.role === 'mentor' ? [uid, ...teamOf(req.user).map((u) => u.id)] : uid ? [uid] : null;
  const rows = db.prepare(`
    SELECT u.id, u.name, u.code, u.level, u.role,
      COALESCE((SELECT SUM(b.amount) FROM brokerage b ${LIVE} WHERE ${pf.sql}
        AND b.id IN (SELECT brokerage_id FROM payout_lines WHERE user_id = u.id)), 0) gross,
      COALESCE((SELECT SUM(l.amount) FROM payout_lines l JOIN brokerage b ON b.id = l.brokerage_id ${LIVE}
        WHERE ${pf.sql} AND l.user_id = u.id), 0) earnings
    FROM users u WHERE u.active = 1 ${ids ? `AND u.id IN (${ids.map(() => '?').join(',')})` : ''} ORDER BY u.level DESC, earnings DESC`).all(...pf.args, ...pf.args, ...(ids || []))
    .map((u) => ({ ...u, level_name: u.role === 'admin' ? 'ADMIN' : LEVEL_NAMES[u.level], pctOfGross: u.gross ? (u.earnings / u.gross) * 100 : 0, status: 'CALCULATED' }));
  res.json({ rows, label: pf.label });
});

// ---------- Growth ----------
function periodsFor(mode, end, custom) {
  if (mode === 'qoq') return { cur: [shiftPeriod(end, -2), end], prev: [shiftPeriod(end, -5), shiftPeriod(end, -3)] };
  if (mode === 'yoy') return { cur: [shiftPeriod(end, -11), end], prev: [shiftPeriod(end, -23), shiftPeriod(end, -12)] };
  if (mode === 'custom' && custom.curFrom) return { cur: [custom.curFrom, custom.curTo || custom.curFrom], prev: [custom.prevFrom, custom.prevTo || custom.prevFrom] };
  return { cur: [end, end], prev: [shiftPeriod(end, -1), shiftPeriod(end, -1)] };
}

r.get('/growth', (req, res) => {
  const mode = req.query.mode || 'mom';
  const end = req.query.year && req.query.month && req.query.month !== 'all'
    ? `${req.query.year}-${String(req.query.month).padStart(2, '0')}` : latestPeriod();
  const { cur, prev } = periodsFor(mode, end, req.query);
  const has = db.prepare(`SELECT COUNT(*) c FROM brokerage b ${LIVE} WHERE b.period BETWEEN ? AND ?`).get(...cur).c > 0;
  const uid = scopeUser(req);

  const stats = (range, userId) => {
    const scope = userId ? 'AND b.id IN (SELECT brokerage_id FROM payout_lines WHERE user_id = ?)' : '';
    const a = userId ? [...range, userId] : range;
    const avg = db.prepare(`SELECT COALESCE(SUM(b.aum),0) s FROM brokerage b ${LIVE} WHERE b.period BETWEEN ? AND ? ${scope}`).get(...a).s;
    // Snapshot: latest AUM per folio at or before the period end.
    const snap = db.prepare(`SELECT COALESCE(SUM(x.aum),0) s FROM (
        SELECT b.folio, b.aum, ROW_NUMBER() OVER (PARTITION BY b.folio ORDER BY b.period DESC, b.id DESC) rn
        FROM brokerage b ${LIVE} WHERE b.period <= ? ${scope}) x WHERE x.rn = 1`).get(...(userId ? [range[1], userId] : [range[1]])).s;
    const share = userId
      ? db.prepare(`SELECT COALESCE(SUM(l.amount),0) s FROM payout_lines l WHERE l.period BETWEEN ? AND ? AND l.user_id = ?`).get(...range, userId).s
      : db.prepare(`SELECT COALESCE(SUM(l.amount),0) s FROM payout_lines l WHERE l.period BETWEEN ? AND ? AND l.user_id IS NOT NULL`).get(...range).s;
    return { avgAum: avg, snapAum: snap, share };
  };

  const members = db.prepare(`SELECT id, name, code, level FROM users WHERE active = 1 ${uid ? 'AND id = ?' : ''} ORDER BY name`).all(...(uid ? [uid] : []))
    .map((u) => ({ ...u, prev: stats(prev, u.id), cur: stats(cur, u.id) }));
  res.json({ mode, cur, prev, hasData: has, totals: { prev: stats(prev, uid), cur: stats(cur, uid) }, members });
});

// ---------- Approvals ----------
r.get('/approvals', requireAdmin, (req, res) => {
  const status = req.query.status || 'pending';
  res.json(db.prepare(`SELECT s.*, u.name, u.level FROM settlements s JOIN users u ON u.id = s.user_id
    WHERE s.status = ? ORDER BY s.period DESC`).all(status).map((s) => ({ ...s, level_name: LEVEL_NAMES[s.level] })));
});

r.post('/approvals/:id/:decision', requireAdmin, (req, res) => {
  const status = req.params.decision === 'approve' ? 'approved' : 'rejected';
  const s = db.prepare('SELECT s.*, u.name FROM settlements s JOIN users u ON u.id = s.user_id WHERE s.id = ?').get(req.params.id);
  if (!s) throw new Error('Settlement not found');
  db.prepare("UPDATE settlements SET status = ?, decided_at = datetime('now') WHERE id = ?").run(status, s.id);
  audit(req.user, `SETTLEMENT_${status.toUpperCase()}`, `${s.name} ${s.period}: ₹${s.net} ${status}`);
  res.json({ ok: true });
});

// ---------- Reconciliation ----------
r.get('/reconciliation', requireAdmin, (req, res) => {
  const pf = periodFilter(req.query);
  const unmapped = db.prepare(`SELECT COALESCE(NULLIF(MAX(b.investor),''),'unknown') investor, MAX(b.pan) pan, b.folio, COUNT(*) txns, SUM(b.amount) gross
    FROM brokerage b ${LIVE} WHERE b.client_id IS NULL AND ${pf.sql} GROUP BY b.folio ORDER BY gross DESC`).all(...pf.args);
  // Clients with brokerage but no person assigned are also "house" money.
  const house = db.prepare(`SELECT c.name investor, c.pan, GROUP_CONCAT(DISTINCT b.folio) folio, COUNT(*) txns, SUM(b.amount) gross
    FROM brokerage b ${LIVE} JOIN clients c ON c.id = b.client_id
    WHERE ${pf.sql} AND (c.hierarchy IS NULL OR c.hierarchy = '{}') GROUP BY c.id ORDER BY gross DESC`).all(...pf.args);
  const rows = [...unmapped, ...house];
  res.json({ accounts: rows.length, txns: rows.reduce((s, x) => s + x.txns, 0), gross: rows.reduce((s, x) => s + x.gross, 0), rows });
});

r.get('/reconciliation/export', requireAdmin, (req, res) => {
  const pf = periodFilter(req.query);
  const rows = db.prepare(`SELECT b.period, COALESCE(u.name, 'COMPANY / HOUSE') person, u.code, COUNT(DISTINCT b.id) txns, SUM(l.amount) net
    FROM payout_lines l JOIN brokerage b ON b.id = l.brokerage_id ${LIVE} LEFT JOIN users u ON u.id = l.user_id
    WHERE ${pf.sql} GROUP BY b.period, l.user_id ORDER BY b.period DESC, net DESC`).all(...pf.args);
  const gross = db.prepare(`SELECT b.period, SUM(b.amount) gross FROM brokerage b ${LIVE} WHERE ${pf.sql} GROUP BY b.period`).all(...pf.args);
  res.json({ rows, gross });
});

// Exceptions: what the import could not map. Read-only.
r.get('/exceptions', requireAdmin, (req, res) => {
  const p = req.query.period || '';
  const pf = p ? { sql: 'b.period = ?', args: [p] } : { sql: '1 = 1', args: [] };
  const noOne = db.prepare(`SELECT b.folio, MAX(b.investor) investor, SUM(b.amount) gross FROM brokerage b ${LIVE}
    WHERE ${pf.sql} AND b.client_id IS NULL GROUP BY b.folio ORDER BY gross DESC`).all(...pf.args);
  const noRM = db.prepare(`SELECT c.id, c.name, SUM(b.amount) gross FROM clients c JOIN brokerage b ON b.client_id = c.id ${LIVE}
    WHERE ${pf.sql} AND (c.hierarchy IS NULL OR c.hierarchy = '{}') GROUP BY c.id ORDER BY gross DESC`).all(...pf.args);
  const shared = db.prepare(`SELECT f.folio, GROUP_CONCAT(c.name, ' | ') clients, COUNT(*) n FROM folios f JOIN clients c ON c.id = f.client_id
    GROUP BY f.folio HAVING COUNT(*) > 1`).all();
  // Rows whose investor name does not resemble the client they landed on.
  const mismatched = db.prepare(`SELECT b.folio, b.investor, c.name client, COUNT(*) n FROM brokerage b ${LIVE} JOIN clients c ON c.id = b.client_id
    WHERE ${pf.sql} AND b.investor <> '' GROUP BY b.folio, b.investor, c.id`).all(...pf.args)
    .filter((x) => {
      const a = norm(x.investor), b = norm(x.client);
      return a && b && !a.includes(b) && !b.includes(a) && editDistance(a, b) > Math.max(3, Math.min(a.length, b.length) * 0.3);
    });
  res.json({ noOne, noRM, shared, mismatched });
});

// Bulk client mapping: Client ID / Client Name, PAN, RM Name, BM Name.
function matchUser(text, users) {
  const t = clean(text);
  if (!t) return { user: null };
  const byCode = users.filter((u) => u.code && norm(u.code) === norm(t));
  if (byCode.length === 1) return { user: byCode[0] };
  const exact = users.filter((u) => norm(u.name) === norm(t));
  if (exact.length === 1) return { user: exact[0] };
  if (exact.length > 1) return { error: `"${t}" matches ${exact.length} people; use the ARN code` };
  const close = users.map((u) => ({ u, d: editDistance(u.name, t) })).filter((x) => x.d <= Math.max(2, Math.floor(norm(t).length * 0.15))).sort((a, b) => a.d - b.d);
  if (close.length === 1 || (close.length > 1 && close[0].d < close[1].d)) return { user: close[0].u, corrected: true };
  if (close.length > 1) return { error: `"${t}" is ambiguous; use the ARN code` };
  return { error: `No team member called "${t}"` };
}

r.post('/bulk-mapping/preview', requireAdmin, upload.single('file'), (req, res) => {
  const t = parseTable(req.file.buffer, req.file.originalname);
  const users = db.prepare('SELECT id, name, code, level, parent_id FROM users WHERE active = 1').all();
  const rmMax = Number(getSetting('rmMaxLevel'));
  const changes = [];
  for (const row of t.data) {
    const cid = Number(cell(row, t.cols, 'clientId')) || null;
    const pan = upper(cell(row, t.cols, 'pan'));
    const name = clean(cell(row, t.cols, 'investor'));
    const client = (cid && db.prepare('SELECT * FROM clients WHERE id = ?').get(cid))
      || (pan && db.prepare('SELECT * FROM clients WHERE pan = ?').get(pan))
      || (name && db.prepare('SELECT * FROM clients WHERE upper(name) = ?').get(upper(name)));
    const rm = matchUser(cell(row, t.cols, 'rm'), users);
    const bm = matchUser(cell(row, t.cols, 'bm'), users);
    const lbRaw = 'leadBy' in t.cols ? clean(cell(row, t.cols, 'leadBy')) : null;
    const lb = lbRaw ? matchUser(lbRaw, users) : { user: null };
    // A blank Lead By cell keeps whatever is saved; a saved lead source can't be changed.
    const leadBy = lb.user?.id ?? client?.lead_by ?? null;
    const cur = client ? parseJSON(client.hierarchy, {}) : {};
    const next = rm.user ? chainFor(rm.user.id) : { ...cur };
    if (bm.user) {
      for (let l = rmMax + 1; l <= 7; l++) if (next[l] && l !== bm.user.level) delete next[l];
      next[bm.user.level > rmMax ? bm.user.level : rmMax + 1] = bm.user.id;
    }
    const lbError = client && !lb.error ? leadByError(client, leadBy, next) : null;
    const errors = [!client && `Client not found (${cid || pan || name || 'blank row'})`, rm.error, bm.error, lb.error, lbError && `Lead By: ${lbError}`].filter(Boolean);
    changes.push({
      clientId: client?.id, client: client?.name || name, pan: client?.pan || pan,
      rm: rm.user?.name, rmCorrected: rm.corrected, bm: bm.user?.name, bmCorrected: bm.corrected,
      leadBy, leadByName: lb.user?.name,
      changed: client && (JSON.stringify(cur) !== JSON.stringify(next) || (client.lead_by ?? null) !== leadBy), hierarchy: next, errors,
    });
  }
  res.json({ rows: changes, ok: changes.filter((c) => !c.errors.length && c.changed).length, errors: changes.filter((c) => c.errors.length).length });
});

r.post('/bulk-mapping/apply', requireAdmin, (req, res) => {
  const rows = (req.body.rows || []).filter((x) => x.clientId && !x.errors?.length && x.changed);
  tx(() => { for (const x of rows) db.prepare('UPDATE clients SET hierarchy = ?, lead_by = ? WHERE id = ?').run(JSON.stringify(x.hierarchy), x.leadBy ?? null, x.clientId); });
  const calc = recalculate({ clientIds: rows.map((x) => x.clientId) });
  audit(req.user, 'CLIENT_MAPPING_UPDATE', `Bulk mapping applied to ${rows.length} client(s)`);
  res.json({ applied: rows.length, recalculated: calc.recalculated });
});

r.get('/bulk-mapping/current', requireAdmin, (_req, res) => {
  const users = new Map(db.prepare('SELECT id, name, code FROM users').all().map((u) => [u.id, u]));
  const rmMax = Number(getSetting('rmMaxLevel'));
  res.json(db.prepare('SELECT id, name, pan, hierarchy, lead_by FROM clients ORDER BY name').all().map((c) => {
    const h = parseJSON(c.hierarchy, {});
    const lv = Object.keys(h).map(Number).sort((a, b) => a - b);
    const rm = lv.find((l) => l <= rmMax), bm = lv.find((l) => l > rmMax);
    return { 'Client ID': c.id, 'Client Name': c.name, PAN: c.pan || '', 'RM Name': rm ? users.get(Number(h[rm]))?.name || '' : '', 'BM Name': bm ? users.get(Number(h[bm]))?.name || '' : '', 'Lead By': c.lead_by ? users.get(c.lead_by)?.name || '' : '' };
  }));
});

// RM-wise / investor-wise brokerage file from the registrar: every folio in it goes to that RM.
r.post('/rm-file', requireAdmin, upload.single('file'), (req, res) => {
  const rmId = Number(req.body.rmId);
  const rm = db.prepare('SELECT * FROM users WHERE id = ?').get(rmId);
  if (!rm) throw new Error('Select an RM first');
  const t = parseTable(req.file.buffer, req.file.originalname);
  if (!('folio' in t.cols)) throw new Error('The file has no Folio column');
  const chain = chainFor(rmId);
  const clientIds = new Set();
  let created = 0;
  tx(() => {
    for (const row of t.data) {
      const folio = clean(cell(row, t.cols, 'folio'));
      if (!folio) continue;
      let cid = db.prepare('SELECT client_id FROM folios WHERE folio = ?').get(folio)?.client_id;
      if (!cid) {
        const pan = upper(cell(row, t.cols, 'pan'));
        const name = clean(cell(row, t.cols, 'investor')) || db.prepare('SELECT investor FROM brokerage WHERE folio = ? LIMIT 1').get(folio)?.investor;
        cid = (pan && db.prepare('SELECT id FROM clients WHERE pan = ?').get(pan)?.id) || null;
        if (!cid && name) { cid = Number(db.prepare('INSERT INTO clients(name, pan) VALUES(?, ?)').run(name, pan || null).lastInsertRowid); created++; }
        if (cid) { linkFolio(folio, cid); db.prepare('UPDATE brokerage SET client_id = ? WHERE folio = ? AND client_id IS NULL').run(cid, folio); }
      }
      if (cid) { db.prepare('UPDATE clients SET hierarchy = ? WHERE id = ?').run(JSON.stringify(chain), cid); clientIds.add(cid); }
    }
  });
  const calc = recalculate({ clientIds: [...clientIds] });
  audit(req.user, 'RM_FILE_MAP', `${req.file.originalname}: ${clientIds.size} client(s) mapped to ${rm.name}`);
  res.json({ clients: clientIds.size, created, recalculated: calc.recalculated });
});

export default r;
