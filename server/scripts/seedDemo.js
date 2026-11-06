// Loads a demo team and the sample files through the running API.
// Usage: npm start (in another terminal), then: npm run seed:demo
import fs from 'node:fs';
import path from 'node:path';

const API = process.env.API_URL || 'http://localhost:5000/api';
const SAMPLES = path.resolve(process.cwd(), '../samples');

async function call(method, url, body, isForm) {
  const res = await fetch(API + url, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(isForm ? {} : { 'content-type': 'application/json' }) },
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${url}: ${data.error}`);
  return data;
}
let token = null;

const login = await call('POST', '/auth/login', { login: process.env.ADMIN_EMAIL || 'admin@wealthflow.com', password: process.env.ADMIN_PASSWORD || 'Admin@123' });
token = login.token;

// One team that exercises every payout case of the sharing model:
//   Branch A (full chain): Finowise L6 > Priya L5 > Anmol L4 > Ravi L3 > Divya L2 > Johnson L1
//   Kiran L1 reports straight to Ravi L3 (no L2), so Ravi gets 50% on Kiran's leads.
//   Branch B (no L4): Suresh L3 reports to Priya L5, Meena L1 to Suresh, so Priya gets the remainder.
const soon = (days) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
const team = [
  { key: 'fin', name: 'Finowise Freedom LLP', email: 'finowise@example.com', code: 'ARN-270604', level: 6, arn: 'ARN-270604', arn_valid: soon(400), euin: 'E100001', euin_valid: soon(400) },
  { key: 'priya', name: 'PRIYA NAIR', email: 'priya@example.com', code: 'ARN-270607', level: 5, parent: 'fin', arn: 'ARN-270607', arn_valid: soon(20), euin: 'E100002', euin_valid: soon(300) },
  { key: 'anmol', name: 'ANMOL KUMAR JHA', email: 'anmol@example.com', code: 'ARN-270605', level: 4, parent: 'priya', arn: 'ARN-270605', arn_valid: soon(500), euin: 'E100003', euin_valid: soon(-5) },
  { key: 'ravi', name: 'RAVISANKAR K K', email: 'ravi@example.com', code: 'ARN-270606', level: 3, parent: 'anmol', arn: 'ARN-270606', arn_valid: soon(365), euin: 'E100004', euin_valid: soon(365) },
  { key: 'divya', name: 'DIVYA DILIP SHINDE', email: 'divya@example.com', code: 'WF-102', level: 2, parent: 'ravi', gst: '27ABCDE1234F1Z5', arn: 'ARN-270608', arn_valid: soon(365), euin: 'E100005', euin_valid: soon(365) },
  { key: 'johnson', name: 'Johnson M John', email: 'johnson@example.com', code: 'WF-101', level: 1, parent: 'divya', arn: 'ARN-270609', arn_valid: soon(365) },
  { key: 'kiran', name: 'KIRAN PATIL', email: 'kiran@example.com', code: 'WF-103', level: 1, parent: 'ravi', arn: 'ARN-270610', arn_valid: soon(365), euin: 'E100006', euin_valid: soon(365) },
  { key: 'suresh', name: 'SURESH MENON', email: 'suresh@example.com', code: 'WF-104', level: 3, parent: 'priya', arn: 'ARN-270611', arn_valid: soon(365), euin: 'E100007', euin_valid: soon(365) },
  { key: 'meena', name: 'MEENA IYER', email: 'meena@example.com', code: 'WF-105', level: 1, parent: 'suresh', arn: 'ARN-270612', arn_valid: soon(365), euin: 'E100008', euin_valid: soon(365) },
];
const ids = {};
const existing = await call('GET', '/users');
for (const u of team) {
  const found = existing.find((x) => x.email === u.email);
  if (found) { ids[u.key] = found.id; continue; }
  const created = await call('POST', '/users', { ...u, parent_id: u.parent ? ids[u.parent] : null, password: 'Welcome@123', role: 'ops' });
  ids[u.key] = created.id;
}

const up = async (file, kind, source, period) => {
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(path.join(SAMPLES, file))]), file);
  fd.append('kind', kind); fd.append('source', source); fd.append('period', period);
  const r = await call('POST', '/imports/upload', fd, true);
  console.log(`${file}: ${r.rows} rows`);
};
await up('CAMS WBR2 transactions Jun-Aug 2026.xlsx', 'transactions', 'CAMS', '2026-08');
await up('Karvy MFSD201 transactions Jun-Aug 2026.xlsx', 'transactions', 'KARVY', '2026-08');
await up('CAMS WBR9 folio master.xlsx', 'folio', 'CAMS', '2026-08');
await up('Karvy MFSD211 folio master.xlsx', 'folio', 'KARVY', '2026-08');
for (const [label, p] of [['June', '2026-06'], ['July', '2026-07'], ['Aug', '2026-08']]) {
  await up(`${label}- 26 CAMS brokerage.xlsx`, 'brokerage', 'CAMS', p);
  await up(`${label}- 26 Kfin brokerage.xlsx`, 'brokerage', 'KARVY', p);
}

// Map clients so each payout case has at least one client; the last one stays unmapped
// for the reconciliation screens.
const leads = ['johnson', 'johnson', 'kiran', 'kiran', 'divya', 'divya', 'ravi', 'meena', 'meena'];
const { rows } = await call('GET', '/clients?all=1');
for (const [i, c] of rows.entries()) {
  if (i === rows.length - 1) continue;
  await call('PUT', `/clients/${c.id}/map`, { rmId: ids[leads[i % leads.length]] });
}

// Some settlement history: June approved, part-paid and locked; July invoices waiting for approval.
for (const key of ['johnson', 'divya', 'ravi']) {
  await call('POST', '/reports/settlements', { userId: ids[key], period: '2026-06' });
}
for (const a of await call('GET', '/reports/approvals')) await call('POST', `/reports/approvals/${a.id}/approve`);
await call('POST', '/payouts/payments', { userId: ids.johnson, period: '2026-06', amount: 500, reference: 'NEFT-DEMO-001' });
await call('POST', '/payouts/payments', { userId: ids.ravi, period: '2026-06', amount: 1000, reference: 'NEFT-DEMO-002' });
await call('POST', '/settings/locks', { upTo: '2026-06' });
for (const key of ['johnson', 'kiran', 'meena']) {
  await call('POST', '/reports/settlements', { userId: ids[key], period: '2026-07' });
}

const fd = new FormData();
fd.append('file', new Blob([fs.readFileSync(path.join(SAMPLES, 'MOFSL statement Jul-2026.xlsx'))]), 'MOFSL statement Jul-2026.xlsx');
fd.append('partner', 'MOFSL'); fd.append('period', '2026-07');
await call('POST', '/partner/upload', fd, true);
console.log('Demo data loaded. Team logins use password Welcome@123 (e.g. johnson@example.com).');
