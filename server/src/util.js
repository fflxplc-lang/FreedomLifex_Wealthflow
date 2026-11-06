export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

export const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
export const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
export const upper = (s) => clean(s).toUpperCase();

export function num(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  let s = String(v).replace(/[₹,\s]/g, '');
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  const n = parseFloat(s);
  return Number.isFinite(n) ? (neg ? -n : n) : 0;
}

export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

// Accepts Excel serials, Date objects, dd/mm/yyyy, dd-Mon-yyyy, yyyy-mm-dd.
export function toISODate(v) {
  if (v === null || v === undefined || v === '') return null;
  // SheetJS builds dates at local midnight, so read the local calendar day (toISOString would
  // shift it to the previous day in India). The 1-minute nudge absorbs old timezone offsets.
  if (v instanceof Date && !isNaN(v)) {
    const d = new Date(v.getTime() + 60000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  m = s.match(/^(\d{1,2})[-\s/]([A-Za-z]{3})[A-Za-z]*[-\s/,]*(\d{2,4})/);
  if (m && MON[m[2].toLowerCase()]) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${String(MON[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}

export const periodOf = (iso) => (iso ? iso.slice(0, 7) : null);

export function periodLabel(p) {
  if (!p) return '';
  const [y, m] = p.split('-');
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

// Fund category used by the dashboard breakdown, derived from the scheme name.
export function categoryOf(scheme = '') {
  const s = scheme.toLowerCase();
  if (/liquid|overnight|money market/.test(s)) return 'Liquid';
  if (/arbitrage/.test(s)) return 'Arbitrage';
  if (/hybrid|balanced|multi.?asset|equity savings|asset allocation|dynamic asset/.test(s)) return 'Hybrid';
  if (/debt|bond|gilt|income|duration|credit|banking and psu|banking & psu|corporate|short term|ultra short|floater|fixed maturity|fmp|dynamic term|long term fund|treasury/.test(s)) return 'Debt';
  if (/equity|cap|flexi|elss|tax saver|focused|value|contra|dividend yield|thematic|sector|index|nifty|sensex|bse|etf|infra|pharma|banking|technology|consumption|opportunit|growth fund|bluechip/.test(s)) return 'Equity';
  return 'Other';
}

export const isRedemption = (type = '') => /redem|redm|switch.?out|swo|^r$|^so$|sell|withdraw/i.test(type);

export function monthsBetween(from, to) {
  const out = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

export function shiftPeriod(p, delta) {
  let [y, m] = p.split('-').map(Number);
  m += delta;
  while (m < 1) { m += 12; y--; }
  while (m > 12) { m -= 12; y++; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

export const parseJSON = (s, fallback) => { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };

// Levenshtein distance for "small spelling mistakes are corrected automatically".
export function editDistance(a, b) {
  a = norm(a); b = norm(b);
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}
