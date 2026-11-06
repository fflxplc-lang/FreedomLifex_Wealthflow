import { Router } from 'express';
import { db, audit, tx, getSetting } from '../db.js';
import { requireAdmin, scopeUser } from '../auth.js';
import { recalculate, chainFor, leadByError } from '../services/payout.js';
import { linkFolio } from '../services/mapping.js';
import { parseJSON, upper, clean } from '../util.js';
import { LIVE, latestPeriod } from './dashboard.js';

const r = Router();

function decorate(c, users, rmMax, latest) {
  const h = parseJSON(c.hierarchy, {});
  const levels = Object.keys(h).map(Number).filter((l) => users.has(Number(h[l]))).sort((a, b) => a - b);
  const ownerLevel = levels[0];
  const owner = ownerLevel ? users.get(Number(h[ownerLevel])) : null;
  return {
    id: c.id, name: c.name, pan: c.pan, email: c.email, mobile: c.mobile,
    hierarchy: h, leadBy: c.lead_by || null,
    folios: c.folios ? c.folios.split(',') : [],
    aum: c.aum || 0, aumPeriod: latest,
    owner: owner ? { id: owner.id, name: owner.name, level: ownerLevel } : null,
    hasRM: levels.some((l) => l <= rmMax), hasBM: levels.some((l) => l > rmMax),
  };
}

function loadClients(req) {
  const uid = scopeUser(req);
  const latest = latestPeriod();
  const users = new Map(db.prepare('SELECT id, name, level FROM users').all().map((u) => [u.id, u]));
  const rmMax = Number(getSetting('rmMaxLevel'));
  const rows = db.prepare(`
    SELECT c.*, (SELECT GROUP_CONCAT(folio) FROM folios f WHERE f.client_id = c.id) folios,
      (SELECT SUM(b.aum) FROM brokerage b ${LIVE} WHERE b.client_id = c.id AND b.period = ?) aum
    FROM clients c ORDER BY aum DESC NULLS LAST, c.name`).all(latest);
  let list = rows.map((c) => decorate(c, users, rmMax, latest));
  if (uid) list = list.filter((c) => Object.values(c.hierarchy).map(Number).includes(uid));
  return list;
}

r.get('/', (req, res) => {
  const all = loadClients(req);
  const q = String(req.query.q || '').toLowerCase();
  const filter = req.query.filter || 'all';
  const counts = {
    all: all.length,
    noRM: all.filter((c) => !c.hasRM).length,
    noBM: all.filter((c) => !c.hasBM).length,
    noFolios: all.filter((c) => !c.folios.length).length,
    orphanFolios: db.prepare(`SELECT COUNT(DISTINCT b.folio) c FROM brokerage b ${LIVE} WHERE b.client_id IS NULL`).get().c,
  };
  let list = all;
  if (filter === 'noRM') list = list.filter((c) => !c.hasRM);
  if (filter === 'noBM') list = list.filter((c) => !c.hasBM);
  if (filter === 'noFolios') list = list.filter((c) => !c.folios.length);
  if (q) list = list.filter((c) => c.name.toLowerCase().includes(q) || (c.pan || '').toLowerCase().includes(q)
    || c.folios.some((f) => f.toLowerCase().includes(q)) || (c.owner?.name || '').toLowerCase().includes(q));
  if (req.query.all) return res.json({ rows: list, total: list.length, counts });
  const page = Math.max(1, Number(req.query.page) || 1);
  const size = Math.min(200, Number(req.query.size) || 50);
  res.json({ rows: list.slice((page - 1) * size, page * size), total: list.length, page, size, counts });
});

// Folios that carry brokerage but belong to no client, with what the statements say about them and
// the client they most likely belong to (same folio already on a client, else same PAN).
r.get('/orphan-folios', requireAdmin, (_req, res) => {
  const latest = latestPeriod();
  const rows = db.prepare(`SELECT b.folio, MAX(b.investor) investor, MAX(b.pan) pan, MAX(b.amc) amc,
      COUNT(DISTINCT b.scheme) schemes, MAX(b.scheme) scheme, COUNT(*) txns, COALESCE(SUM(b.amount), 0) gross,
      COALESCE(SUM(CASE WHEN b.period = ? THEN b.aum END), 0) aum, MIN(b.period) firstPeriod, MAX(b.period) lastPeriod
    FROM brokerage b ${LIVE} WHERE b.client_id IS NULL GROUP BY b.folio ORDER BY gross DESC`).all(latest);
  const byFolio = db.prepare('SELECT c.id, c.name FROM folios f JOIN clients c ON c.id = f.client_id WHERE f.folio = ?');
  const byPan = db.prepare('SELECT id, name FROM clients WHERE upper(pan) = upper(?) ORDER BY id LIMIT 1');
  const byName = db.prepare('SELECT id, name FROM clients WHERE upper(trim(name)) = upper(trim(?))');
  for (const x of rows) {
    const f = x.folio && byFolio.get(x.folio);
    const p = !f && x.pan && byPan.get(x.pan);
    const n = !f && !p && x.investor ? byName.all(x.investor) : [];
    const m = f || p || (n.length === 1 ? n[0] : null);
    x.match = m ? { id: m.id, name: m.name, by: f ? 'folio' : p ? 'PAN' : 'name' } : null;
  }
  res.json(rows);
});

// Attach folios with no client to a client; their brokerage is then split on that client's mapping.
r.post('/orphan-folios/link', requireAdmin, (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [{ folio: req.body.folio, clientId: req.body.clientId }];
  const ids = new Set();
  tx(() => {
    for (const { folio, clientId } of items) {
      const c = db.prepare('SELECT id FROM clients WHERE id = ?').get(Number(clientId));
      if (!folio || !c) continue;
      if (!db.prepare('SELECT 1 FROM folios WHERE folio = ?').get(folio)) linkFolio(folio, c.id);
      db.prepare('UPDATE brokerage SET client_id = ? WHERE folio = ? AND client_id IS NULL').run(c.id, folio);
      ids.add(c.id);
    }
  });
  if (ids.size) recalculate({ clientIds: [...ids] });
  audit(req.user, 'FOLIO_LINK', `Linked ${items.length} folio(s) with no client to ${ids.size} client(s)`);
  res.json({ linked: items.length, clients: ids.size });
});

function saveFolios(clientId, folios) {
  db.prepare('DELETE FROM folios WHERE client_id = ?').run(clientId);
  for (const f of folios) linkFolio(f, clientId);
  // Brokerage on these folios that had no client now belongs here.
  for (const f of folios) db.prepare('UPDATE brokerage SET client_id = ? WHERE folio = ? AND client_id IS NULL').run(clientId, f);
}
const splitFolios = (s) => [...new Set(String(s || '').split(/[,\n]/).map(clean).filter(Boolean))];

r.post('/', requireAdmin, (req, res) => {
  const { name, pan, email, mobile, folios } = req.body;
  if (!clean(name)) throw new Error('Investor name is required');
  const id = tx(() => {
    const id = Number(db.prepare('INSERT INTO clients(name, pan, email, mobile) VALUES(?, ?, ?, ?)')
      .run(clean(name), upper(pan) || null, clean(email) || null, clean(mobile) || null).lastInsertRowid);
    saveFolios(id, splitFolios(folios));
    return id;
  });
  recalculate({ clientIds: [id] });
  audit(req.user, 'CLIENT_CREATE', `Created client ${clean(name)}`);
  res.json({ id });
});

r.put('/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { name, pan, email, mobile, folios } = req.body;
  tx(() => {
    db.prepare('UPDATE clients SET name = ?, pan = ?, email = ?, mobile = ? WHERE id = ?')
      .run(clean(name), upper(pan) || null, clean(email) || null, clean(mobile) || null, id);
    if (folios !== undefined) saveFolios(id, splitFolios(folios));
  });
  recalculate({ clientIds: [id] });
  audit(req.user, 'CLIENT_UPDATE', `Updated client ${clean(name)}`);
  res.json({ ok: true });
});

r.delete('/:id', requireAdmin, (req, res) => {
  const c = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!c) throw new Error('Client not found');
  tx(() => {
    db.prepare('UPDATE brokerage SET client_id = NULL WHERE client_id = ?').run(c.id);
    db.prepare('UPDATE transactions SET client_id = NULL WHERE client_id = ?').run(c.id);
    db.prepare('DELETE FROM clients WHERE id = ?').run(c.id);
  });
  recalculate();
  audit(req.user, 'CLIENT_DELETE', `Deleted client ${c.name}`);
  res.json({ ok: true });
});

// Map a client to people. Either pass `rmId` (fills the chain above from the RM's reporting
// line) or an explicit `hierarchy` {level: userId}.
r.put('/:id/map', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  let h = {};
  if (req.body.rmId) h = chainFor(Number(req.body.rmId));
  if (req.body.hierarchy) {
    for (const [lvl, uid] of Object.entries(req.body.hierarchy)) {
      if (uid) h[lvl] = Number(uid); else delete h[lvl];
    }
  }
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
  if (!client) throw new Error('Client not found');
  const leadBy = req.body.leadBy !== undefined ? (req.body.leadBy ? Number(req.body.leadBy) : null) : client.lead_by ?? null;
  // An admin can correct a lead source saved by mistake; the reason goes in the audit log.
  const correcting = Boolean(req.body.correctLead) && (client.lead_by ?? null) !== leadBy;
  const reason = String(req.body.reason || '').trim();
  if (correcting && reason.length < 5) throw new Error('Give a reason for correcting the lead source');
  const err = leadByError(client, leadBy, h, { correcting });
  if (err) throw new Error(err);
  db.prepare('UPDATE clients SET hierarchy = ?, lead_by = ? WHERE id = ?').run(JSON.stringify(h), leadBy, id);
  if (correcting) {
    const nm = (uid) => (uid ? db.prepare('SELECT name FROM users WHERE id = ?').get(uid)?.name : null) || 'the RM';
    audit(req.user, 'LEAD_SOURCE_CORRECTED', `${client.name}: lead brought by changed from ${nm(client.lead_by)} to ${nm(leadBy)}. Reason: ${reason}`);
  }
  // Past brokerage keeps its old split unless the admin asks to correct it too.
  const calc = recalculate({ clientIds: [id], resplit: Boolean(req.body.resplitPast) });
  const c = db.prepare('SELECT name FROM clients WHERE id = ?').get(id);
  audit(req.user, 'CLIENT_MAPPING_UPDATE', `Client hierarchy updated for ${c?.name} (1 record)${req.body.resplitPast ? '; past unlocked brokerage re-split' : ''}`);
  res.json({ ok: true, hierarchy: h, recalculated: calc.recalculated });
});

// ---------- Standardize: duplicates and name maps ----------
r.get('/duplicates', requireAdmin, (_req, res) => {
  const groups = [];
  const seen = new Set();
  const add = (by, key, ids) => {
    const sig = ids.slice().sort().join(',');
    if (ids.length < 2 || seen.has(sig)) return;
    seen.add(sig);
    const records = db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM folios f WHERE f.client_id = c.id) folios FROM clients c WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    groups.push({ by, key, records });
  };
  for (const g of db.prepare("SELECT pan k, GROUP_CONCAT(id) ids FROM clients WHERE pan IS NOT NULL AND pan <> '' GROUP BY pan HAVING COUNT(*) > 1").all()) add('PAN CARD', g.k, g.ids.split(',').map(Number));
  for (const g of db.prepare("SELECT mobile k, GROUP_CONCAT(id) ids FROM clients WHERE mobile IS NOT NULL AND mobile <> '' GROUP BY mobile HAVING COUNT(*) > 1").all()) add('MOBILE', g.k, g.ids.split(',').map(Number));
  for (const g of db.prepare("SELECT lower(email) k, GROUP_CONCAT(id) ids FROM clients WHERE email IS NOT NULL AND email <> '' GROUP BY lower(email) HAVING COUNT(*) > 1").all()) add('EMAIL', g.k, g.ids.split(',').map(Number));
  for (const g of db.prepare("SELECT upper(trim(name)) k, GROUP_CONCAT(id) ids FROM clients GROUP BY upper(trim(name)) HAVING COUNT(*) > 1").all()) add('EXACT NAME', g.k, g.ids.split(',').map(Number));
  res.json(groups);
});

r.post('/merge', requireAdmin, (req, res) => {
  const masterId = Number(req.body.masterId);
  const others = (req.body.otherIds || []).map(Number).filter((x) => x && x !== masterId);
  if (!masterId || !others.length) throw new Error('Pick a master and at least one record to fold into it');
  const master = db.prepare('SELECT * FROM clients WHERE id = ?').get(masterId);
  tx(() => {
    for (const o of others) {
      const oc = db.prepare('SELECT * FROM clients WHERE id = ?').get(o);
      if (!oc) continue;
      for (const f of db.prepare('SELECT folio FROM folios WHERE client_id = ?').all(o)) linkFolio(f.folio, masterId);
      db.prepare('UPDATE brokerage SET client_id = ? WHERE client_id = ?').run(masterId, o);
      db.prepare('UPDATE transactions SET client_id = ? WHERE client_id = ?').run(masterId, o);
      db.prepare(`UPDATE clients SET pan = COALESCE(pan, ?), email = COALESCE(email, ?), mobile = COALESCE(mobile, ?) WHERE id = ?`)
        .run(oc.pan, oc.email, oc.mobile, masterId);
      db.prepare('DELETE FROM clients WHERE id = ?').run(o);
    }
  });
  recalculate({ clientIds: [masterId] });
  audit(req.user, 'CLIENT_MERGE', `Merged ${others.length} record(s) into ${master?.name}`);
  res.json({ ok: true });
});

r.get('/names/:kind', requireAdmin, (req, res) => {
  const kind = req.params.kind === 'scheme' ? 'scheme' : 'amc';
  const q = `%${req.query.q || ''}%`;
  const page = Math.max(1, Number(req.query.page) || 1);
  const total = db.prepare('SELECT COUNT(*) c FROM name_map WHERE kind = ? AND (original LIKE ? OR standard LIKE ?)').get(kind, q, q).c;
  const rows = db.prepare('SELECT original, standard FROM name_map WHERE kind = ? AND (original LIKE ? OR standard LIKE ?) ORDER BY original LIMIT 50 OFFSET ?')
    .all(kind, q, q, (page - 1) * 50);
  res.json({ rows, total, page });
});

r.put('/names/:kind', requireAdmin, (req, res) => {
  const kind = req.params.kind === 'scheme' ? 'scheme' : 'amc';
  const { original, standard } = req.body;
  if (!clean(standard)) throw new Error('Standard name cannot be empty');
  const old = db.prepare('SELECT standard FROM name_map WHERE kind = ? AND original = ?').get(kind, original)?.standard;
  db.prepare('UPDATE name_map SET standard = ? WHERE kind = ? AND original = ?').run(clean(standard), kind, original);
  // Re-apply to already imported rows (they carry the previous standard name).
  if (old) {
    db.prepare(`UPDATE brokerage SET ${kind} = ? WHERE ${kind} = ?`).run(clean(standard), old);
    db.prepare(`UPDATE transactions SET ${kind} = ? WHERE ${kind} = ?`).run(clean(standard), old);
  }
  audit(req.user, 'NAME_STANDARDIZE', `${kind.toUpperCase()} "${original}" → "${clean(standard)}"`);
  res.json({ ok: true });
});

export default r;
