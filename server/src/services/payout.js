// Brokerage sharing engine (Freedom LifeX lead policy):
//  1. Top share: L5, L6, L7 take 5% each of the brokerage. An empty top level passes its share
//     up; L7 empty = company. The other 85% is the pool.
//  2. The handler is the lowest level assigned on the client.
//     - Own lead by L1/L2/L3: they get 25/50/75% of the brokerage; the rest of the pool goes to
//       their reporting manager, the nearest L4+ on the client (none: company).
//     - Own lead by L4+: they get the whole pool.
//  3. Lead passed down: the client's `lead_by` (an L4+ the handler reports to directly) brought
//     the lead. They get 25% of the brokerage first; the handler (L1-L3) gets their 25/50/75% of
//     what is left of the pool, and the rest goes to the handler's L4+ manager (none: lead_by).
import { db, getSetting, tx } from '../db.js';
import { parseJSON } from '../util.js';

export const DEFAULT_SHARING = { top: { 5: 5, 6: 5, 7: 5 }, rates: { 1: 25, 2: 50, 3: 75 }, leadFee: 25 };
// Older saved settings: RM rates were called `caps`.
export function normSharing(s) {
  return {
    top: { ...(s?.top || DEFAULT_SHARING.top) },
    rates: { ...DEFAULT_SHARING.rates, ...(s?.rates || s?.caps || {}) },
    leadFee: s?.leadFee ?? DEFAULT_SHARING.leadFee,
  };
}

const sortedLevels = (obj) => Object.keys(obj || {}).map(Number).sort((a, b) => a - b);

export function loadContext() {
  const users = new Map();
  for (const u of db.prepare('SELECT id, name, level, sharing_pct, custom_split, active FROM users').all()) {
    users.set(u.id, { ...u, custom_split: parseJSON(u.custom_split, null) });
  }
  const clients = new Map();
  const leadBy = new Map();
  for (const c of db.prepare('SELECT id, hierarchy, lead_by FROM clients').all()) {
    clients.set(c.id, parseJSON(c.hierarchy, {}));
    if (c.lead_by) leadBy.set(c.id, c.lead_by);
  }
  return { users, clients, leadBy, sharing: normSharing(getSetting('sharing')) };
}

const override = (user, level) => {
  const v = user?.custom_split?.[level];
  return v !== undefined && v !== null && v !== '' ? Number(v) || 0 : null;
};

// A person's own-lead rate (L1-L3): custom override, else own sharing %, else the policy rate.
export function rmRate(user, level, sharing) {
  return override(user, level) ?? (Number(user.sharing_pct) > 0 ? Number(user.sharing_pct) : Number(sharing.rates[level] ?? 0));
}

// Returns [{user_id|null, level, pct, amount}] for one gross amount on one client.
// `hierarchy` is {level: userId}; `leadById` is the L4+ who brought a lead they passed down.
export function splitGross(gross, hierarchy, ctx, leadById = null) {
  const { sharing } = ctx;
  const h = hierarchy || {};
  const who = (lvl) => { const id = Number(h[lvl]); return id && ctx.users.get(id) ? id : null; };
  const out = new Map();
  const add = (uid, level, pct) => {
    if (!(pct > 0)) return;
    const k = `${uid ?? 'co'}:${level}`;
    const cur = out.get(k) || { user_id: uid, level, pct: 0 };
    cur.pct += pct;
    out.set(k, cur);
  };

  // 1. Top share, passed upward when a level is empty.
  const topLevels = sortedLevels(sharing.top);
  const topTotal = topLevels.reduce((s, l) => s + Number(sharing.top[l] || 0), 0);
  let carry = 0;
  for (const lvl of topLevels) {
    const uid = who(lvl);
    const pct = carry + (uid ? (override(ctx.users.get(uid), lvl) ?? Number(sharing.top[lvl] || 0)) : Number(sharing.top[lvl] || 0));
    if (uid) { add(uid, lvl, pct); carry = 0; } else carry = pct;
  }
  if (carry > 0) add(null, 7, carry);
  const pool = Math.max(0, 100 - topTotal);

  // 2. Handler = lowest assigned level; manager = nearest L4+ above them.
  let lead = 0;
  for (let l = 1; l <= 7; l++) if (who(l)) { lead = l; break; }
  if (!lead) { add(null, 7, pool); return finish(out, gross); }
  const handler = who(lead);
  let mgr = 0;
  for (let l = Math.max(lead + 1, 4); l <= 7; l++) if (who(l)) { mgr = l; break; }

  // leadBy: a user id, or {id, level} as it was when the brokerage was first split.
  const lb = leadById && typeof leadById === 'object' ? leadById : leadById ? { id: Number(leadById) } : null;
  const src = lb && ctx.users.get(lb.id) ? { id: lb.id, level: lb.level ?? ctx.users.get(lb.id).level } : null;
  if (src && src.id !== handler && src.level >= 4 && src.level > lead) {
    // 3. Passed-down lead: lead fee first, then the handler's % of what is left.
    const fee = Math.min(pool, Number(sharing.leadFee) || 0);
    add(src.id, src.level, fee);
    const left = pool - fee;
    if (lead <= 3) {
      const own = left * Math.min(100, rmRate(ctx.users.get(handler), lead, sharing)) / 100;
      add(handler, lead, own);
      if (mgr) add(who(mgr), mgr, left - own); else add(src.id, src.level, left - own);
    } else add(handler, lead, left);
  } else if (lead <= 3) {
    const own = Math.min(pool, rmRate(ctx.users.get(handler), lead, sharing));
    add(handler, lead, own);
    add(mgr ? who(mgr) : null, mgr || 7, pool - own);
  } else add(handler, lead, pool);
  return finish(out, gross);
}

const finish = (out, gross) => [...out.values()].map((l) => ({ ...l, pct: Math.round(l.pct * 1e4) / 1e4, amount: Math.round(gross * l.pct / 100 * 1e4) / 1e4 }));

export function lockedPeriods() {
  return new Set(db.prepare('SELECT period FROM month_locks').all().map((r) => r.period));
}

// Recalculate payout lines. `where` narrows the brokerage rows (e.g. one batch).
// Each brokerage row keeps the mapping it was first split with (map_snapshot), so a later
// mapping, level or manager change only affects brokerage that arrives after it. Rows whose
// client had no mapping yet pick up the current one. `resplit` clears the snapshots first
// (used to correct a wrong mapping on past brokerage).
export function recalculate({ batchId = null, clientIds = null, resplit = false } = {}) {
  const ctx = loadContext();
  const locked = lockedPeriods();
  let sql = `SELECT b.id, b.period, b.amount, b.client_id, b.map_snapshot FROM brokerage b
             JOIN batches t ON t.id = b.batch_id WHERE t.status = 'live'`;
  const params = [];
  if (batchId) { sql += ' AND b.batch_id = ?'; params.push(batchId); }
  if (clientIds?.length) { sql += ` AND b.client_id IN (${clientIds.map(() => '?').join(',')})`; params.push(...clientIds); }
  const rows = db.prepare(sql).all(...params).filter((r) => !locked.has(r.period));
  const del = db.prepare('DELETE FROM payout_lines WHERE brokerage_id = ?');
  const ins = db.prepare('INSERT INTO payout_lines(brokerage_id, period, user_id, level, pct, amount) VALUES(?, ?, ?, ?, ?, ?)');
  const snap = db.prepare('UPDATE brokerage SET map_snapshot = ? WHERE id = ?');
  tx(() => {
    for (const r of rows) {
      del.run(r.id);
      let m = resplit ? null : parseJSON(r.map_snapshot, null);
      if (m && m.c !== r.client_id) m = null;
      if (!m) {
        const h = r.client_id ? ctx.clients.get(r.client_id) || {} : {};
        const lbId = r.client_id ? ctx.leadBy.get(r.client_id) : null;
        m = { c: r.client_id, h, lb: lbId && ctx.users.get(lbId) ? { id: lbId, level: ctx.users.get(lbId).level } : null };
        snap.run(Object.keys(h).length ? JSON.stringify(m) : null, r.id);
      }
      const lines = splitGross(r.amount, m.h, ctx, m.lb);
      for (const l of lines) ins.run(r.id, r.period, l.user_id, l.level, l.pct, l.amount);
    }
  });
  return { recalculated: rows.length, skippedLocked: locked.size };
}

// Fills a client's hierarchy above an RM by walking the RM's reporting line.
export function chainFor(userId) {
  const h = {};
  const seen = new Set();
  let u = db.prepare('SELECT id, level, parent_id FROM users WHERE id = ?').get(userId);
  while (u && !seen.has(u.id)) {
    seen.add(u.id);
    if (!h[u.level]) h[u.level] = u.id;
    u = u.parent_id ? db.prepare('SELECT id, level, parent_id FROM users WHERE id = ?').get(u.parent_id) : null;
  }
  return h;
}

// Re-derive client mappings after a level or reporting-line change. For every client whose
// mapping includes one of `userIds`, the person handling the client (lowest level on it) is
// kept and the levels above are rebuilt from their current reporting line.
export function rebuildHierarchies(userIds) {
  const ids = new Set(userIds.map(Number));
  const exists = db.prepare('SELECT 1 FROM users WHERE id = ?');
  const changed = [];
  tx(() => {
    for (const c of db.prepare("SELECT id, hierarchy FROM clients WHERE hierarchy IS NOT NULL AND hierarchy <> '{}'").all()) {
      const h = parseJSON(c.hierarchy, {});
      if (!Object.values(h).some((v) => ids.has(Number(v)))) continue;
      const handlerLevel = Object.keys(h).map(Number).filter((l) => exists.get(Number(h[l]))).sort((a, b) => a - b)[0];
      const next = handlerLevel ? chainFor(Number(h[handlerLevel])) : {};
      if (JSON.stringify(next) === JSON.stringify(h)) continue;
      db.prepare('UPDATE clients SET hierarchy = ? WHERE id = ?').run(JSON.stringify(next), c.id);
      changed.push(c.id);
    }
  });
  return changed;
}

// Rules for "Lead brought by": once saved it stays fixed (an admin correction, which needs a reason, is the
// one exception), and the client's RM must be someone
// reporting directly to that L4+ person. Returns an error message or null.
export function leadByError(client, leadById, hierarchy, { correcting = false } = {}) {
  const was = correcting ? null : client?.lead_by ?? null;
  const name = (id) => db.prepare('SELECT name FROM users WHERE id = ?').get(id)?.name || `user ${id}`;
  if (was && Number(leadById) !== was) return `Lead brought by is already set to ${name(was)} and can't be changed`;
  if (!leadById) return null;
  const lb = db.prepare('SELECT id, name, level FROM users WHERE id = ?').get(Number(leadById));
  if (!lb) return 'Lead brought by: user not found';
  if (lb.level < 4) return `${lb.name} is L${lb.level}; only L4 or higher can pass a lead down`;
  const lvls = Object.keys(hierarchy || {}).filter((l) => hierarchy[l]).map(Number).sort((a, b) => a - b);
  if (!lvls.length) return null;
  const rm = Number(hierarchy[lvls[0]]);
  if (rm === lb.id) return `${lb.name} is the RM; choose "The RM brought it" instead`;
  const parent = db.prepare('SELECT parent_id FROM users WHERE id = ?').get(rm)?.parent_id;
  if (Number(parent) !== lb.id) return `The RM ${name(rm)} doesn't report directly to ${lb.name}; pick one of ${lb.name}'s direct reports`;
  return null;
}
