// Generates sample CAMS / KFintech (Karvy) files in ../samples so imports can be tried
// without real registrar data. Run: node scripts/makeSamples.js
import XLSX from 'xlsx';
import fs from 'node:fs';
import path from 'node:path';

const out = path.resolve(process.cwd(), '../samples');
fs.mkdirSync(out, { recursive: true });

const investors = [
  ['SHILPA JOHNSON', 'ATIPJ8616N', 'shilpa.j@example.com', '9876500001'],
  ['REENA JOHNSON', 'AKTPJ6880A', 'reena.j@example.com', '9876500002'],
  ['R RAJAVASANTHAKUMARI', 'AFXPR4462D', '', '9876500003'],
  ['MISHA LALIT CHANDWANI', 'ASAPT5820B', 'misha@example.com', ''],
  ['M V GOPINATH', 'ACHPG9618F', 'mvg@example.com', '9876500005'],
  ['K KAVITHA', 'AMQPK3506H', '', '9876500006'],
  ['VARSHA UPENDRA PAREKH', 'BXPPP1234K', 'varsha@example.com', '9876500007'],
  ['PRIYA KUSHWAHA', 'DDLPK3683L', '', '9876500008'],
  ['SWATI KUMARI', 'CVPPK1023B', 'swati@example.com', ''],
  ['SHIV KUMAR', 'AIMPK5903C', '', '9876500010'],
];
const schemes = [
  ['MIRAE', 'Mirae Asset Large and Midcap Fund - Regular Plan Growth', 0.0072],
  ['HDFC', 'HDFC Mid Cap Fund - Regular Plan - Growth', 0.0068],
  ['SBI', 'SBI Contra Fund - Regular Plan - Growth', 0.0075],
  ['P', 'ICICI Prudential Multi-Asset Fund - Growth', 0.0061],
  ['PP', 'Parag Parikh Liquid Fund Regular Plan Growth', 0.0012],
  ['K', 'Kotak Multicap Fund Regular Plan - Growth', 0.0080],
  ['D', 'DSP Banking and PSU Debt Fund - Regular Growth', 0.0038],
  ['F', 'Franklin India Gilt Fund - Growth', 0.0045],
];
const folioOf = (i, s) => String(10000000 + i * 1013 + s * 7);
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const write = (name, rows) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Sheet1');
  XLSX.writeFile(wb, path.join(out, name));
};

const months = ['2026-06', '2026-07', '2026-08'];
// Investors 0-5 are serviced via CAMS, 6-9 via KFintech.
const holdings = investors.flatMap((inv, i) => [i % schemes.length, (i + 3) % schemes.length].map((s) => ({ i, s, aum: Math.round(50000 + rand() * 2500000) })));

const camsTx = [], karvyTx = [];
for (const h of holdings) {
  const [name, pan] = investors[h.i];
  const [amc, scheme] = schemes[h.s];
  for (const m of months) {
    const amount = Math.round(5000 + rand() * 50000);
    const redeem = rand() < 0.12;
    if (h.i < 6) camsTx.push({ FOLIO_NO: folioOf(h.i, h.s), INV_NAME: name, PAN: pan, AMC_CODE: amc, SCHEME: scheme, TRADDATE: `15/${m.slice(5)}/${m.slice(0, 4)}`, TRXNTYPE: redeem ? 'R' : 'P', TRXN_TYPE_DESC: redeem ? 'Redemption' : 'Purchase', AMOUNT: amount, UNITS: (amount / 52.4).toFixed(3) });
    else karvyTx.push({ 'Folio Number': folioOf(h.i, h.s), 'Investor Name': name, PAN1: pan, 'Fund Name': amc, 'Scheme Description': scheme, 'Transaction Date': `15-${['Jun', 'Jul', 'Aug'][months.indexOf(m)]}-2026`, 'Transaction Description': redeem ? 'Redemption' : 'Systematic Investment', Amount: amount, Units: (amount / 31.7).toFixed(3) });
  }
}
write('CAMS WBR2 transactions Jun-Aug 2026.xlsx', camsTx);
write('Karvy MFSD201 transactions Jun-Aug 2026.xlsx', karvyTx);

write('CAMS WBR9 folio master.xlsx', holdings.filter((h) => h.i < 6).map((h) => ({ FOLIOCHK: folioOf(h.i, h.s), INV_NAME: investors[h.i][0], PAN_NO: investors[h.i][1], EMAIL: investors[h.i][2], MOBILE_NO: investors[h.i][3], AMC_CODE: schemes[h.s][0] })));
write('Karvy MFSD211 folio master.xlsx', holdings.filter((h) => h.i >= 6).map((h) => ({ Folio: folioOf(h.i, h.s), 'Investor Name': investors[h.i][0], 'PAN Number': investors[h.i][1], Email: investors[h.i][2], Mobile: investors[h.i][3], 'Fund Name': schemes[h.s][0] })));

for (const m of months) {
  const label = { '2026-06': 'June', '2026-07': 'July', '2026-08': 'Aug' }[m];
  const cams = [], karvy = [];
  for (const h of holdings) {
    const [name, pan] = investors[h.i];
    const [amc, scheme, rate] = schemes[h.s];
    const aum = Math.round(h.aum * (1 + (months.indexOf(m) * 0.02)));
    const brok = +(aum * rate / 12).toFixed(3);
    if (h.i < 6) cams.push({ FOLIO_NO: folioOf(h.i, h.s), INV_NAME: name, PAN: pan, AMC_NAME: amc, SCHEME_NAME: scheme, TRADDATE: `${m}-28`, TRXN_TYPE: 'TRAIL', AVG_ASSETS: aum, BROK_AMT: brok });
    else karvy.push({ 'Folio No': folioOf(h.i, h.s), 'Investor Name': name, 'PAN': pan, 'Fund Name': amc, 'Scheme Name': scheme, 'Brokerage Date': `28-${label.slice(0, 3)}-2026`, 'Average Assets': aum, 'Brokerage (in Rs.)': brok });
  }
  // One folio nobody knows about, to show up in reconciliation.
  cams.push({ FOLIO_NO: '91057328245', INV_NAME: '', PAN: '', AMC_NAME: 'HDFC', SCHEME_NAME: schemes[1][1], TRADDATE: `${m}-28`, TRXN_TYPE: 'TRAIL', AVG_ASSETS: 120000, BROK_AMT: 68.5 });
  write(`${label}- 26 CAMS brokerage.xlsx`, cams);
  write(`${label}- 26 Kfin brokerage.xlsx`, karvy);
}

write('MOFSL statement Jul-2026.xlsx', [
  { 'Client Code': 'MO1001', 'Client Name': 'SHILPA JOHNSON', Segment: 'NSE-DR', 'Total Brokerage': 6240, 'Mentor Brokerage': 4056, 'Partner Brokerage': 2184 },
  { 'Client Code': 'MO1002', 'Client Name': 'M V GOPINATH', Segment: 'NSE-FO', 'Total Brokerage': 18500, 'Mentor Brokerage': 11100, 'Partner Brokerage': 7400 },
  { 'Client Code': 'MO1003', 'Client Name': 'NEW TRADER', Segment: 'BSE-CM', 'Total Brokerage': 900, 'Mentor Brokerage': 540, 'Partner Brokerage': 360 },
]);

write('Sample rate sheet 2026-10.xlsx', schemes.map(([amc, scheme, rate]) => ({ AMC: amc, 'Scheme Name': scheme, 'Gross Rate': +(rate * 100).toFixed(2) })));
console.log(`Sample files written to ${out}`);
