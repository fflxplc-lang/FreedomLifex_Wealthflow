import { Router } from 'express';
import multer from 'multer';
import { db, audit, tx } from '../db.js';
import { requireAdmin } from '../auth.js';
import { parseRateSheet, extractRatesFromText, pdfText } from '../parsers/rates.js';
import { FUND_HOUSES, fundHouseOf } from '../parsers/registrar.js';
import { clean, upper } from '../util.js';
import { standardName } from '../services/mapping.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

function guessAmc(fileName, text) {
  const base = fileName.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ');
  const hay = upper(`${base} ${String(text).slice(0, 800)}`);
  const known = db.prepare("SELECT DISTINCT standard FROM name_map WHERE kind = 'amc'").all().map((x) => x.standard);
  const hit = known.filter((k) => k.length > 2 && new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(hay)).sort((a, b) => b.length - a.length)[0];
  if (hit) return hit;
  const house = FUND_HOUSES.find(([p]) => new RegExp(`\\b${p.trim()}\\b`).test(hay));
  if (house) return house[1];
  const first = upper(base.split(' ')[0]);
  return /^(BROKERAGE|RATE|RATES|SHEET|STRUCTURE|AMC|COMMISSION|TRAIL|NEW|FINAL|COPY|FILE|MASTER|\d.*)$/.test(first) ? '' : first;
}

// Reads one uploaded file: { rows: [{amc, scheme, rate}], notes: [] }.
async function readRateFile(f, amcOverride) {
  if (/\.pdf$/i.test(f.originalname)) {
    const text = await pdfText(f.buffer);
    if (clean(text).length < 40) throw new Error('This PDF has no readable text (it is a scanned image). Upload the Excel version or a text PDF.');
    const amc = amcOverride || guessAmc(f.originalname, text);
    const rows = extractRatesFromText(text).map((x) => ({ ...x, amc: amcOverride || fundHouseOf(x.scheme) || amc }));
    return { rows, notes: rows.length ? [`${rows.length} scheme(s) read from the PDF text`] : ['No "scheme name … rate" lines found in this PDF. If it is a table, upload the Excel version.'] };
  }
  if (!/\.(xlsx|xlsm|xls|csv|txt|ods)$/i.test(f.originalname)) throw new Error('Unsupported file type. Use PDF, Excel (.xlsx / .xls) or CSV.');
  const got = parseRateSheet(f.buffer, f.originalname, guessAmc);
  if (amcOverride) for (const x of got.rows) x.amc = amcOverride;
  return got;
}

// Upload AMC brokerage files (PDF / Excel / CSV, any layout). Each file is read on its own, so one bad
// file doesn't stop the others. A scheme already in the master for the same month is updated, not duplicated.
r.post('/upload', requireAdmin, upload.array('files', 20), async (req, res, next) => {
  try {
    if (!req.files?.length) throw new Error('Choose at least one file');
    const period = /^\d{4}-\d{2}$/.test(req.body.period || '') ? req.body.period : new Date().toISOString().slice(0, 7);
    const amcOverride = clean(req.body.amc);
    const find = db.prepare('SELECT id FROM rates WHERE amc = ? AND lower(scheme) = lower(?) AND period = ? ORDER BY id DESC LIMIT 1');
    const upd = db.prepare('UPDATE rates SET rate = ?, scheme = ?, source = ? WHERE id = ?');
    const ins = db.prepare('INSERT INTO rates(amc, scheme, period, rate, source) VALUES(?, ?, ?, ?, ?)');
    let total = 0;
    const files = [];
    for (const f of req.files) {
      try {
        const { rows, notes } = await readRateFile(f, amcOverride);
        let added = 0, updated = 0;
        tx(() => {
          for (const x of rows) {
            const amc = standardName('amc', x.amc || 'UNKNOWN');
            const hit = find.get(amc, x.scheme, period);
            if (hit) { upd.run(x.rate, x.scheme, f.originalname, hit.id); updated++; } else { ins.run(amc, x.scheme, period, x.rate, f.originalname); added++; }
          }
        });
        total += rows.length;
        files.push({ file: f.originalname, schemes: rows.length, added, updated, notes, sample: rows.slice(0, 5), amcs: [...new Set(rows.map((x) => x.amc))].slice(0, 5) });
      } catch (e) {
        files.push({ file: f.originalname, schemes: 0, error: e.message });
      }
    }
    audit(req.user, 'RATES_UPLOAD', `${total} scheme rate(s) read from ${files.length} file(s) for ${period}: ${files.map((x) => `${x.file} (${x.error ? 'failed' : x.schemes})`).join(', ')}`);
    res.json({ total, period, files });
  } catch (e) { next(e); }
});

r.get('/', (req, res) => {
  const { q = '', amc = '', month = '', year = '', current = '1' } = req.query;
  let sql = `SELECT r.* FROM rates r WHERE (r.scheme LIKE ? OR r.amc LIKE ?)`;
  const args = [`%${q}%`, `%${q}%`];
  if (amc) { sql += ' AND r.amc = ?'; args.push(amc); }
  if (year) { sql += ' AND r.period LIKE ?'; args.push(`${year}-%`); }
  if (month) { sql += ' AND r.period LIKE ?'; args.push(`%-${String(month).padStart(2, '0')}`); }
  if (current === '1') sql += ` AND r.id = (SELECT r2.id FROM rates r2 WHERE r2.scheme = r.scheme AND r2.amc = r.amc ORDER BY r2.period DESC, r2.id DESC LIMIT 1)`;
  sql += ' ORDER BY r.period DESC, r.amc, r.scheme LIMIT 2000';
  const rows = db.prepare(sql).all(...args);
  const stats = db.prepare('SELECT COUNT(DISTINCT amc || scheme) schemes, COUNT(*) versions, COUNT(DISTINCT amc) amcs FROM rates').get();
  const amcs = db.prepare('SELECT DISTINCT amc FROM rates ORDER BY amc').all().map((x) => x.amc);
  res.json({ rows, stats, amcs });
});

r.get('/history', (req, res) => {
  res.json(db.prepare('SELECT * FROM rates WHERE amc = ? AND scheme = ? ORDER BY period DESC, id DESC').all(req.query.amc, req.query.scheme));
});

r.put('/:id', requireAdmin, (req, res) => {
  const { rate, scheme, period } = req.body;
  db.prepare('UPDATE rates SET rate = COALESCE(?, rate), scheme = COALESCE(?, scheme), period = COALESCE(?, period) WHERE id = ?')
    .run(rate != null ? Number(rate) : null, scheme || null, period || null, req.params.id);
  audit(req.user, 'RATE_UPDATE', `Rate #${req.params.id} updated to ${rate}%`);
  res.json({ ok: true });
});

r.post('/delete', requireAdmin, (req, res) => {
  const ids = (req.body.ids || []).map(Number);
  if (ids.length) db.prepare(`DELETE FROM rates WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
  audit(req.user, 'RATE_DELETE', `${ids.length} rate row(s) deleted`);
  res.json({ ok: true });
});

r.post('/reset', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM rates').run();
  audit(req.user, 'RATE_RESET', 'Brokerage rate master reset');
  res.json({ ok: true });
});

export default r;
