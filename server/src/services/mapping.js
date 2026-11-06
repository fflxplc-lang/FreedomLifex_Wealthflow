// Folio → client resolution and AMC / scheme name standardization.
import { db } from '../db.js';
import { clean, upper } from '../util.js';

export function standardName(kind, original) {
  const o = clean(original);
  if (!o) return o;
  const row = db.prepare('SELECT standard FROM name_map WHERE kind = ? AND original = ?').get(kind, o);
  if (row) return row.standard;
  const std = kind === 'amc' ? standardizeAmc(o) : o;
  db.prepare('INSERT OR IGNORE INTO name_map(kind, original, standard) VALUES(?, ?, ?)').run(kind, o, std);
  return std;
}

// CAMS sends AMC codes, KFintech sends long names: fold both into one short name.
const AMC_CODES = {
  B: 'ADITYA BIRLA SUN LIFE', D: 'DSP', F: 'FRANKLIN TEMPLETON', G: 'BANDHAN', H: 'HDFC', K: 'KOTAK',
  L: 'SBI', P: 'ICICI PRUDENTIAL', T: 'TATA', PP: 'PPFAS', MM: 'MIRAE', Y: 'MIRAE', O: 'HSBC', IF: 'IIFL',
};
function standardizeAmc(name) {
  const u = upper(name);
  if (AMC_CODES[u]) return AMC_CODES[u];
  return u.replace(/\b(MUTUAL FUND|ASSET MANAGEMENT( COMPANY)?( LIMITED| LTD\.?)?|AMC|INVESTMENT MANAGERS?( PVT\.?)?( LTD\.?)?|MF|LIMITED|LTD\.?|PRIVATE|PVT\.?)\b/g, '')
    .replace(/[().,]/g, ' ').replace(/\s+/g, ' ').trim() || u;
}

const findFolio = () => db.prepare('SELECT client_id FROM folios WHERE folio = ? ORDER BY id LIMIT 1');
const findPan = () => db.prepare('SELECT id FROM clients WHERE pan = ? ORDER BY id LIMIT 1');

export function linkFolio(folio, clientId) {
  if (!folio || !clientId) return;
  db.prepare('INSERT OR IGNORE INTO folios(folio, client_id) VALUES(?, ?)').run(folio, clientId);
}

// Find the client for a folio; fall back to PAN; optionally create the client.
export function resolveClient({ folio, pan, investor, email, mobile }, { create = false } = {}) {
  const f = folio && findFolio().get(folio);
  if (f) return f.client_id;
  let id = null;
  if (pan) id = findPan().get(pan)?.id ?? null;
  if (!id && !pan && investor) {
    // No PAN: only trust a folio master entry that carries one.
    const fm = folio && db.prepare('SELECT pan FROM folio_master WHERE folio = ?').get(folio);
    if (fm?.pan) id = findPan().get(fm.pan)?.id ?? null;
  }
  if (!id && create && investor) {
    id = Number(db.prepare('INSERT INTO clients(name, pan, email, mobile) VALUES(?, ?, ?, ?)')
      .run(investor, pan || null, email || null, mobile || null).lastInsertRowid);
  }
  if (id && folio) linkFolio(folio, id);
  return id;
}

// Links brokerage rows that still have no client (e.g. after a new folio master import).
export function remapUnmapped() {
  const rows = db.prepare(`SELECT b.id, b.folio, b.pan, b.investor FROM brokerage b WHERE b.client_id IS NULL`).all();
  const upd = db.prepare('UPDATE brokerage SET client_id = ? WHERE id = ?');
  const touched = new Set();
  let mapped = 0;
  for (const r of rows) {
    let pan = r.pan;
    if (!pan) pan = db.prepare('SELECT pan FROM folio_master WHERE folio = ?').get(r.folio)?.pan;
    const id = resolveClient({ folio: r.folio, pan, investor: r.investor });
    if (id) { upd.run(id, r.id); mapped++; touched.add(id); }
  }
  return { scanned: rows.length, mapped, clientIds: [...touched] };
}
