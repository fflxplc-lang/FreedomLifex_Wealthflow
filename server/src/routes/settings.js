import { Router } from 'express';
import { db, getSetting, setSetting, audit, tx, LEVEL_NAMES } from '../db.js';
import { requireAdmin } from '../auth.js';
import { recalculate, normSharing, DEFAULT_SHARING, rebuildHierarchies } from '../services/payout.js';
import { linkFolio } from '../services/mapping.js';
import { parseJSON, norm, editDistance, clean } from '../util.js';
import { LIVE } from './dashboard.js';

const r = Router();

r.get('/global', (_req, res) => {
  res.json({
    sharing: normSharing(getSetting('sharing')), rmMaxLevel: getSetting('rmMaxLevel'),
    firm: getSetting('firm'), invoice: getSetting('invoice'), levels: LEVEL_NAMES,
  });
});

// Checks the lead policy: percentages within 0-100 and nothing larger than the pool.
function cleanSharing(input) {
  const pct = (v, label) => { const n = Number(v); if (!(n >= 0 && n <= 100)) throw new Error(`${label} must be between 0% and 100%`); return n; };
  const pick = (o, levels, label) => Object.fromEntries(levels.filter((l) => o?.[l] !== undefined && o[l] !== '').map((l) => [l, pct(o[l], `${label} L${l}`)]));
  const top = pick(input?.top, [5, 6, 7], 'Top share');
  const rates = { ...DEFAULT_SHARING.rates, ...pick(input?.rates, [1, 2, 3], 'Lead rate') };
  const leadFee = pct(input?.leadFee ?? DEFAULT_SHARING.leadFee, 'Lead fee');
  const pool = 100 - Object.values(top).reduce((a, b) => a + b, 0);
  if (pool < 0) throw new Error('Top share totals more than 100%');
  for (const [l, v] of Object.entries(rates)) if (v > pool) throw new Error(`L${l} rate (${v}%) is more than the ${pool}% left after the top share`);
  if (leadFee > pool) throw new Error(`Lead fee (${leadFee}%) is more than the ${pool}% left after the top share`);
  return { top, rates, leadFee };
}

r.put('/global', requireAdmin, (req, res) => {
  const { sharing, firm, rmMaxLevel } = req.body;
  if (sharing) setSetting('sharing', cleanSharing(sharing));
  if (firm) setSetting('firm', { ...getSetting('firm'), ...firm });
  if (rmMaxLevel !== undefined) setSetting('rmMaxLevel', Math.min(6, Math.max(1, Number(rmMaxLevel))));
  const sh = normSharing(getSetting('sharing'));
  const fmt = (o) => Object.entries(o).map(([l, v]) => `L${l} ${v}%`).join(', ');
  audit(req.user, 'GLOBAL_RULES_UPDATE', `Lead policy saved (top: ${fmt(sh.top)}; lead rates: ${fmt(sh.rates)}; lead fee ${sh.leadFee}%)`);
  const calc = req.body.recalculate ? recalculate() : null;
  res.json({ ok: true, recalculated: calc?.recalculated });
});

// ---------- System / danger zone ----------
r.post('/recalculate', requireAdmin, (req, res) => {
  const out = recalculate();
  audit(req.user, 'RECALCULATE', `Recalculated ${out.recalculated} brokerage row(s); locked months untouched`);
  res.json(out);
});

r.get('/locks', requireAdmin, (_req, res) => {
  const locked = new Set(db.prepare('SELECT period FROM month_locks').all().map((x) => x.period));
  const months = db.prepare(`SELECT b.period, COUNT(*) rows, SUM(b.amount) brokerage FROM brokerage b ${LIVE} GROUP BY b.period ORDER BY b.period DESC`).all()
    .map((m) => ({ ...m, locked: locked.has(m.period) }));
  res.json(months);
});

r.post('/locks', requireAdmin, (req, res) => {
  const upTo = req.body.upTo;
  const months = db.prepare(`SELECT DISTINCT b.period FROM brokerage b ${LIVE} WHERE b.period <= ?`).all(upTo).map((x) => x.period);
  for (const p of months) db.prepare('INSERT OR IGNORE INTO month_locks(period) VALUES(?)').run(p);
  audit(req.user, 'MONTH_LOCK', `Locked every month up to ${upTo} (${months.length})`);
  res.json({ locked: months.length });
});

r.delete('/locks/:period', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM month_locks WHERE period = ?').run(req.params.period);
  audit(req.user, 'MONTH_UNLOCK', `Unlocked ${req.params.period}`);
  res.json({ ok: true });
});

// Folio ownership: folios claimed by more than one client.
function ownership() {
  const claims = db.prepare(`SELECT f.folio, GROUP_CONCAT(c.id) ids FROM folios f JOIN clients c ON c.id = f.client_id GROUP BY f.folio HAVING COUNT(*) > 1`).all();
  const resolved = [], unsure = [];
  for (const cl of claims) {
    const ids = cl.ids.split(',').map(Number);
    const clients = db.prepare(`SELECT id, name FROM clients WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    const names = db.prepare(`SELECT DISTINCT investor FROM brokerage WHERE folio = ? AND investor <> ''
      UNION SELECT DISTINCT investor FROM transactions WHERE folio = ? AND investor <> ''
      UNION SELECT investor FROM folio_master WHERE folio = ? AND investor <> ''`).all(cl.folio, cl.folio, cl.folio).map((x) => x.investor);
    const matches = clients.filter((c) => names.some((n) => norm(n) === norm(c.name) || editDistance(n, c.name) <= 2));
    const item = { folio: cl.folio, claimants: clients.map((c) => c.name), statementNames: names };
    if (matches.length === 1) resolved.push({ ...item, owner: matches[0], drop: clients.filter((c) => c.id !== matches[0].id) });
    else unsure.push({ ...item, reason: matches.length ? 'More than one claimant matches' : 'No claimant matches the statement name' });
  }
  return { resolved, unsure };
}

r.get('/folio-ownership', requireAdmin, (_req, res) => {
  const o = ownership();
  res.json({ resolved: o.resolved.map((x) => ({ folio: x.folio, owner: x.owner.name, removeFrom: x.drop.map((d) => d.name) })), unsure: o.unsure });
});

r.post('/folio-ownership/cleanup', requireAdmin, (req, res) => {
  const o = ownership();
  const touched = new Set();
  tx(() => {
    for (const x of o.resolved) {
      for (const d of x.drop) {
        db.prepare('DELETE FROM folios WHERE folio = ? AND client_id = ?').run(x.folio, d.id);
        db.prepare('UPDATE brokerage SET client_id = ? WHERE folio = ? AND client_id = ?').run(x.owner.id, x.folio, d.id);
        touched.add(d.id);
      }
      touched.add(x.owner.id);
    }
  });
  recalculate({ clientIds: [...touched] });
  audit(req.user, 'FOLIO_OWNERSHIP_CLEANUP', `${o.resolved.length} shared folio(s) cleaned, ${o.unsure.length} left for review`);
  res.json({ cleaned: o.resolved.length, unsure: o.unsure.length });
});

// Assign folios to one RM when one investor sits on two RM records.
r.post('/assign-folios', requireAdmin, (req, res) => {
  const folios = [...new Set(String(req.body.folios || '').split(/[,\n]/).map(clean).filter(Boolean))];
  const userId = Number(req.body.userId);
  const move = req.body.move || 'none'; // none | all | YYYY-MM
  if (!folios.length || !userId) throw new Error('Enter folios and choose who they belong to');
  const done = [], skipped = [];
  const touched = new Set();
  tx(() => {
    for (const folio of folios) {
      const claim = db.prepare('SELECT c.id, c.hierarchy FROM folios f JOIN clients c ON c.id = f.client_id WHERE f.folio = ?').all(folio);
      const target = claim.find((c) => Object.values(parseJSON(c.hierarchy, {})).map(Number).includes(userId));
      if (!target) { skipped.push(folio); continue; }
      for (const c of claim) if (c.id !== target.id) { db.prepare('DELETE FROM folios WHERE folio = ? AND client_id = ?').run(folio, c.id); touched.add(c.id); }
      linkFolio(folio, target.id);
      if (move === 'all') db.prepare('UPDATE brokerage SET client_id = ? WHERE folio = ?').run(target.id, folio);
      else if (/^\d{4}-\d{2}$/.test(move)) db.prepare('UPDATE brokerage SET client_id = ? WHERE folio = ? AND period = ?').run(target.id, folio, move);
      touched.add(target.id);
      done.push(folio);
    }
  });
  recalculate({ clientIds: [...touched] });
  audit(req.user, 'ASSIGN_FOLIOS', `${done.length} folio(s) assigned; ${skipped.length} skipped`);
  res.json({ assigned: done.length, skipped });
});

// Branch restructure: move everyone under A to report to B.
function restructurePlan(fromId, toId) {
  const to = db.prepare('SELECT * FROM users WHERE id = ?').get(toId);
  if (!to || fromId === toId) throw new Error('Choose two different people');
  const reports = db.prepare('SELECT id, name FROM users WHERE parent_id = ? AND id <> ?').all(fromId, toId);
  const clients = db.prepare('SELECT c.id, c.name, c.hierarchy FROM clients c, json_each(c.hierarchy) j WHERE j.value = ?').all(fromId)
    .filter((c) => !parseJSON(c.hierarchy, {})[to.level]);
  return { to, reports, clients };
}

r.post('/branch-restructure', requireAdmin, (req, res) => {
  const fromId = Number(req.body.fromId), toId = Number(req.body.toId);
  const plan = restructurePlan(fromId, toId);
  if (req.body.check) return res.json({ reports: plan.reports.map((x) => x.name), clients: plan.clients.length });
  tx(() => {
    for (const u of plan.reports) db.prepare('UPDATE users SET parent_id = ? WHERE id = ?').run(toId, u.id);
    db.prepare('UPDATE users SET parent_id = ? WHERE id = ? AND id <> ?').run(fromId, toId, fromId);
    for (const c of plan.clients) {
      const h = parseJSON(c.hierarchy, {});
      h[plan.to.level] = toId;
      db.prepare('UPDATE clients SET hierarchy = ? WHERE id = ?').run(JSON.stringify(h), c.id);
    }
  });
  const rebuilt = rebuildHierarchies(plan.reports.map((u) => u.id));
  recalculate({ clientIds: [...new Set([...plan.clients.map((c) => c.id), ...rebuilt])] });
  audit(req.user, 'BRANCH_RESTRUCTURE', `${plan.reports.length} report(s) moved under ${plan.to.name}; ${plan.clients.length} client(s) updated`);
  res.json({ moved: plan.reports.length, clients: plan.clients.length });
});

r.post('/factory-reset', requireAdmin, (req, res) => {
  if (req.body.confirm !== 'RESET') throw new Error('Type RESET to confirm');
  tx(() => {
    for (const t of ['payout_lines', 'brokerage', 'transactions', 'folio_master', 'folios', 'partner_rows', 'partner_codes',
      'batches', 'clients', 'rates', 'name_map', 'settlements', 'payments', 'month_locks', 'notifications']) db.exec(`DELETE FROM ${t}`);
    db.prepare("DELETE FROM users WHERE role <> 'admin'").run();
  });
  audit(req.user, 'FACTORY_RESET', 'All imported data, clients and team members were deleted');
  res.json({ ok: true });
});

export default r;
