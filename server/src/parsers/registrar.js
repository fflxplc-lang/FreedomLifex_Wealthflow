// Parsers for CAMS and KFintech (Karvy) registrar exports.
// Column names vary between report versions, so each field is matched against a list
// of known header aliases (compared after stripping case, spaces and punctuation).
import XLSX from 'xlsx';
import { norm, clean, upper, num, toISODate } from '../util.js';

const ALIASES = {
  folio: ['foliono', 'folio', 'folionumber', 'foliochk', 'acno', 'accountno', 'accountnumber', 'foliono.', 'foliodetails'],
  investor: ['invname', 'investorname', 'investor', 'name', 'invstname', 'clientname', 'firstholdername', 'applicantname', 'shname', 'holdername'],
  pan: ['pan', 'panno', 'pan1', 'panno1', 'pannumber', 'itpanno', 'itpan', 'firstholderpan', 'invpan', 'panofinvestor'],
  amc: ['amccode', 'amc', 'amcname', 'fund', 'fundname', 'mfname', 'amcdesc'],
  scheme: ['schemename', 'funddescription', 'schemedescription', 'schemedesc', 'scheme', 'schname', 'prodname', 'schemecode', 'product', 'fundscheme'],
  date: ['traddate', 'trxndate', 'transactiondate', 'tradedate', 'postdate', 'navdate', 'date', 'trdate', 'processdate', 'brokdate', 'fromdate'],
  type: ['trxntype', 'trxntypename', 'transactiondescription', 'transactiontype', 'trtype', 'trxnnature', 'trantype', 'description', 'trdesc', 'trxndesc'],
  amount: ['amount', 'amt', 'trxnamount', 'transactionamount', 'grossamount', 'value', 'amountrs'],
  schemeCode: ['prodcode', 'productcode', 'schemecode', 'txnschcode', 'product'],
  units: ['units', 'unit', 'trxnunits', 'noofunits'],
  nav: ['nav', 'purprice', 'price', 'navrs'],
  brokerage: ['brokamt', 'brkageamt', 'brokerage', 'brokerageamount', 'brokerageamt', 'brokerageinrs', 'brokeragers', 'brokrage', 'commission', 'commamt', 'trailamount', 'trail', 'netbrokerage', 'grossbrokerage', 'totalbrokerage', 'brokamount', 'payableamount'],
  aum: ['avgassets', 'averageassets', 'avgaum', 'aum', 'assets', 'plotassets', 'currentvalue', 'marketvalue', 'avgasset', 'averageaum', 'closingassets'],
  email: ['email', 'emailid', 'emailaddress', 'invemail', 'mail'],
  mobile: ['mobile', 'mobileno', 'mobilenumber', 'phone', 'phoneno', 'contactno', 'mobno', 'telephone'],
  // Partner (MOFSL) statements
  code: ['clientcode', 'code', 'clientid', 'ucc', 'accountcode'],
  segment: ['segment', 'exchange', 'exchangesegment', 'product'],
  mentor: ['mentorbrokerage', 'yourshare', 'apshare', 'subbrokershare', 'mentorshare', 'ourshare', 'franchiseshare'],
  partnerShare: ['partnerbrokerage', 'partnershare', 'mofslshare', 'companyshare', 'brokerretained'],
  total: ['totalbrokerage', 'grossbrokerage', 'brokerage', 'total', 'netbrokerage'],
  leadBy: ['leadby', 'leadbroughtby', 'leadsource', 'leadowner', 'leadgeneratedby'],
  rm: ['rmname', 'rm', 'relationshipmanager', 'subbroker', 'rmcode', 'rmarn'],
  bm: ['bmname', 'bm', 'branchmanager', 'bmcode', 'bmarn'],
  rate: ['rate', 'grossrate', 'brokeragerate', 'trailrate', 'trail', 'totaltrail', 'year1', 'firstyear', 'trailyr1', 'rateperannum', '1styeartrail'],
  clientId: ['clientid', 'id', 'wfclientid'],
};

// Aliases are listed in order of preference: the earliest alias that matches a header wins,
// so "Transaction Date" beats "From Date" in a KFintech file that has both.
function resolveColumns(headers) {
  const keys = headers.map(norm);
  const map = {};
  for (const [field, aliases] of Object.entries(ALIASES)) {
    // exact match first, then "header starts with alias" for things like "Amount (in Rs.)"
    let idx = -1;
    for (const a of aliases) { idx = keys.indexOf(a); if (idx >= 0) break; }
    if (idx < 0) {
      for (const a of aliases) {
        if (a.length <= 3) continue;
        idx = keys.findIndex((k) => k.startsWith(a));
        if (idx >= 0) break;
      }
    }
    if (idx >= 0) map[field] = idx;
  }
  return map;
}

export function readSheet(buffer, fileName = '') {
  const isText = /\.(csv|txt)$/i.test(fileName);
  // CSV/TXT are read as plain text: otherwise SheetJS reads 12/08/2026 as 8 December (US order),
  // and Indian registrar files are day-first. toISODate parses the text day-first.
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true, raw: isText });
  // Pick the sheet with the most rows (registrar exports sometimes ship a cover sheet).
  let best = null;
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: true });
    if (!best || rows.length > best.length) best = rows;
  }
  return best || [];
}

// Finds the header row (first row in the top 25 that matches at least 2 known fields).
export function tabulate(rows, required = []) {
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const cols = resolveColumns(rows[i].map(String));
    const hits = Object.keys(cols).length;
    if (hits >= 2 && required.every((r) => r in cols)) {
      const data = rows.slice(i + 1).filter((r) => r.some((c) => String(c).trim() !== ''));
      return { cols, headers: rows[i].map(String), data };
    }
  }
  return null;
}

const get = (row, cols, f) => (f in cols ? row[cols[f]] : '');

// KFintech's "Fund" column is a code (e.g. 127), so when the scheme name starts with a known
// fund house, use that name; names match what AMC codes standardize to.
export const FUND_HOUSES = [
  ['ADITYA BIRLA', 'ADITYA BIRLA SUN LIFE'], ['ABSL', 'ADITYA BIRLA SUN LIFE'], ['AXIS', 'AXIS'], ['BANDHAN', 'BANDHAN'],
  ['BANK OF INDIA', 'BANK OF INDIA'], ['BARODA BNP', 'BARODA BNP PARIBAS'], ['BAJAJ FINSERV', 'BAJAJ FINSERV'],
  ['CANARA ROBECO', 'CANARA ROBECO'], ['DSP', 'DSP'], ['EDELWEISS', 'EDELWEISS'], ['FRANKLIN', 'FRANKLIN TEMPLETON'],
  ['HDFC', 'HDFC'], ['HSBC', 'HSBC'], ['HELIOS', 'HELIOS'], ['ICICI', 'ICICI PRUDENTIAL'], ['INVESCO', 'INVESCO'],
  ['ITI', 'ITI'], ['JIOBLACKROCK', 'JIO BLACKROCK'], ['JIO BLACKROCK', 'JIO BLACKROCK'], ['JM ', 'JM FINANCIAL'], ['KOTAK', 'KOTAK'], ['LIC', 'LIC'], ['MAHINDRA', 'MAHINDRA MANULIFE'],
  ['MIRAE', 'MIRAE'], ['MOTILAL', 'MOTILAL OSWAL'], ['NAVI', 'NAVI'], ['NIPPON', 'NIPPON INDIA'], ['NJ ', 'NJ'],
  ['OLD BRIDGE', 'OLD BRIDGE'], ['PARAG PARIKH', 'PPFAS'], ['PPFAS', 'PPFAS'], ['PGIM', 'PGIM INDIA'], ['QUANTUM', 'QUANTUM'],
  ['QUANT ', 'QUANT'], ['SAMCO', 'SAMCO'], ['SBI', 'SBI'], ['SHRIRAM', 'SHRIRAM'], ['SUNDARAM', 'SUNDARAM'], ['TATA', 'TATA'],
  ['TAURUS', 'TAURUS'], ['TRUST', 'TRUST'], ['UNION', 'UNION'], ['UTI', 'UTI'], ['WHITEOAK', 'WHITEOAK CAPITAL'],
  ['360 ONE', '360 ONE'], ['GROWW', 'GROWW'], ['ZERODHA', 'ZERODHA'],
];
// Fund house a scheme name starts with ("SBI Long Term Fund" -> SBI), or ''.
export function fundHouseOf(scheme) {
  const u = upper(scheme);
  const hit = u && FUND_HOUSES.find(([p]) => u.startsWith(p));
  return hit ? hit[1] : '';
}
function amcOf(row, cols) {
  const scheme = upper(get(row, cols, 'scheme'));
  const hit = scheme && FUND_HOUSES.find(([p]) => scheme.startsWith(p));
  return hit ? hit[1] : clean(get(row, cols, 'amc'));
}

export function parseTransactions(buffer, fileName) {
  const t = tabulate(readSheet(buffer, fileName), ['folio']);
  if (!t) throw new Error('Could not find a transaction header row (need at least a Folio column).');
  return t.data.map((r) => ({
    folio: clean(get(r, t.cols, 'folio')),
    investor: clean(get(r, t.cols, 'investor')),
    pan: upper(get(r, t.cols, 'pan')),
    amc: amcOf(r, t.cols),
    scheme: clean(get(r, t.cols, 'scheme')),
    scheme_code: upper(get(r, t.cols, 'schemeCode')),
    trxn_date: toISODate(get(r, t.cols, 'date')),
    trxn_type: clean(get(r, t.cols, 'type')),
    amount: num(get(r, t.cols, 'amount')),
    units: num(get(r, t.cols, 'units')),
    nav: num(get(r, t.cols, 'nav')),
  })).filter((r) => r.folio);
}

export function parseFolioMaster(buffer, fileName) {
  const t = tabulate(readSheet(buffer, fileName), ['folio']);
  if (!t) throw new Error('Could not find a folio master header row (need a Folio column).');
  return t.data.map((r) => ({
    folio: clean(get(r, t.cols, 'folio')),
    investor: clean(get(r, t.cols, 'investor')),
    pan: upper(get(r, t.cols, 'pan')),
    email: clean(get(r, t.cols, 'email')).toLowerCase(),
    mobile: clean(get(r, t.cols, 'mobile')),
    amc: amcOf(r, t.cols),
    scheme: clean(get(r, t.cols, 'scheme')),
    scheme_code: upper(get(r, t.cols, 'schemeCode')),
  })).filter((r) => r.folio);
}

export function parseBrokerage(buffer, fileName) {
  const t = tabulate(readSheet(buffer, fileName), ['folio', 'brokerage']);
  if (!t) throw new Error('Could not find a brokerage header row (need Folio and Brokerage columns).');
  return t.data.map((r) => ({
    folio: clean(get(r, t.cols, 'folio')),
    investor: clean(get(r, t.cols, 'investor')),
    pan: upper(get(r, t.cols, 'pan')),
    amc: amcOf(r, t.cols),
    scheme: clean(get(r, t.cols, 'scheme')),
    scheme_code: upper(get(r, t.cols, 'schemeCode')),
    trxn_date: toISODate(get(r, t.cols, 'date')),
    trxn_type: clean(get(r, t.cols, 'type')),
    amount: num(get(r, t.cols, 'brokerage')),
    aum: num(get(r, t.cols, 'aum')),
  })).filter((r) => r.folio);
}

export function parsePartner(buffer, fileName) {
  const t = tabulate(readSheet(buffer, fileName), ['code']);
  if (!t) throw new Error('Could not find a partner statement header row (need a Client Code column).');
  return t.data.map((r) => {
    const total = num(get(r, t.cols, 'total'));
    const mentor = num(get(r, t.cols, 'mentor'));
    const partnerShare = 'partnerShare' in t.cols ? num(get(r, t.cols, 'partnerShare')) : total - mentor;
    return {
      code: upper(get(r, t.cols, 'code')),
      client_name: clean(get(r, t.cols, 'investor')),
      segment: upper(get(r, t.cols, 'segment')) || 'GENERAL',
      total, mentor, partner_share: partnerShare,
    };
  }).filter((r) => r.code);
}

// Generic table (for bulk mapping, RM registrar files, payment imports, rate sheets).
export function parseTable(buffer, fileName) {
  const rows = readSheet(buffer, fileName);
  const t = tabulate(rows, []);
  if (!t) return { cols: {}, headers: [], data: [] };
  return t;
}
export { get as cell };
