// AMC brokerage rate sheets: Excel / CSV in any layout, and text PDFs.
// Each AMC lays its structure out differently (title rows, merged two-row headers, "Year 1 / Year 2"
// trail columns, rates as "0.90%", 0.009 or "90 bps"), so columns are found by what they contain
// rather than by fixed names.
import XLSX from 'xlsx';
import { createRequire } from 'node:module';
import { clean } from '../util.js';
import { fundHouseOf, FUND_HOUSES } from './registrar.js';

const SCHEME_WORD = /fund|plan|scheme|etf|fof|index|portfolio|series|fmp|interval|savings|bond|gilt|liquid|overnight|arbitrage|hybrid|cap\b|elss|tax saver/i;
const MAX_RATE = 10;

// "0.90%" -> 0.9, "90 bps" -> 0.9, "0.9" -> 0.9; blank, "-", "NIL" -> null.
export function rateValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim().toLowerCase();
  if (!s || /^(-+|nil|na|n\/a|none)$/.test(s)) return null;
  const m = s.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  if (/bps|basis/.test(s)) return n / 100;
  return n;
}

// Which rate column to use, best first: first-year trail, total, trail, base, then anything rate-like.
const RATE_HEADERS = [
  /(1st|first)\s*(year|yr)|\byear\s*-?\s*(1|i)\b|\byr\.?\s*-?\s*1\b|\by1\b/i,
  /total/i,
  /trail/i,
  /\bbase\b/i,
  /gross|rate|brokerage|commission|payout|structure/i,
  /%|bps/i,
];
const SCHEME_HEADER = /scheme|fund\s*name|plan\s*name|product|portfolio|^fund$|name of (the )?(scheme|fund)/i;
const AMC_HEADER = /\bamc\b|fund\s*house|mutual\s*fund|asset\s*management/i;
const SKIP_HEADER = /code|isin|category|type|class|sr\.?\s*no|s\.?\s*no|\bno\.?$|remarks?|date|period|exit|load/i;

const text = (v) => clean(v instanceof Date ? '' : v);

function sheetRows(ws) {
  // Formatted text, so a percent-formatted cell reads "0.90%" instead of 0.009.
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, blankrows: true });
  // Copy merged header cells across their span ("Trail" over "Year 1 | Year 2").
  for (const m of ws['!merges'] || []) {
    if (m.s.r > 40) continue;
    const v = rows[m.s.r]?.[m.s.c];
    for (let r = m.s.r; r <= Math.min(m.e.r, m.s.r + 2); r++) {
      for (let c = m.s.c; c <= m.e.c; c++) if (rows[r] && rows[r][c] === '') rows[r][c] = v;
    }
  }
  return rows;
}

// Share of a column's cells (below the header) that are plausible rates.
function rateShare(rows, from, col) {
  let n = 0, ok = 0;
  for (let r = from; r < Math.min(rows.length, from + 200); r++) {
    const v = rows[r]?.[col];
    if (v === '' || v === undefined) continue;
    n++;
    // A rate is a decimal ("0.9"), or carries % / bps; plain whole numbers are serial numbers or counts.
    const x = rateValue(v);
    const s = String(v);
    if (x === null || !(x > 0)) continue;
    if (/bps|basis/i.test(s) ? x <= MAX_RATE * 100 : (x <= MAX_RATE && (/%/.test(s) || !Number.isInteger(x)))) ok++;
  }
  return n ? ok / n : 0;
}

function schemeShare(rows, from, col) {
  let n = 0;
  for (let r = from; r < Math.min(rows.length, from + 200); r++) if (SCHEME_WORD.test(text(rows[r]?.[col])) && text(rows[r][col]).length > 6) n++;
  return n;
}

// Finds the header row and the scheme / rate / AMC columns. Returns null when the sheet has no rates.
function findLayout(rows) {
  const width = Math.max(0, ...rows.slice(0, 60).map((r) => r.length));
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    if (rows[i].filter((c) => text(c)).length < 2) continue; // blank or title row
    // A header may span two rows: combine this row with the next when the next isn't data.
    const next = rows[i + 1] || [];
    const nextIsHeader = next.some((c) => RATE_HEADERS.some((re) => re.test(text(c)))) && !next.some((c) => SCHEME_WORD.test(text(c)) && text(c).length > 12);
    const head = Array.from({ length: width }, (_, c) => `${text(rows[i][c])} ${nextIsHeader ? text(next[c]) : ''}`.trim());
    const from = i + (nextIsHeader ? 2 : 1);
    const scheme = head.findIndex((h) => SCHEME_HEADER.test(h) && !/code|isin/i.test(h));
    if (scheme < 0) continue;
    let rate = -1;
    for (const re of RATE_HEADERS) {
      rate = head.findIndex((h, c) => c !== scheme && re.test(h) && !SKIP_HEADER.test(h.replace(/trail|rate|brokerage/gi, '')) && rateShare(rows, from, c) >= 0.5);
      if (rate >= 0) break;
    }
    if (rate < 0) continue;
    const amc = head.findIndex((h, c) => c !== scheme && AMC_HEADER.test(h) && !/scheme|name of the scheme/i.test(h));
    return { scheme, rate, amc, from, header: head };
  }
  // No usable header: the column with the most scheme names, and the most rate-like column after it.
  let scheme = -1, best = 0;
  for (let c = 0; c < width; c++) { const n = schemeShare(rows, 0, c); if (n > best) { best = n; scheme = c; } }
  if (scheme < 0 || best < 3) return null;
  let rate = -1, share = 0.5;
  for (let c = 0; c < width; c++) {
    if (c === scheme) continue;
    const s = rateShare(rows, 0, c);
    if (s > share) { share = s; rate = c; }
  }
  return rate < 0 ? null : { scheme, rate, amc: -1, from: 0, header: null };
}

// Rows of one sheet as [{amc, scheme, rate}].
function sheetRates(rows, fallbackAmc) {
  const L = findLayout(rows);
  if (!L) return null;
  const out = [];
  for (let r = L.from; r < rows.length; r++) {
    const row = rows[r];
    const scheme = text(row[L.scheme]).replace(/^\d+[.)]\s*/, '');
    const rate = rateValue(row[L.rate]);
    if (!scheme || scheme.length < 4 || rate === null || !(rate > 0)) continue;
    if (L.header && SCHEME_HEADER.test(scheme) && scheme.length < 25) continue; // repeated header row
    out.push({ amc: L.amc >= 0 ? text(row[L.amc]) : '', scheme, rate });
  }
  // A column written as fractions (0.009 for 0.9%) is converted to percent.
  if (out.length && Math.max(...out.map((x) => x.rate)) <= 0.05) for (const x of out) x.rate = Math.round(x.rate * 1e6) / 1e4;
  const kept = out.filter((x) => x.rate <= MAX_RATE);
  for (const x of kept) x.amc = fundHouseOf(x.scheme) || x.amc || fallbackAmc;
  return { rows: kept, column: L.header ? L.header[L.rate] : `column ${L.rate + 1}` };
}

// Excel / CSV rate sheet -> { rows: [{amc, scheme, rate}], notes: [] }. Every sheet is read.
export function parseRateSheet(buffer, fileName, guessAmc) {
  const isText = /\.(csv|txt)$/i.test(fileName);
  const wb = XLSX.read(buffer, { type: 'buffer', raw: isText, cellDates: true });
  const rows = []; const notes = [];
  const seen = new Set();
  for (const name of wb.SheetNames) {
    const sheet = sheetRows(wb.Sheets[name]);
    if (!sheet.length) continue;
    const titleText = sheet.slice(0, 8).map((r) => r.map(text).join(' ')).join(' ');
    const got = sheetRates(sheet, guessAmc(`${fileName} ${name}`, titleText));
    if (!got || !got.rows.length) continue;
    let n = 0;
    for (const x of got.rows) {
      const k = `${x.amc}|${x.scheme}`.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k); rows.push(x); n++;
    }
    notes.push(`${wb.SheetNames.length > 1 ? `Sheet "${name}": ` : ''}${n} scheme(s), rate from "${got.column}"`);
  }
  if (!rows.length) notes.push('No scheme names with a rate next to them were found. The sheet needs a scheme name column and a rate / trail column.');
  return { rows, notes };
}

// Text of a PDF -> [{scheme, rate}]. pdf-parse glues table cells together ("1Axis Bluechip Fund0.90%0.80%")
// and puts a wrapped cell on several lines, so name lines are collected until a line with a rate arrives.
// The first rate on a line is used (first-year trail in most AMC tables).
const PDF_RATE = /^(.*?)(\d{1,2}(?:\.\d{1,4})?)\s*(%|bps\b)/i;
const PDF_BARE = /^(.*?[A-Za-z)\]])\s*(\d?\.(?:\d{1,4}(?=[^\d.]|$)|\d{1,2}(?=\d\.)))/;
// "ELSS Invesco India ELSS Tax Saver Fund (w.e.f. 9th Oct 26)" -> "Invesco India ELSS Tax Saver Fund".
function tidyName(name) {
  let n = name.replace(/\(\s*w\.?\s*e\.?\s*f\.?[^)]*\)/gi, '').replace(/[^\x20-\x7E\u2013\u2014&]/g, ' ').replace(/\s+/g, ' ').replace(/[\s\-–,:|]+$/, '').trim();
  const u = n.toUpperCase();
  let at = -1;
  for (const [p] of FUND_HOUSES) {
    const i = u.search(new RegExp(`(^|\\s)${p.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`));
    if (i > 0 && (at < 0 || i < at)) at = i;
  }
  if (at > 0 && !fundHouseOf(n)) n = n.slice(at).trim();
  return n;
}
const stripSerial = (s) => s.replace(/^\s*\d{1,3}[.)]?\s*(?=[A-Za-z])/, '').replace(/[-–:|,\s]+$/, '').trim();
export function extractRatesFromText(raw) {
  const out = [];
  const seen = new Set();
  let buf = [];
  let last = null; // the scheme read on the previous line
  for (const line of String(raw).split(/\r?\n/).map(clean).filter(Boolean)) {
    const m = line.match(PDF_RATE) || line.match(PDF_BARE);
    if (!m) {
      if (/^\d{1,3}[.)]?$/.test(line)) continue; // a serial number on its own line
      // The end of the previous scheme's name, wrapped below its rate ("Axis Banking & PSU Debt Fund - Regular" / "Plan").
      if (last && line.length < 40 && line.split(' ').length <= 4 && !/\d/.test(line) && !fundHouseOf(line)
        && !/(schemes|funds|category|segment|structure|note|trail|rate|name|terms|conditions)\b/i.test(line)
        && !(line === line.toUpperCase() && last.scheme !== last.scheme.toUpperCase()) // a category label beside the table
        && !line.split(' ').every((w) => CATEGORY_WORDS.has(w.toUpperCase().replace(/[()]/g, '')))) {
        seen.delete(last.scheme.toLowerCase());
        last.scheme = `${last.scheme} ${line}`.replace(/\s+-\s*$/, '');
        seen.add(last.scheme.toLowerCase());
        last = null;
        continue;
      }
      last = null;
      if (/[A-Za-z]{2}/.test(line) && line.length < 150) buf = [...buf, line].slice(-3); else buf = [];
      continue;
    }
    let rate = Number(m[2]);
    if (/bps/i.test(m[3] || '')) rate /= 100;
    let name = stripSerial(m[1]);
    // Name continued from earlier lines ("Axis Banking & PSU Debt Fund - Regular" / "Plan" / "0.40%").
    const lead = stripSerial(buf.join(' '));
    if (!/[A-Za-z]{2}/.test(name)) name = lead;
    else if (lead && (!SCHEME_WORD.test(name) || /^[a-z&(-]/.test(name)) && SCHEME_WORD.test(`${lead} ${name}`)) name = `${lead} ${name}`;
    buf = [];
    last = null;
    name = tidyName(name);
    if (!(rate > 0 && rate <= 5) || name.length < 6 || !SCHEME_WORD.test(name)) continue;
    const k = name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    last = { scheme: name, rate };
    out.push(last);
  }
  return out;
}

// The "Brokerage Structure" PDF that CAMS / KFintech generate for each AMC: per scheme a "Lump sum" and a
// "Systematic" row ("Lump sum 1 to MAX 0 0.40 0.40 0.40 0.40 0.40": amount range, B30, incentive, then the
// 1st-5th year trail), with the category and scheme name printed between them. The 1st year trail is used.
// Returns null when the text isn't in this layout.
const STRUCT_ROW = /^(.*?)\b(lump\s*sum|systematic|sip|stp)\b\s+(?:[\d,]+|max)\s+to\s+(?:[\d,]+|max)\s+((?:-?\d*\.?\d+\s*)+)/i;
const CATEGORY_WORDS = new Set(('EQUITY DEBT HYBRID CASH INDEX FUND FUNDS ARBITRAGE FOF NFO SECTORAL THEMATIC SECTORAL/THEMATIC SOLUTION BASED '
  + 'CORE BOND ELSS GOLD OVERNIGHT LIQUID INTERNATIONAL GILT ORIENTED OTHER OTHERS PASSIVE ACTIVE ETF ETFS SCHEMES SCHEME '
  + 'NORMAL SPECIAL - 1 2 3 4 5 6 (G) G INCOME CREDIT MONEY MARKET DURATION SIF').split(' '));
const DATE_RANGE = /\d{1,2}[-/ ][A-Za-z]{3}[-/ ]\d{2,4}\s*to\s*\d{1,2}[-/ ][A-Za-z]{3}[-/ ]\d{2,4}/gi;
const BOILERPLATE = /brokerage structure|distributor\s*:|transaction|class scheme|nature amount|b30|generation date|perc-|apprdrt|terms\s*&|^•|investment period|page \d/i;

function structName(raw) {
  let n = clean(raw.replace(DATE_RANGE, ' ').replace(/\b(NORMAL|SPECIAL)\s*$/i, ''));
  if (!n || BOILERPLATE.test(n)) return '';
  n = tidyName(n);
  if (!fundHouseOf(n)) {
    // No fund house in the name (e.g. an SIF "HYBRID PRISM HYBRID LONG-SHORT FUND"): drop leading category words.
    const words = n.split(' ');
    const cat = (w) => CATEGORY_WORDS.has(w.toUpperCase().replace(/\([^)]*\)/g, '').replace(/[()]/g, '')) || CATEGORY_WORDS.has(w.toUpperCase());
    while (words.length && cat(words[0])) words.shift();
    n = words.join(' ');
    if (!n || n.split(' ').every(cat) || !SCHEME_WORD.test(n)) return '';
  }
  return n.length >= 6 && /[A-Za-z]{3}/.test(n) ? n : '';
}

export function extractStructureRates(raw) {
  const lines = String(raw).split(/\r?\n/).map(clean).filter(Boolean);
  if (lines.filter((l) => STRUCT_ROW.test(l)).length < 2) return null;
  const out = []; const seen = new Set();
  let pendingRate = null, pendingName = null;
  const save = (name, rate) => {
    const k = name.toLowerCase();
    if (seen.has(k) || !(rate > 0 && rate <= MAX_RATE)) return;
    seen.add(k); out.push({ scheme: name, rate });
  };
  for (const line of lines) {
    const m = line.match(STRUCT_ROW);
    const nameText = m ? m[1] : line;
    const name = structName(nameText);
    if (name) {
      if (pendingRate !== null) { save(name, pendingRate); pendingRate = null; pendingName = null; } else pendingName = name;
    }
    if (!m) continue;
    const nums = m[3].trim().split(/\s+/).map(Number).filter((n) => Number.isFinite(n));
    const rate = nums.length >= 5 ? nums[nums.length - 5] : nums[nums.length - 1];
    if (/lump/i.test(m[2])) {
      if (pendingName) { save(pendingName, rate); pendingName = null; pendingRate = null; } else pendingRate = rate;
    } else if (pendingName) { save(pendingName, rate); pendingName = null; }
  }
  return out;
}

// Text of a PDF, one line per row of the page. pdf.js gives each piece of text with its position, so
// pieces at the same height are joined left to right with spaces (table cells stay apart). Falls back
// to pdf-parse if pdf.js can't open the file.
const require = createRequire(import.meta.url);
export async function pdfText(buffer, password = '') {
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    let doc;
    try {
      doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, verbosity: 0, ...(password ? { password } : {}) }).promise;
    } catch (e) {
      if (e?.name === 'PasswordException') {
        throw Object.assign(new Error(password ? 'The PDF password is wrong. Check it and process the file again.'
          : 'This PDF is password-protected. Type its password in the "PDF password" box and process it again.'), { password: true });
      }
      throw e;
    }
    const lines = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const items = (await page.getTextContent()).items.filter((i) => i.str && i.str.trim());
      const rows = [];
      for (const i of items) {
        const y = i.transform[5], x = i.transform[4], h = Math.abs(i.transform[3]) || 10;
        let row = rows.find((r) => Math.abs(r.y - y) <= Math.max(2, h * 0.35));
        if (!row) { row = { y, parts: [] }; rows.push(row); }
        row.parts.push({ x, w: i.width || 0, str: i.str });
      }
      rows.sort((a, b) => b.y - a.y);
      for (const r of rows) {
        r.parts.sort((a, b) => a.x - b.x);
        let line = '', end = -Infinity;
        for (const p of r.parts) { line += (line && p.x - end > 1 ? ' ' : '') + p.str; end = p.x + p.w; }
        lines.push(line);
      }
      page.cleanup();
    }
    await doc.destroy();
    return lines.join('\n');
  } catch (e) {
    if (e.password) throw e;
    const pdfParse = require('pdf-parse/lib/pdf-parse.js');
    try { return (await pdfParse(buffer)).text; } catch { throw new Error(`This PDF could not be opened (${/password/i.test(e.message) ? 'it is password-protected' : 'it may be damaged'}). Save it again or upload the Excel version.`); }
  }
}
