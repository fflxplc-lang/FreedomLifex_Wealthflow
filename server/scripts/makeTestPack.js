// Builds a test pack in the real CAMS / KFintech file formats (same headers, same file types)
// plus the extra files the app can import: client mapping, payments, partner statement, rates.
// Usage (from server/): npm run testpack   → writes ../test-pack/
import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';
import { HEADERS } from './registrarHeaders.js';

const OUT = path.resolve(process.cwd(), '../test-pack');
fs.mkdirSync(OUT, { recursive: true });

const sheet = (headers, rows) => XLSX.utils.aoa_to_sheet([headers, ...rows.map((o) => headers.map((h) => o[h] ?? ''))]);
const writeXlsx = (file, headers, rows) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet(headers, rows), 'Sheet1');
  XLSX.writeFile(wb, path.join(OUT, file));
};
const writeCsv = (file, headers, rows) => fs.writeFileSync(path.join(OUT, file), XLSX.utils.sheet_to_csv(sheet(headers, rows)));
const writeTable = (file, rows) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Sheet1');
  XLSX.writeFile(wb, path.join(OUT, file));
};

// The team to create in Clients & Map → Hierarchy. L1, L2 and L3 report directly to an L4 or above.
export const TEAM = [
  { name: 'Finowise Freedom LLP', email: 'finowise@example.com', code: 'ARN-270604', level: 6, parent: '' },
  { name: 'PRIYA NAIR', email: 'priya@example.com', code: 'ARN-270607', level: 5, parent: 'Finowise Freedom LLP' },
  { name: 'ANMOL KUMAR JHA', email: 'anmol@example.com', code: 'ARN-270605', level: 4, parent: 'PRIYA NAIR' },
  { name: 'RAVISANKAR K K', email: 'ravi@example.com', code: 'ARN-270606', level: 3, parent: 'ANMOL KUMAR JHA' },
  { name: 'DIVYA DILIP SHINDE', email: 'divya@example.com', code: 'WF-102', level: 2, parent: 'ANMOL KUMAR JHA' },
  { name: 'Johnson M John', email: 'johnson@example.com', code: 'WF-101', level: 1, parent: 'ANMOL KUMAR JHA' },
  { name: 'KIRAN PATIL', email: 'kiran@example.com', code: 'WF-103', level: 1, parent: 'ANMOL KUMAR JHA' },
  { name: 'SURESH MENON', email: 'suresh@example.com', code: 'WF-104', level: 3, parent: 'PRIYA NAIR' },
  { name: 'MEENA IYER', email: 'meena@example.com', code: 'WF-105', level: 1, parent: 'PRIYA NAIR' },
];

// Investors. CAMS rows use amc_code + scheme code; KFin rows use a numeric Fund code.
// aug / jul are the monthly trail brokerage (₹), September is aug + 10%; rm is who the client is mapped to,
// lb is the L4+ who brought the lead and passed it to the rm, one of their direct reports.
export const INVESTORS = [
  { name: 'M V GOPINATH', pan: 'ACHPG9618F', email: 'mvg@example.com', mobile: '9876500005', city: 'Chennai', rta: 'CAMS', amc: 'H', code: '02', scheme: 'HDFC Flexi Cap Fund - Regular Growth', folio: '1045678/12', aum: 1800000, aug: 1000, jul: 900, rm: 'Johnson M John' },
  { name: 'K KAVITHA', pan: 'AMQPK3506H', email: 'kavitha@example.com', mobile: '9876500006', city: 'Coimbatore', rta: 'CAMS', amc: 'P', code: '8033', scheme: 'ICICI Prudential Bluechip Fund - Growth', folio: '2234567/45', aum: 3500000, aug: 2000, jul: 1800, rm: 'Johnson M John' },
  { name: 'R RAJAVASANTHAKUMARI', pan: 'AFXPR4462D', email: 'rvk@example.com', mobile: '9876500003', city: 'Madurai', rta: 'CAMS', amc: 'K', code: '12', scheme: 'Kotak Emerging Equity Fund - Growth', folio: '3345678/01', aum: 1600000, aug: 1000, jul: 900, rm: 'KIRAN PATIL', lb: 'ANMOL KUMAR JHA' },
  { name: 'MISHA LALIT CHANDWANI', pan: 'ASAPT5820B', email: 'misha@example.com', mobile: '9876500004', city: 'Mumbai', rta: 'CAMS', amc: 'B', code: '92', scheme: 'Aditya Birla Sun Life Liquid Fund - Growth', folio: '4456789/23', aum: 9000000, aug: 1000, jul: 900, rm: 'DIVYA DILIP SHINDE' },
  { name: 'VARSHA UPENDRA PAREKH', pan: 'BXPPP1234K', email: 'varsha@example.com', mobile: '9876500007', city: 'Ahmedabad', rta: 'CAMS', amc: 'L', code: '102', scheme: 'SBI Equity Hybrid Fund - Regular Growth', folio: '5567890/34', aum: 1700000, aug: 1000, jul: 900, rm: 'RAVISANKAR K K', lb: 'ANMOL KUMAR JHA', sif: { code: '900', scheme: 'SBI Magnum Hybrid Long-Short SIF - Growth', aum: 1000000, aug: 500 } },
  { name: 'SHILPA JOHNSON', pan: 'ATIPJ8616N', email: 'shilpa@example.com', mobile: '9876500001', city: 'Kochi', rta: 'CAMS', amc: 'D', code: '35', scheme: 'DSP Corporate Bond Fund - Growth', folio: '6678901/56', aum: 2400000, aug: 1000, jul: 900, rm: 'MEENA IYER' },
  { name: 'SHIV KUMAR', pan: 'AIMPK5903C', email: 'shiv@example.com', mobile: '9876500010', city: 'Patna', rta: 'KARVY', fund: '127', code: 'MOMC', scheme: 'Motilal Oswal Midcap Fund - Regular Growth', folio: '9104567801', aum: 1500000, aug: 1000, jul: 900, rm: 'MEENA IYER', lb: 'PRIYA NAIR' },
  { name: 'PRIYA KUSHWAHA', pan: 'DDLPK3683L', email: 'priyak@example.com', mobile: '9876500008', city: 'Lucknow', rta: 'KARVY', fund: '128', code: 'AXBC', scheme: 'Axis Bluechip Fund - Regular Growth', folio: '9104567802', aum: 1650000, aug: 1000, jul: 900, rm: 'ANMOL KUMAR JHA' },
  { name: 'SWATI KUMARI', pan: 'CVPPK1023B', email: 'swati@example.com', mobile: '9876500009', city: 'Ranchi', rta: 'KARVY', fund: 'RMF', code: 'NIGF', scheme: 'Nippon India Growth Fund - Growth', folio: '9104567803', aum: 1550000, aug: 1000, jul: 900, rm: 'MEENA IYER' },
  { name: 'REENA JOHNSON', pan: 'AKTPJ6880A', email: 'reena@example.com', mobile: '9876500002', city: 'Pune', rta: 'KARVY', fund: '117', code: 'MALC', scheme: 'Mirae Asset Large Cap Fund - Regular Growth', folio: '9104567804', aum: 1450000, aug: 1000, jul: 900, rm: '' },
];
for (const i of INVESTORS) i.sep = Math.round(i.aug * 1.1);
const cams = INVESTORS.filter((i) => i.rta === 'CAMS');
const kfin = INVESTORS.filter((i) => i.rta === 'KARVY');

// ---------- Folio masters ----------
writeXlsx('Aug-26 WBR9 Folio Master File.xlsx', HEADERS.WBR9, cams.flatMap((i) => [i, ...(i.sif ? [{ ...i, code: i.sif.code, scheme: i.sif.scheme }] : [])]).map((i) => ({
  foliochk: i.folio, inv_name: i.name, address1: '12, Main Road', city: i.city, pincode: '600001', product: i.amc + i.code, sch_name: i.scheme,
  rep_date: '31/08/2026', email: i.email, holding_nature: 'SI', pan_no: i.pan, tax_status: 'Individual', broker_code: 'ARN-270604',
  mobile_no: i.mobile, amc_code: i.amc, country: 'India',
})));
writeCsv('Aug-26 211 Folio Master File.csv', HEADERS.K211, kfin.map((i) => ({
  'Product Code': i.code, Fund: i.fund, Folio: i.folio, 'Fund Description': i.scheme, 'Investor Name': i.name, 'Address #1': '45, Park Street',
  City: i.city, Pincode: '800001', State: 'India', Country: 'India', 'Date of Birth': '15/06/1982', 'Tax Status': 'Individual', Email: i.email,
  'Broker Code': 'ARN-270604', 'Report Date': '31/08/2026', 'PAN Number': i.pan, 'Mobile Number': i.mobile,
})));

// ---------- Transactions (August): a purchase or SIP for everyone, two redemptions ----------
const camsTx = [];
cams.forEach((i, n) => {
  camsTx.push({ amc_code: i.amc, folio_no: i.folio, prodcode: i.amc + i.code, scheme: i.scheme, inv_name: i.name, trxntype: n % 2 ? 'SIN' : 'P', trxnno: String(810000 + n), trxnmode: 'N', trxnstat: 'OK', traddate: `0${n + 2}/08/2026`, postdate: `0${n + 3}/08/2026`, purprice: '52.4', units: (10000 / 52.4).toFixed(3), amount: 10000, brokcode: 'ARN-270604', rep_date: '31/08/2026', pan: i.pan });
});
camsTx.push({ amc_code: 'P', folio_no: '2234567/45', prodcode: 'P8033', scheme: 'ICICI Prudential Bluechip Fund - Growth', inv_name: 'K KAVITHA', trxntype: 'R', trxnno: '810099', traddate: '21/08/2026', postdate: '22/08/2026', purprice: '98.1', units: '254.842', amount: 25000, brokcode: 'ARN-270604', rep_date: '31/08/2026', pan: 'AMQPK3506H' });
writeXlsx('Aug-26 WBR2 Trxn File.xlsx', HEADERS.WBR2, camsTx);

const kfinTx = kfin.map((i, n) => ({
  'Product Code': i.code, Fund: i.fund, 'Folio Number': i.folio, 'Scheme Code': i.code.slice(2), 'Fund Description': i.scheme, 'Transaction Head': 'Purchase',
  'Transaction Number': String(920000 + n), 'Investor Name': i.name, 'Transaction Status': 'Active', 'Transaction Date': `1${n}/08/2026`, 'Process Date': `1${n}/08/2026`,
  Price: '61.25', Units: (5000 / 61.25).toFixed(3), Amount: 5000, 'Agent Code': 'ARN-270604', 'Report Date': '31/08/2026',
  'Transaction Description': n % 2 ? 'Systematic Investment' : 'Purchase', 'Transaction Type': n % 2 ? 'SIN' : 'NEW', Nav: '61.25', PAN1: i.pan,
}));
kfinTx.push({ 'Product Code': 'AXBC', Fund: '128', 'Folio Number': '9104567802', 'Scheme Code': 'BC', 'Fund Description': 'Axis Bluechip Fund - Regular Growth', 'Transaction Head': 'Redemption', 'Transaction Number': '920099', 'Investor Name': 'PRIYA KUSHWAHA', 'Transaction Date': '25/08/2026', 'Process Date': '25/08/2026', Price: '58.10', Units: '172.117', Amount: 10000, 'Agent Code': 'ARN-270604', 'Transaction Description': 'Redemption', 'Transaction Type': 'RED', Nav: '58.10', PAN1: 'DDLPK3683L' });
writeCsv('Aug-26 201 Trxn File.csv', HEADERS.K201, kfinTx);

// ---------- Brokerage (July and August) ----------
const camsBrk = (month, mm, key, list) => list.map((i, n) => ({
  amc_code: i.amc, proc_date: `05/${String(Number(mm) + 1).padStart(2, '0')}/2026`, folio_no: i.folio, scheme_code: i.code, trxn_type: 'TRAIL', trxn_no: String(700000 + n),
  post_date: `${month === 'Jul' ? 31 : 31}/${mm}/2026`, brok_code: 'ARN-270604', brkage_type: 'TRAIL', brkage_rate: '0.65', brkage_amt: i[key],
  brkage_from: `01/${mm}/2026`, brkage_to: `31/${mm}/2026`, trxn_desc: 'Trail Commission', avg_assets: i.aum, no_of_days: 31, inv_name: i.name,
  brokerage_acrual_month: `${mm}2026`,
}));
const sifRows = (key) => cams.filter((i) => i.sif).map((i) => ({ ...i, code: i.sif.code, aum: i.sif.aum, [key]: i.sif.aug }));
writeXlsx('Aug-26 CAMS Brokerage File.xlsx', HEADERS.CAMSBRK, camsBrk('Aug', '08', 'aug', cams));
writeXlsx('Aug-26 CAMS SIF Brokerage File.xlsx', HEADERS.CAMSBRK, camsBrk('Aug', '08', 'aug', sifRows('aug')));
writeXlsx('Jul-26 CAMS Brokerage File.xlsx', HEADERS.CAMSBRK, camsBrk('Jul', '07', 'jul', cams));
writeXlsx('Sep-26 CAMS Brokerage File.xlsx', HEADERS.CAMSBRK, camsBrk('Sep', '09', 'sep', cams).map((r) => ({ ...r, post_date: '30/09/2026', brkage_to: '30/09/2026', no_of_days: 30 })));

const kfinBrk = (mm, key) => kfin.map((i, n) => ({
  'Product Code': i.code, 'Fund Description': i.scheme, Fund: i.fund, Scheme: i.code.slice(2), Plan: 'RG', Option: 'G', 'Account Number': i.folio,
  'Investor Name': i.name, City: i.city, 'Transaction Description': 'Trail Brokerage', 'From Date': `01/${mm}/2026`, 'To Date': `31/${mm}/2026`,
  'Transaction Date': `31/${mm}/2026`, 'Process Date': `05/${String(Number(mm) + 1).padStart(2, '0')}/2026`, 'Percentage (%)': '0.70',
  'Brokerage (in Rs.)': i[key], 'Brokerage Head': 'TRAIL', 'Transaction Number': String(500000 + n), 'Average Assets': i.aum,
  'Brokerage Type': 'Trail', GrossBrokerage: i[key], 'Broker Code': 'ARN-270604', InvPAN: i.pan, BrkPAN: 'AAICN8490L',
}));
writeCsv('Aug-26 KFIN Brokerage File.csv', HEADERS.KFINBRK, kfinBrk('08', 'aug'));
writeCsv('Jul-26 KFIN Brokerage File.csv', HEADERS.KFINBRK, kfinBrk('07', 'jul'));
writeCsv('Sep-26 KFIN Brokerage File.csv', HEADERS.KFINBRK, kfinBrk('09', 'sep').map((r) => ({ ...r, 'To Date': '30/09/2026', 'Transaction Date': '30/09/2026' })));

// ---------- Files for the other import screens ----------
writeTable('Team list.xlsx', TEAM.map((u) => ({ 'Full Name': u.name, 'Access Email': u.email, 'Employee/ARN Code': u.code, Level: `L${u.level}`, 'Reports To': u.parent || '(none)', Password: 'Welcome@123', Role: 'ops', GSTIN: u.code === 'WF-101' ? '27ABCPJ1234F1Z6' : '' })));
writeTable('Client mapping.xlsx', INVESTORS.filter((i) => i.rm).map((i) => ({ 'Client Name': i.name, PAN: i.pan, 'RM Name': i.rm, 'Lead By': i.lb || '' })));
writeTable('Payments Aug-26.xlsx', [
  { 'RM Name': 'Johnson M John', Amount: 500, Date: '10/09/2026', Description: 'NEFT-TEST-001' },
  { 'RM Name': 'RAVISANKAR K K', Amount: 1000, Date: '10/09/2026', Description: 'NEFT-TEST-002' },
  { 'RM Name': 'DIVYA DILIP SHINDE', Amount: 750, Date: '12/09/2026', Description: 'NEFT-TEST-003' },
]);
writeTable('Payments Sep-26.xlsx', [
  { 'RM Name': 'Johnson M John', Amount: 400, Date: '08/10/2026', Description: 'NEFT-SEP-001' },
  { 'RM Name': 'WF-103', Amount: 500, Date: '08/10/2026', Description: 'NEFT-SEP-002' },
  { 'RM Name': 'ARN-270605', Amount: 2000, Date: '09/10/2026', Description: 'NEFT-SEP-003' },
  { 'RM Name': 'PRIYA NAIR', Amount: 1000, Date: '09/10/2026', Description: 'NEFT-SEP-004' },
  { 'RM Name': 'RAMESH UNKNOWN', Amount: 999, Date: '10/10/2026', Description: 'NEFT-SEP-005' },
]);
writeTable('MOFSL statement Aug-26.xlsx', [
  { 'Client Code': 'MO1001', 'Client Name': 'M V GOPINATH', Segment: 'EQUITY', 'Total Brokerage': 1200, 'Mentor Brokerage': 600 },
  { 'Client Code': 'MO1002', 'Client Name': 'K KAVITHA', Segment: 'FNO', 'Total Brokerage': 800, 'Mentor Brokerage': 400 },
  { 'Client Code': 'MO1003', 'Client Name': 'SHIV KUMAR', Segment: 'COMMODITY', 'Total Brokerage': 500, 'Mentor Brokerage': 250 },
]);
writeTable('Brokerage rate sheet Oct-26.xlsx', INVESTORS.map((i) => ({ AMC: i.scheme.split(' ')[0], 'Scheme Name': i.scheme, Category: 'Equity', 'Trail Rate': 0.65 })));

console.log(`Test pack written to ${OUT}`);
