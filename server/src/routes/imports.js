import { Router } from 'express';
import multer from 'multer';
import { db, tx, audit, notify } from '../db.js';
import { requireAdmin } from '../auth.js';
import { parseTransactions, parseFolioMaster, parseBrokerage } from '../parsers/registrar.js';
import { resolveClient, standardName, remapUnmapped } from '../services/mapping.js';
import { recalculate, lockedPeriods } from '../services/payout.js';
import { categoryOf, periodOf, upper } from '../util.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

const VARIANTS = {
  transactions: { CAMS: 'WBR2', KARVY: 'MFSD201' },
  folio: { CAMS: 'WBR9', KARVY: 'MFSD211' },
  brokerage: { CAMS: 'NORMAL', KARVY: 'NORMAL' },
};

function dedupe(rows) {
  const seen = new Set();
  return rows.filter((r) => {
    const k = JSON.stringify(r);
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
}

r.post('/upload', requireAdmin, upload.single('file'), (req, res) => {
  const { kind, source, period } = req.body;
  if (!req.file) throw new Error('Choose a file to upload');
  if (!VARIANTS[kind]) throw new Error('Unknown import type');
  const src = String(source || '').toUpperCase() === 'KARVY' ? 'KARVY' : 'CAMS';
  if (!/^\d{4}-\d{2}$/.test(period || '')) throw new Error('Pick a settlement month');
  if (kind === 'brokerage' && lockedPeriods().has(period)) throw new Error(`${period} is locked. Unlock it in Admin Console → System first.`);

  const name = req.file.originalname;
  let variant = VARIANTS[kind][src];
  if (kind === 'brokerage' && /\bSIF\b/i.test(name)) variant = 'SIF';

  const parsed = kind === 'transactions' ? parseTransactions(req.file.buffer, name)
    : kind === 'folio' ? parseFolioMaster(req.file.buffer, name)
      : parseBrokerage(req.file.buffer, name);
  const rows = dedupe(parsed);
  const valueOf = (x) => (kind === 'brokerage' ? x.amount : kind === 'transactions' ? x.amount : 0);
  const rawTotal = parsed.reduce((s, x) => s + valueOf(x), 0);
  const total = rows.reduce((s, x) => s + valueOf(x), 0);

  let newClients = 0, unmapped = 0;
  const before = db.prepare('SELECT COUNT(*) c FROM clients').get().c;

  // Learn scheme code -> name pairs; CAMS brokerage files only carry the code.
  const learn = db.prepare('INSERT INTO scheme_codes(code, name) VALUES(?, ?) ON CONFLICT(code) DO UPDATE SET name = excluded.name');
  const learnCodes = (x) => { if (x.scheme_code && x.scheme && upper(x.scheme) !== x.scheme_code) learn.run(x.scheme_code, x.scheme); };
  const codeName = db.prepare('SELECT name FROM scheme_codes WHERE code = ?');
  const schemeOf = (x) => {
    const code = x.scheme_code || (/^[A-Z0-9]{1,10}$/i.test(x.scheme) ? upper(x.scheme) : '');
    if (!code || (x.scheme && upper(x.scheme) !== code)) return x.scheme;
    return codeName.get(code)?.name || codeName.get(upper(x.amc) + code)?.name || x.scheme;
  };

  const batchId = tx(() => {
    const id = Number(db.prepare(`INSERT INTO batches(file_name, kind, source, variant, period, rows, raw_rows, total, raw_total, created_by)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(name, kind, src, variant, period, rows.length, parsed.length, total, rawTotal, req.user.id).lastInsertRowid);

    if (kind === 'transactions') {
      const ins = db.prepare(`INSERT INTO transactions(batch_id, folio, investor, pan, amc, scheme, trxn_date, trxn_type, amount, units, nav, client_id)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const x of rows) {
        learnCodes(x);
        const cid = resolveClient(x, { create: true });
        ins.run(id, x.folio, x.investor, x.pan, standardName('amc', x.amc), standardName('scheme', x.scheme), x.trxn_date, x.trxn_type, x.amount, x.units, x.nav, cid);
      }
    } else if (kind === 'folio') {
      const up = db.prepare(`INSERT INTO folio_master(folio, investor, pan, email, mobile, amc, source, batch_id) VALUES(?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(folio) DO UPDATE SET investor = excluded.investor, pan = COALESCE(NULLIF(excluded.pan,''), pan),
        email = COALESCE(NULLIF(excluded.email,''), email), mobile = COALESCE(NULLIF(excluded.mobile,''), mobile),
        amc = excluded.amc, source = excluded.source, batch_id = excluded.batch_id`);
      const fill = db.prepare(`UPDATE clients SET email = COALESCE(NULLIF(email,''), ?), mobile = COALESCE(NULLIF(mobile,''), ?) WHERE id = ?`);
      for (const x of rows) {
        learnCodes(x);
        up.run(x.folio, x.investor, x.pan, x.email, x.mobile, standardName('amc', x.amc), src, id);
        const cid = resolveClient(x, { create: true });
        if (cid) fill.run(x.email || null, x.mobile || null, cid);
      }
    } else {
      const ins = db.prepare(`INSERT INTO brokerage(batch_id, period, folio, investor, pan, amc, scheme, category, trxn_date, trxn_type, amount, aum, client_id)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const x of rows) {
        const cid = resolveClient(x, { create: Boolean(x.pan) });
        if (!cid) unmapped++;
        const scheme = standardName('scheme', schemeOf(x));
        ins.run(id, period, x.folio, x.investor, x.pan, standardName('amc', x.amc), scheme, categoryOf(scheme), x.trxn_date || `${period}-01`, x.trxn_type, x.amount, x.aum, cid);
      }
    }
    return id;
  });

  if (kind === 'folio') remapUnmapped();
  const calc = kind === 'brokerage' ? recalculate({ batchId }) : kind === 'folio' ? recalculate() : null;
  newClients = db.prepare('SELECT COUNT(*) c FROM clients').get().c - before;

  audit(req.user, 'DATA_IMPORT', `${name}: ${rows.length} ${kind} row(s) imported for ${period} (${src} ${variant})`);
  notify('Data Import', `${name} — ${rows.length} ${kind === 'brokerage' ? 'transactions' : 'rows'}${total ? ` (₹${total.toFixed(3)})` : ''}`);

  const sample = rows.slice(0, 25);
  res.json({
    batchId, kind, source: src, variant, period, fileName: name,
    rows: rows.length, rawRows: parsed.length, duplicatesRemoved: parsed.length - rows.length,
    total, newClients, unmapped, recalculated: calc?.recalculated ?? 0, sample,
    detectedPeriods: kind === 'transactions' ? [...new Set(rows.map((x) => periodOf(x.trxn_date)).filter(Boolean))].sort() : undefined,
  });
});

r.get('/batches', (req, res) => {
  const status = req.query.status === 'deleted' ? 'deleted' : 'live';
  const q = `%${req.query.q || ''}%`;
  const month = req.query.month || '';
  const rows = db.prepare(`SELECT * FROM batches WHERE status = ? AND file_name LIKE ? AND (? = '' OR period = ?)
    ORDER BY ${status === 'deleted' ? 'deleted_at' : 'period'} DESC, id DESC`).all(status, q, month, month);
  const counts = db.prepare("SELECT status, COUNT(*) c FROM batches GROUP BY status").all();
  const periods = db.prepare('SELECT DISTINCT period FROM batches ORDER BY period DESC').all().map((x) => x.period);
  res.json({ rows, periods, trash: counts.find((c) => c.status === 'deleted')?.c || 0, live: counts.find((c) => c.status === 'live')?.c || 0 });
});

r.get('/batches/:id/rows', (req, res) => {
  const b = db.prepare('SELECT * FROM batches WHERE id = ?').get(req.params.id);
  if (!b) throw new Error('Batch not found');
  const table = b.kind === 'brokerage' ? 'brokerage' : b.kind === 'transactions' ? 'transactions' : 'folio_master';
  res.json({ batch: b, rows: db.prepare(`SELECT * FROM ${table} WHERE batch_id = ? LIMIT 500`).all(b.id) });
});

function assertUnlocked(b) {
  if (b.kind === 'brokerage' && lockedPeriods().has(b.period)) throw new Error(`${b.period} is locked; unlock it before changing its batches.`);
}

r.delete('/batches/:id', requireAdmin, (req, res) => {
  const b = db.prepare('SELECT * FROM batches WHERE id = ?').get(req.params.id);
  if (!b) throw new Error('Batch not found');
  assertUnlocked(b);
  db.prepare("UPDATE batches SET status = 'deleted', deleted_at = datetime('now') WHERE id = ?").run(b.id);
  audit(req.user, 'BATCH_DELETE', `${b.file_name} moved to trash`);
  res.json({ ok: true });
});

r.post('/batches/:id/restore', requireAdmin, (req, res) => {
  const b = db.prepare('SELECT * FROM batches WHERE id = ?').get(req.params.id);
  if (!b) throw new Error('Batch not found');
  assertUnlocked(b);
  db.prepare("UPDATE batches SET status = 'live', deleted_at = NULL WHERE id = ?").run(b.id);
  if (b.kind === 'brokerage') recalculate({ batchId: b.id });
  audit(req.user, 'BATCH_RESTORE', `${b.file_name} restored from trash`);
  res.json({ ok: true });
});

r.delete('/batches/:id/purge', requireAdmin, (req, res) => {
  const b = db.prepare("SELECT * FROM batches WHERE id = ? AND status = 'deleted'").get(req.params.id);
  if (!b) throw new Error('Only batches in trash can be deleted forever');
  tx(() => {
    db.prepare('DELETE FROM payout_lines WHERE brokerage_id IN (SELECT id FROM brokerage WHERE batch_id = ?)').run(b.id);
    db.prepare('DELETE FROM brokerage WHERE batch_id = ?').run(b.id);
    db.prepare('DELETE FROM transactions WHERE batch_id = ?').run(b.id);
    db.prepare('DELETE FROM batches WHERE id = ?').run(b.id);
  });
  audit(req.user, 'BATCH_PURGE', `${b.file_name} permanently deleted`);
  res.json({ ok: true });
});

r.post('/remap', requireAdmin, (req, res) => {
  const out = remapUnmapped();
  const calc = out.clientIds.length ? recalculate({ clientIds: out.clientIds }) : { recalculated: 0 };
  audit(req.user, 'REMAP_UNMAPPED', `Re-mapped ${out.mapped} of ${out.scanned} unmapped brokerage row(s)`);
  res.json({ ...out, recalculated: calc.recalculated });
});

export default r;
