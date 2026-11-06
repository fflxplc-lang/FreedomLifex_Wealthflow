# Wealthflow — Freedom LifeX

Admin software for a mutual fund distributor: import CAMS and KFintech (Karvy) registrar files, map
clients to the RM hierarchy, calculate brokerage sharing, run settlements and track payouts.

**Stack:** React 19 + Vite (client) · Node.js 22 + Express 5 (API) · SQLite via Node's built-in
`node:sqlite` (no database server to install).

## Quick start

```bash
npm run install:all     # installs server and client packages
npm run dev             # API on http://localhost:5000, app on http://localhost:5173
```

Sign in with **admin@wealthflow.com / Admin@123** (change it in Admin Console → Profile or with
`ADMIN_EMAIL` / `ADMIN_PASSWORD` in `server/.env` before first boot).

To try it with sample data, keep `npm run dev` running and in a second terminal:

```bash
npm run samples         # writes sample CAMS / Karvy / MOFSL files into ./samples
API_URL=http://localhost:5000/api npm run seed:demo
```

That creates a five-person team (password `Welcome@123`) and imports three months of data.

## Production

```bash
npm run build           # builds the React app into client/dist
npm start               # Express serves the API and the built app on PORT (default 5000)
```

Copy `server/.env.example` to `server/.env` and set a long `JWT_SECRET`. The database is one file,
`server/data/wealthflow.db`; back that file up.

## What each section does

| Section | What it does |
|---|---|
| Login | Sign in with employee/ARN code or email. "Recovery?" notifies the admin. |
| Dashboard | Gross volume, payout pool, portfolio count, ARN/EUIN compliance alerts, top clients by AUM or brokerage, recent redemptions, revenue trend, top AMC/investor/scheme, fund category split, RM leaderboard. All / Month / Quarter / Year filter. Notifications bell, global search (⌘K), dark mode. |
| Imports & Data | Upload **Transactions** (CAMS WBR2 / Karvy MFSD201), **Folio Master** (CAMS WBR9 / Karvy MFSD211) and **Brokerage** (CAMS normal & SIF / Karvy) for a settlement month. Headers are auto-detected, duplicates dropped, AMC and scheme names standardized, clients created by PAN and folios linked. Batch History (with Re-map Unmapped) and Trash (restore / delete forever). |
| Clients & Map | **Hierarchy:** team accounts with level L1–L7, parent, sharing % (filled from the level's policy rate when the level is picked), extra levels, bank and address, Save vs Save & Recalculate. **Export** downloads every RM and mentor; **Import** creates accounts from an Excel file in the same layout (template inside, preview before creating, blank password = Welcome@123). Role **Mentor** sees their own data plus that of people who report directly to them ("Viewing" picker at the top). **Clients:** search, filters (No RM, No BM, No Folios, Folios with no client), map account by RM (fills managers from the reporting line) or level by level, add/edit/delete, Excel export. **Standardize:** duplicate detection by PAN, mobile, email, name with Keep as Master merge; editable AMC and scheme name maps. |
| Reports & Payouts | Summary, Monthly Payouts (GST/TDS toggles, tax invoice, request settlement), Client-wise, Logs, Team Payouts, Growth (MoM / QoQ / YoY / custom), Approvals Queue, Reconciliation (exceptions check, bulk mapping from Excel with preview, map RM from registrar file, unmapped transactions). Excel export on every table. |
| Brokerage Rates | Upload AMC brokerage PDFs (rates auto-extracted) or rate sheets; master list with history, edit, delete, export, reset. |
| Partner Brokerage | MOFSL (or any partner) statements, level-wise sharing %, attach client codes, by month / segment / client, payout per person. |
| Payouts | Ledger per person: brought forward, earned, GST, TDS, payable, paid, still owed; record or import payments; attribution health. |
| Audit Log | Every login, import, mapping and settings change, filterable and exportable. |
| Admin Console | Profile (bank, address, ARN/EUIN validity, GSTIN, signature), Global Rules (firm GST details), User Sharing overrides, Lead Source (brokerage sharing model with a try-it simulator), Activity Log, System (recalculate, lock months, folio ownership clean-up, assign folios, branch restructure, factory reset). |

## How brokerage is shared

Set in Admin Console → Lead Source. Defaults:

1. **Top share:** L7, L6 and L5 each get 5% of the total brokerage (15% in all). If a top level is not
   assigned on the client, its share moves up to the next level; L7 with nobody assigned is the company.
2. **Own lead:** L1, L2 and L3 report directly to an L4 or above. An L1/L2/L3 handling their own lead
   gets 25/50/75% of the brokerage and the rest of the 85% goes to their L4+ manager (none: company).
   An L4+ handling their own lead keeps the whole 85%.
3. **Lead passed down:** an L4+ who brought the lead ("Lead brought by" in Map Account) can hand it to
   a direct report. They get 25% of the brokerage first; the subordinate gets their 25/50/75% of
   the remaining 60%, and the rest of the 85% goes to the manager.
   "Lead brought by" is fixed once saved; an admin can correct it with a reason (audited).

Example, ₹1,000 with an L1 under Anmol (L4) and Priya (L5): L1's own lead → L1 250, Anmol 600,
Priya 50, L6 50, company 50. Anmol's lead passed to the L1 → L1 150 (25% of 600), Anmol 250 + 450, same top shares.

Mapping changes and level changes apply only to brokerage imported afterwards, unless "re-split
brokerage already received" is ticked in Map Account.

A person's own sharing % or a custom % in User Sharing replaces the global rate for their level.
Locked months are never recalculated. Level names: L1 Ninja, L2 Super Ninja, L3 Sherpa,
L4 Master Sherpa, L5 Monks, L6 Zen Monks, L7 Company.

## Registrar file columns

Headers are matched by name, so column order does not matter. Recognized names include:

- Folio: `FOLIO_NO`, `Folio Number`, `Folio No`, `FOLIOCHK`
- Investor: `INV_NAME`, `Investor Name` · PAN: `PAN`, `PAN1`, `PAN_NO`, `PAN Number`
- Scheme: `SCHEME`, `SCHEME_NAME`, `Scheme Description`, `Fund Description` · AMC: `AMC_CODE`, `AMC_NAME`, `Fund Name`
- Date: `TRADDATE`, `Transaction Date`, `Brokerage Date` · Type: `TRXNTYPE`, `Transaction Description`
- Amount: `AMOUNT` · Brokerage: `BROK_AMT`, `Brokerage`, `Brokerage (in Rs.)` · AUM: `AVG_ASSETS`, `Average Assets`

If a real file uses a header that is not picked up, add it to `ALIASES` in
`server/src/parsers/registrar.js`.

## Project layout

```
server/  src/index.js         Express app
         src/db.js            schema, settings, first admin
         src/routes/*.js      one file per section
         src/services/        payout engine, folio→client mapping
         src/parsers/         CAMS / Karvy / partner parsers
         scripts/             sample files and demo seed
client/  src/pages/*.jsx      one page per sidebar item
         src/ui.jsx           shared components and formatters
```
