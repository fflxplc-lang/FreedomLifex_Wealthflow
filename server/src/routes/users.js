import { Router } from 'express';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { db, audit, tx, LEVEL_NAMES } from '../db.js';
import { requireAdmin, teamOf } from '../auth.js';
import { publicUser } from './auth.js';
import { recalculate, rebuildHierarchies } from '../services/payout.js';
import { parseJSON, norm, clean } from '../util.js';
import { readSheet } from '../parsers/registrar.js';

const r = Router();

r.get('/', (req, res) => {
  const q = `%${req.query.q || ''}%`;
  const rows = db.prepare(`
    SELECT u.*, p.name parent_name,
      (SELECT COUNT(DISTINCT c.id) FROM clients c, json_each(c.hierarchy) j WHERE j.value = u.id) clients
    FROM users u LEFT JOIN users p ON p.id = u.parent_id
    WHERE u.name LIKE ? OR u.email LIKE ? OR COALESCE(u.code,'') LIKE ?
    ORDER BY u.level, u.name`).all(q, q, q);
  // Only admins see the whole team (with bank details); others see themselves and, for a mentor,
  // their direct reports.
  const allowed = req.user.role === 'admin' ? null : new Set([req.user.id, ...teamOf(req.user).map((u) => u.id)]);
  res.json(rows.filter((u) => !allowed || allowed.has(u.id)).map((u) => ({ ...publicUser(u), parent_name: u.parent_name, clients: u.clients, level_name: LEVEL_NAMES[u.level] })));
});

r.get('/levels', (_req, res) => res.json(LEVEL_NAMES));

r.get('/:id', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  const mine = req.user.role === 'admin' || u?.id === req.user.id || teamOf(req.user).some((x) => x.id === u?.id);
  if (!u || !mine) throw new Error('User not found');
  res.json(publicUser(u));
});

function fieldsFrom(body) {
  const levels = (body.extra_levels || []).map(Number).filter((n) => n >= 1 && n <= 7);
  return {
    name: String(body.name || '').trim(),
    email: String(body.email || '').trim().toLowerCase(),
    code: body.code?.trim() || null,
    gst: body.gst?.trim() || null,
    pan: body.pan?.trim()?.toUpperCase() || null,
    parent_id: body.parent_id ? Number(body.parent_id) : null,
    sharing_pct: Number(body.sharing_pct) || 0,
    role: ['admin', 'ops', 'mentor', 'partner'].includes(body.role) ? body.role : 'ops',
    level: Math.min(7, Math.max(1, Number(body.level) || 1)),
    extra_levels: JSON.stringify(levels),
    bank: JSON.stringify(body.bank || {}),
    address: JSON.stringify(body.address || {}),
    arn: body.arn || null, arn_valid: body.arn_valid || null,
    euin: body.euin || null, euin_valid: body.euin_valid || null,
  };
}

// One email may hold several accounts of the same person (same name or PAN), or a BM (L4+) and an
// RM ID (L1-L3) that reports directly to that BM; the RM ID may then carry a different name.
// A BM has at most one RM ID on their email.
const isRmPair = (rm, bm) => Number(rm.level) <= 3 && Number(bm.level) >= 4 && rm.parent_id != null && Number(rm.parent_id) === Number(bm.id);
function emailCheck(f, exceptId = 0) {
  const same = db.prepare('SELECT id, name, pan, level, parent_id FROM users WHERE lower(email) = lower(?) AND id <> ?').all(f.email, exceptId);
  const me = { ...f, id: exceptId || null };
  const samePerson = (u) => (u.pan && f.pan && u.pan.toUpperCase() === String(f.pan).toUpperCase()) || u.name.trim().toLowerCase() === String(f.name || '').trim().toLowerCase();
  const paired = (u) => isRmPair(me, u) || (exceptId && isRmPair(u, me));
  const bm = same.find((u) => isRmPair(me, u));
  if (bm && same.some((u) => u.id !== bm.id && isRmPair(u, bm))) throw new Error(`${bm.name} already has an RM ID on this email`);
  const other = same.find((u) => !samePerson(u) && !paired(u));
  if (other) throw new Error(`This email already belongs to ${other.name}. One email can only be shared by accounts of the same person, or by a BM (L4+) and an RM ID (L1-L3) that reports directly to that BM.`);
}

r.post('/', requireAdmin, (req, res) => {
  const f = fieldsFrom(req.body);
  if (!f.name || !f.email) throw new Error('Full name and access email are required');
  if (!req.body.password || req.body.password.length < 6) throw new Error('Password must be at least 6 characters');
  emailCheck(f);
  const cols = Object.keys(f);
  const id = db.prepare(`INSERT INTO users(${cols.join(',')}, password_hash) VALUES(${cols.map(() => '?').join(',')}, ?)`)
    .run(...Object.values(f), bcrypt.hashSync(req.body.password, 10)).lastInsertRowid;
  audit(req.user, 'USER_CREATE', `Created user ${f.name} (${f.email}) at level ${f.level}`);
  if (req.body.recalculate) recalculate();
  res.json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)));
});

r.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const isSelf = id === req.user.id;
  if (req.user.role !== 'admin' && !isSelf) throw Object.assign(new Error('Admin access required'), { status: 403 });
  const cur = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!cur) throw new Error('User not found');
  let f = fieldsFrom({ ...publicUser(cur), ...req.body });
  if (req.user.role !== 'admin') {
    // Non-admins may edit their own profile, bank and address only.
    f = { name: f.name, bank: f.bank, address: f.address, gst: f.gst, pan: f.pan, arn: f.arn, arn_valid: f.arn_valid, euin: f.euin, euin_valid: f.euin_valid };
  }
  if (f.parent_id === id) throw new Error('A user cannot report to themselves');
  // Re-check the shared-email rule whenever something it depends on changes.
  const next = { ...publicUser(cur), ...f };
  const changed = ['email', 'name', 'pan', 'level', 'parent_id'].some((k) => String(next[k] ?? '').toLowerCase() !== String(cur[k] ?? '').toLowerCase());
  if (changed) emailCheck(next, id);
  if (req.body.signature !== undefined) f.signature = req.body.signature;
  db.prepare(`UPDATE users SET ${Object.keys(f).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(f), id);
  if (req.body.password) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(req.body.password, 10), id);
  // A new level or manager flows through every client this person is on, then their payouts.
  const moved = f.level !== undefined && (Number(f.level) !== cur.level || Number(f.parent_id || 0) !== Number(cur.parent_id || 0));
  const clientIds = moved ? rebuildHierarchies([id]) : [];
  audit(req.user, 'USER_UPDATE', `Updated user ${f.name || cur.name}${moved ? ` (L${cur.level} → L${f.level}; ${clientIds.length} client mapping(s) updated)` : ''}`);
  const calc = req.body.recalculate ? recalculate() : moved ? recalculate() : null;
  res.json({ ...publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)), recalculated: calc?.recalculated, clientsUpdated: clientIds.length });
});

r.put('/:id/sharing', requireAdmin, (req, res) => {
  const split = req.body.custom_split;
  db.prepare('UPDATE users SET custom_split = ? WHERE id = ?').run(split && Object.keys(split).length ? JSON.stringify(split) : null, req.params.id);
  const u = db.prepare('SELECT name FROM users WHERE id = ?').get(req.params.id);
  audit(req.user, 'USER_SHARING', `Custom sharing ${split ? 'set' : 'cleared'} for ${u?.name}`);
  const calc = req.body.recalculate ? recalculate() : null;
  res.json({ ok: true, recalculated: calc?.recalculated });
});

r.delete('/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) throw new Error('You cannot delete your own account');
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) throw new Error('User not found');
  let reports = [];
  tx(() => {
    // Remove the user from every client hierarchy, then the account.
    for (const c of db.prepare('SELECT c.id, c.hierarchy FROM clients c, json_each(c.hierarchy) j WHERE j.value = ?').all(id)) {
      const h = parseJSON(c.hierarchy, {});
      for (const k of Object.keys(h)) if (Number(h[k]) === id) delete h[k];
      db.prepare('UPDATE clients SET hierarchy = ? WHERE id = ?').run(JSON.stringify(h), c.id);
    }
    reports = db.prepare('SELECT id FROM users WHERE parent_id = ?').all(id).map((x) => x.id);
    db.prepare('UPDATE users SET parent_id = ? WHERE parent_id = ?').run(u.parent_id, id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  });
  // Their reports now sit under the deleted person's manager: rebuild those clients' mappings.
  rebuildHierarchies(reports);
  recalculate();
  audit(req.user, 'USER_DELETE', `Deleted user ${u.name} (${u.email})`);
  res.json({ ok: true });
});

// ---------- RM IDs for BMs ----------
// A BM (L4+) who also works clients as an RM gets a second, RM-level account with the same details.
// It reports to the BM's own account and shares their email and password; signing in with the email asks
// which account, the code with "-RM" opens the RM ID directly. `names` ({bmId: name}) gives an RM ID
// a different name; blank keeps the BM's name.
const rmIdOf = (bm) => db.prepare('SELECT id FROM users WHERE parent_id = ? AND level <= 3 AND lower(email) = lower(?)').get(bm.id, bm.email);
r.post('/rm-ids', requireAdmin, (req, res) => {
  const level = Number(req.body.level) || 1;
  if (level < 1 || level > 3) throw new Error('An RM ID must be level 1, 2 or 3');
  const ids = (req.body.ids || []).map(Number);
  const names = req.body.names || {};
  const made = []; const skipped = [];
  tx(() => {
    for (const id of ids) {
      const bm = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      if (!bm || bm.level < 4 || bm.role === 'admin') { skipped.push({ id, name: bm?.name, reason: 'not an L4+ BM' }); continue; }
      const email = bm.email;
      if (rmIdOf(bm)) { skipped.push({ id, name: bm.name, reason: 'already has an RM ID' }); continue; }
      const code = bm.code ? `${bm.code}-RM` : null;
      const name = clean(names[id]) || bm.name;
      const nid = db.prepare(`INSERT INTO users(name, email, code, gst, pan, parent_id, sharing_pct, role, level, extra_levels, bank, address,
          arn, arn_valid, euin, euin_valid, password_hash) VALUES(?, ?, ?, ?, ?, ?, 0, 'ops', ?, '[]', ?, ?, ?, ?, ?, ?, ?)`)
        .run(name, email, code, bm.gst, bm.pan, bm.id, level, bm.bank || '{}', bm.address || '{}', bm.arn, bm.arn_valid, bm.euin, bm.euin_valid, bm.password_hash).lastInsertRowid;
      made.push({ id: Number(nid), name, bm: bm.name, email, code });
    }
  });
  if (made.length) audit(req.user, 'USER_RM_ID', `Created ${made.length} RM ID(s) at L${level} for BMs: ${made.map((m) => (m.name === m.bm ? m.bm : `${m.bm} (as ${m.name})`)).join(', ')}`);
  res.json({ created: made, skipped });
});

// ---------- Bulk import of RMs and mentors (creates their accounts) ----------
// Same columns as the team export, so an export can be edited and imported back for new people.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const TEAM_COLS = {
  name: ['fullname', 'name', 'rmname', 'mentorname'], email: ['accessemail', 'email', 'emailid', 'loginemail'],
  code: ['employeearncode', 'employeecode', 'arncode', 'code', 'arn', 'empcode'], level: ['level', 'primarylevel', 'systemlevel'],
  parent: ['reportsto', 'reportingto', 'manager', 'parent'], role: ['role', 'accessrole'], password: ['password', 'accountpassword'],
  sharing: ['sharing', 'sharingrate', 'sharingpct'], gst: ['gstin', 'gst', 'gstnumber'], pan: ['pan', 'pannumber'],
  extra: ['additionallevels', 'extralevels'], holder: ['accountholder', 'accountholdername'], bankName: ['bankname', 'bank'],
  branch: ['branch', 'branchname'], account: ['accountnumber', 'accountno'], ifsc: ['ifsc', 'ifsccode'],
  street: ['street', 'address', 'streetbuilding'], city: ['city'], state: ['state'], pincode: ['pincode', 'pin'],
};
const DEFAULT_PASSWORD = 'Welcome@123';
const ROLES = { ops: 'ops', rm: 'ops', opsrm: 'ops', mentor: 'mentor', partner: 'partner', admin: 'admin' };

function readTeamFile(buffer, fileName) {
  const rows = readSheet(buffer, fileName);
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const keys = rows[i].map((h) => norm(h));
    const cols = {};
    for (const [f, names] of Object.entries(TEAM_COLS)) {
      const at = keys.findIndex((k) => names.includes(k));
      if (at >= 0) cols[f] = at;
    }
    if ('name' in cols && 'email' in cols) {
      return rows.slice(i + 1).filter((r) => r.some((c) => String(c).trim() !== ''))
        .map((r) => Object.fromEntries(Object.entries(cols).map(([f, at]) => [f, clean(r[at])])));
    }
  }
  throw new Error('No header row with Full Name and Access Email found. Download the template from the Hierarchy tab.');
}

const levelOf = (v) => { const n = Number(String(v).replace(/[^0-9]/g, '')); return n >= 1 && n <= 7 ? n : null; };

function previewTeam(rows) {
  const existing = db.prepare('SELECT id, name, email, code, level, parent_id FROM users').all();
  const find = (v) => {
    const k = String(v || '').trim().toLowerCase();
    // An email shared by a BM and their RM ID means the BM (highest level).
    return k ? [...existing].sort((a, b) => b.level - a.level).find((u) => u.email.toLowerCase() === k || (u.code || '').toLowerCase() === k || u.name.toLowerCase() === k) : null;
  };
  const seen = new Map();
  const out = rows.map((x, i) => {
    const errors = []; const notes = [];
    const email = x.email.toLowerCase();
    const level = levelOf(x.level || 1);
    const role = x.role ? ROLES[norm(x.role)] : 'ops';
    if (!x.name) errors.push('Full Name is missing');
    if (!/^\S+@\S+\.\S+$/.test(email)) errors.push('Access Email is missing or not valid');
    if (!level) errors.push(`Level "${x.level}" isn't 1 to 7`);
    if (!role) errors.push(`Role "${x.role}" isn't Ops, RM, Mentor, Partner or Admin`);
    if (x.password && x.password.length < 6) errors.push('Password must be at least 6 characters');
    if (!x.password) notes.push(`Password will be ${DEFAULT_PASSWORD}`);
    if (!seen.has(email)) seen.set(email, i);
    return { row: i + 2, name: x.name, email, code: x.code || null, level, role, parentRef: x.parent || '', password: x.password || '',
      sharing: Number(x.sharing) || 0, gst: x.gst || null, pan: x.pan ? x.pan.toUpperCase() : null,
      extra: String(x.extra || '').split(/[,\s]+/).map(levelOf).filter((l) => l && l !== level),
      bank: { holder: x.holder || '', bankName: x.bankName || '', branch: x.branch || '', account: x.account || '', ifsc: (x.ifsc || '').toUpperCase() },
      address: { street: x.street || '', city: x.city || '', state: x.state || '', pincode: x.pincode || '', country: 'India' },
      errors, notes };
  });
  // Reports To: an existing person, or someone earlier/later in the same file.
  for (const p of out) {
    if (!p.parentRef || /^(none|\(none\)|-|nobody|admin)$/i.test(p.parentRef)) { p.parentRef = ''; continue; }
    const k = p.parentRef.toLowerCase();
    // A shared email (BM + RM ID) means the highest-level account, in the team or in this file.
    const inFile = out.filter((o) => o !== p && (o.email === k || (o.code || '').toLowerCase() === k || o.name.toLowerCase() === k))
      .sort((a, b) => (b.level || 0) - (a.level || 0))[0];
    const ex = find(p.parentRef);
    const boss = inFile && (!ex || (inFile.level || 0) > ex.level) ? { name: inFile.name, level: inFile.level, email: inFile.email, inFile } : ex;
    p.boss = boss || null;
    if (!boss) p.errors.push(`Reports To "${p.parentRef}" not found in the team or this file`);
    else {
      p.parentName = boss.name;
      if (p.level && boss.level && boss.level <= p.level) p.errors.push(`Reports To ${boss.name} is L${boss.level}; a manager must be a higher level than L${p.level}`);
      else if (p.level <= 3 && boss.level < 4) p.notes.push(`L1-L3 normally report directly to an L4 or above (${boss.name} is L${boss.level})`);
    }
  }
  // Shared emails: allowed for the same person, or for an RM ID (L1-L3) whose Reports To is the L4+
  // BM on that email (the RM ID may have a different name). A BM gets at most one RM ID.
  const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  const rmOf = (p) => (p.level && p.level <= 3 && p.boss && p.boss.level >= 4 && (p.boss.email || '').toLowerCase() === p.email ? p.boss : null);
  for (const p of out) {
    if (!p.email || p.errors.some((e) => e.startsWith('Access Email'))) continue;
    const bm = rmOf(p);
    if (bm) {
      const taken = (!bm.inFile && existing.some((u) => u.email.toLowerCase() === p.email && u.level <= 3 && u.parent_id === bm.id))
        || out.some((o) => o !== p && o.row < p.row && (rmOf(o)?.inFile || rmOf(o)?.id) === (bm.inFile || bm.id));
      if (taken) p.errors.push(`${bm.name} already has an RM ID on this email`);
      else p.notes.push(`RM ID of ${bm.name} on the same email${sameName(p.name, bm.name) ? '' : ` (named ${p.name})`}; they will choose the account at sign-in`);
      continue;
    }
    const ex = existing.filter((u) => u.email.toLowerCase() === p.email);
    const first = out.find((o) => o.email === p.email);
    if (ex.some((u) => !sameName(u.name, p.name))) p.errors.push('This email already belongs to another person. To give a BM an RM ID with a different name, set Level L1-L3 and Reports To the BM.');
    else if (ex.length) p.notes.push('Same email as an existing account of this person; they will choose the account at sign-in');
    else if (first !== p && !out.some((o) => o !== p && o.email === p.email && rmOf(o)?.inFile === p)) p.errors.push(`Same email as row ${first.row}`);
  }
  for (const p of out) delete p.boss;
  return out;
}

r.post('/import/preview', requireAdmin, upload.single('file'), (req, res) => {
  if (!req.file) throw new Error('Choose a file');
  const rows = previewTeam(readTeamFile(req.file.buffer, req.file.originalname));
  res.json({ rows, ok: rows.filter((x) => !x.errors.length).length, errors: rows.filter((x) => x.errors.length).length });
});

r.post('/import/apply', requireAdmin, upload.single('file'), (req, res) => {
  if (!req.file) throw new Error('Choose a file');
  const rows = previewTeam(readTeamFile(req.file.buffer, req.file.originalname)).filter((x) => !x.errors.length);
  const created = [];
  tx(() => {
    const ins = db.prepare(`INSERT INTO users(name, email, code, gst, pan, parent_id, sharing_pct, role, level, extra_levels, bank, address, password_hash)
      VALUES(?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`);
    for (const x of rows) {
      const id = ins.run(x.name, x.email, x.code, x.gst, x.pan, x.sharing, x.role, x.level, JSON.stringify(x.extra), JSON.stringify(x.bank),
        JSON.stringify(x.address), bcrypt.hashSync(x.password || DEFAULT_PASSWORD, 10)).lastInsertRowid;
      created.push({ ...x, id: Number(id) });
    }
    // Link managers once everyone in the file exists.
    // An email shared by a BM and their RM ID resolves to the BM (highest level), never to the row itself.
    const byKey = (k, self) => db.prepare('SELECT id FROM users WHERE (lower(email) = ? OR lower(code) = ? OR lower(name) = ?) AND id <> ? ORDER BY level DESC, id LIMIT 1').get(k, k, k, self)?.id;
    for (const x of created) if (x.parentRef) db.prepare('UPDATE users SET parent_id = ? WHERE id = ?').run(byKey(x.parentRef.toLowerCase(), x.id) ?? null, x.id);
  });
  audit(req.user, 'USER_IMPORT', `Imported ${created.length} team account(s)`);
  res.json({ created: created.length });
});

export default r;
