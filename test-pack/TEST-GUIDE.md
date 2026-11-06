# Test pack: step-by-step check of every feature

All files use the real CAMS and KFintech column layouts (WBR9, WBR2, CAMS brokerage, MFSD211, MFSD201,
KFin brokerage). Names, PANs, GSTINs and amounts are made up. Do the steps in order: later figures
depend on earlier steps. Every figure below was checked by running this pack on a fresh app.

## 0. Start clean
Admin Console → System → Factory Reset (type RESET). This also removes team members.
Admin Console → Invoice: make sure **GST is off** and TDS is on at 2% (the defaults).

## 1. Team: Clients & Map → Hierarchy
Create these people (all in `Team list.xlsx`, password `Welcome@123`, role ops), top-down so
"Reports To" exists when you pick it. Give Johnson the GSTIN `27ABCPJ1234F1Z6` (dummy, Maharashtra).

| Full Name | Email | Code | Level | Reports To |
|---|---|---|---|---|
| Finowise Freedom LLP | finowise@example.com | ARN-270604 | L6 | (none) |
| PRIYA NAIR | priya@example.com | ARN-270607 | L5 | Finowise Freedom LLP |
| ANMOL KUMAR JHA | anmol@example.com | ARN-270605 | L4 | PRIYA NAIR |
| RAVISANKAR K K | ravi@example.com | ARN-270606 | L3 | ANMOL KUMAR JHA |
| DIVYA DILIP SHINDE | divya@example.com | WF-102 | L2 | ANMOL KUMAR JHA |
| Johnson M John | johnson@example.com | WF-101 | L1 | ANMOL KUMAR JHA |
| KIRAN PATIL | kiran@example.com | WF-103 | L1 | ANMOL KUMAR JHA |
| SURESH MENON | suresh@example.com | WF-104 | L3 | PRIYA NAIR |
| MEENA IYER | meena@example.com | WF-105 | L1 | PRIYA NAIR |

Every L1, L2 and L3 reports directly to an L4 or above: Ravi, Divya, Johnson and Kiran report to
Anmol (L4), and Meena reports to Priya (L5). There is no L7, so the L7 top share goes to the company.

## 2. Imports & Data: July and August (in this order)

| # | File | Tab | Source | Month | Expect |
|---|---|---|---|---|---|
| 1 | Aug-26 WBR9 Folio Master File.xlsx | Folio Master | CAMS | Aug 2026 | 7 rows, 6 new clients |
| 2 | Aug-26 211 Folio Master File.csv | Folio Master | Karvy | Aug 2026 | 4 rows, 4 new clients |
| 3 | Aug-26 WBR2 Trxn File.xlsx | Transactions | CAMS | Aug 2026 | 7 rows, ₹85,000 |
| 4 | Aug-26 201 Trxn File.csv | Transactions | Karvy | Aug 2026 | 5 rows, ₹30,000 |
| 5 | Jul-26 CAMS Brokerage File.xlsx | Brokerage | CAMS | **Jul 2026** | 6 rows, ₹6,300 |
| 6 | Jul-26 KFIN Brokerage File.csv | Brokerage | Karvy | **Jul 2026** | 4 rows, ₹3,600 |
| 7 | Aug-26 CAMS Brokerage File.xlsx | Brokerage | CAMS | Aug 2026 | 6 rows, ₹7,000 |
| 8 | Aug-26 CAMS SIF Brokerage File.xlsx | Brokerage | CAMS | Aug 2026 | 1 row, ₹500, variant SIF |
| 9 | Aug-26 KFIN Brokerage File.csv | Brokerage | Karvy | Aug 2026 | 4 rows, ₹4,000 |

Totals: July ₹9,900, August ₹11,500. Keep the two **Sep-26** brokerage files for step 6.

## 3. Map clients (with Lead By)
Reports & Payouts → Reconciliation → Bulk mapping: upload `Client mapping.xlsx`. The preview shows
9 changes, 0 errors, and a **Lead by** column. Apply.

| Client | RM | Lead By | What it tests |
|---|---|---|---|
| M V GOPINATH, K KAVITHA | Johnson (L1) | | L1 own lead |
| MISHA LALIT CHANDWANI | Divya (L2) | | L2 own lead |
| VARSHA UPENDRA PAREKH | Ravi (L3) | ANMOL KUMAR JHA | L4 lead passed to an L3 (+ SIF) |
| SHILPA JOHNSON, SWATI KUMARI | Meena (L1) | | L1 reporting to an L5 (Priya is manager) |
| PRIYA KUSHWAHA | Anmol (L4) | | L4 own lead keeps the whole 85% |
| R RAJAVASANTHAKUMARI | Kiran (L1) | ANMOL KUMAR JHA | L4 lead passed down |
| SHIV KUMAR | Meena (L1) | PRIYA NAIR | L5 lead passed to her direct report |
| REENA JOHNSON | (none) | | Unmapped, all to company |

Error check (optional): put an L1–L3 name in the Lead By column and preview again. That row is flagged
as an error, because only L4+ can pass a lead.

Lead brought by rules (Clients & Map → Clients → Map Account):
- Open K KAVITHA and pick Lead brought by ANMOL KUMAR JHA. The RM list shows only Anmol's direct
  reports (Johnson, Divya, Kiran, Ravi). Pick PRIYA NAIR instead: it shows Anmol, Suresh and Meena.
  Cancel without saving.
- Open SHIV KUMAR. Lead brought by shows PRIYA NAIR greyed out: once saved it can't be changed.
- Admin correction: still on SHIV KUMAR, click **Correct lead source**, pick ANMOL KUMAR JHA, RM KIRAN
  PATIL, type a reason and save (leave "re-split" ticked). August for Shiv becomes Anmol 550
  (250 lead + 300), Kiran 300 (50% of 600, as L2 by then), Priya 50, Finowise 50, company 50. Audit Log shows "Lead source corrected" with the old name, the new
  name and your reason. Saving without a reason is refused. Do this after step 8 if you want the step 4
  to 8 figures to match, or skip it.
- In a bulk mapping file, a Lead By that differs from the saved one, or an RM who isn't a direct report
  of the lead person, is flagged as an error. A blank Lead By cell keeps the saved one.

## 4. Expected payouts for July and August

Policy: L5, L6 and L7 get 5% each first (an empty level passes up; no L7 = company). From the other 85%,
an L1/L2/L3 lead gets 25/50/75% of the brokerage and the rest of the 85% goes to their nearest L4+
manager. An L4+ handling their own lead keeps all 85%. When an L4+ brought the lead and passed it to a direct
report, they take 25% first, the subordinate gets their 25/50/75% of the remaining 60%, and the rest of
the 85% goes back to the lead person as their manager.

| Person | July 2026 | August 2026 |
|---|---|---|
| ANMOL KUMAR JHA (L4) | 3,690 | 4,300 |
| PRIYA NAIR (L5) | 2,160 | 2,425 |
| Company (L7 share + Reena) | 1,350 | 1,525 |
| Johnson M John (L1) | 675 | 750 |
| RAVISANKAR K K (L3) | 405 | 675 |
| MEENA IYER (L1) | 585 | 650 |
| Finowise Freedom LLP (L6) | 450 | 525 |
| DIVYA DILIP SHINDE (L2) | 450 | 500 |
| KIRAN PATIL (L1) | 135 | 150 |
| **Total** | **9,900** | **11,500** |

August, one client of each kind (₹1,000 unless shown):
- Gopinath (Johnson, L1 own lead): Johnson 250, Anmol 600, Priya 50, Finowise 50, company 50
- Priya Kushwaha (Anmol, L4 own lead): Anmol 850, Priya 50, Finowise 50, company 50
- Rajavasanthakumari (Kiran, lead by Anmol): Anmol 700 (250 lead + 450 manager), Kiran 150 (25% of 600), Priya 50, Finowise 50, company 50
- Shiv Kumar (Meena, lead by Priya): Priya 750 (50 top + 250 lead + 450 manager), Meena 150 (25% of 600), Finowise 50, company 50
- Shilpa Johnson (Meena, reports to Priya): Meena 250, Priya 650, Finowise 50, company 50
- Varsha (Ravi L3, lead by Anmol, ₹1,500 incl. SIF): Anmol 600 (375 lead + 225 manager), Ravi 675 (75% of 900),
  Priya 75, Finowise 75, company 75
- Reena (unmapped): company 1,000

Where to see it: Reports → Team (month Aug 2026), Reports → Client-wise (columns Investor, PAN, Txs,
AUM, **Total Brokerage**; no My Share column), and Settings → Lead Source simulator.

## 5. Team logins (before step 6)
Log out and log in with each email and `Welcome@123`:
- johnson@example.com: 2 clients (Gopinath, Kavitha), August ₹750
- kiran@example.com: 1 client (Rajavasanthakumari), August ₹150
- meena@example.com: 3 clients (Shilpa Johnson, Swati Kumari, Shiv Kumar), August ₹650
- anmol@example.com: Anmol's 6 clients, August ₹4,300

## 6. Mapping changes apply only to new brokerage
Log back in as admin.
1. Clients & Map → M V GOPINATH → Map Account → RM **KIRAN PATIL**. Leave "re-split brokerage already
   received" unticked. Save.
2. Clients & Map → Hierarchy → edit KIRAN PATIL → Level **L2** (Reports To stays Anmol). Save. Kiran's 2 client
   mappings are rebuilt for future brokerage (Clients shows Kiran as L2).
3. Check Reports → Team for July and August: **exactly the same as step 4.**
4. Imports & Data → Brokerage, month **Sep 2026**: `Sep-26 CAMS Brokerage File.xlsx` (6 rows, ₹7,700)
   and `Sep-26 KFIN Brokerage File.csv` (4 rows, ₹4,400).

September uses the new mapping (Gopinath with Kiran, Kiran now L2):

| Person | September 2026 |
|---|---|
| ANMOL KUMAR JHA | 4,070 |
| PRIYA NAIR | 2,640 |
| Company | 1,650 |
| KIRAN PATIL (now L2) | 880 |
| MEENA IYER | 715 |
| Johnson M John | 550 |
| Finowise Freedom LLP | 550 |
| DIVYA DILIP SHINDE | 550 |
| RAVISANKAR K K | 495 |
| **Total** | **12,100** |

September clients (₹1,100 each, Kavitha ₹2,200):
- Gopinath: Kiran 550 (50% as L2), Anmol 385, Priya 55, Finowise 55, company 55
- Rajavasanthakumari: Anmol 605 (275 lead + 330), Kiran 330 (50% of 660), Priya 55, Finowise 55, company 55
- Shiv Kumar: Priya 825, Meena 165, Finowise 55, company 55
- Varsha: Ravi 495 (75% of 660), Anmol 440, Priya 55, Finowise 55, company 55
- Kavitha (still Johnson): Johnson 550, Anmol 1,320, Priya 110, Finowise 110, company 110

Johnson's login now shows only Kavitha; Kiran's shows 2 clients.

## 7. Payments (Payouts → Import payments)
- Month Aug 2026: `Payments Aug-26.xlsx`. 3 recorded (Johnson 500, Ravi 1,000, Divya 750).
- Month Sep 2026: `Payments Sep-26.xlsx`. 4 recorded, 1 skipped (RAMESH UNKNOWN). Rows given by code
  (WF-103 = Kiran, ARN-270605 = Anmol) match too.

Payouts ledger with GST off (TDS 2%):

| Month | Person | Brought fwd | Earned | Payable | Paid | Still owed |
|---|---|---|---|---|---|---|
| Aug | Johnson | 661.50 | 750 | 735 | 500 | 896.50 |
| Aug | Divya | 441 | 500 | 490 | 750 | 181 |
| Sep | Johnson | 896.50 | 550 | 539 | 400 | 1,035.50 |
| Sep | Kiran | 279.30 | 880 | 862.40 | 500 | 641.70 |

## 8. GST, TDS, settlement and approval
Reports → Monthly Payouts → pick Johnson M John:
- GST off: August share 750, TDS 15, net **735**
- Turn the blue GST toggle on at 18%: GST 135, net **870** (September: 550 + 99 − 11 = 638)
- Change GST to 12%: GST 90, net **825**. Set it back to 18%.
- Only an admin sees the toggle. Logged in as Johnson, it isn't there.
- Request settlement for August. Approvals shows "Johnson M John, Aug 2026, ₹870". Approve it, then open
  the tax invoice: CGST 9% + SGST 9% (Johnson and the firm are both in Maharashtra).

## 9. Other screens
- **Partner Brokerage**: `MOFSL statement Aug-26.xlsx`, partner MOFSL, Aug 2026 (3 clients, ₹2,500).
- **Brokerage Rates**: `Brokerage rate sheet Oct-26.xlsx` (10 schemes).
- **Dashboard**: 2 redemptions (K KAVITHA ₹25,000, PRIYA KUSHWAHA ₹10,000); fund categories Equity,
  Hybrid, Debt and Liquid.
- **Reports → Growth**: July ₹9,900, August ₹11,500, September ₹12,100.
- **Reconciliation**: REENA JOHNSON shows as a client with no RM.
- **Re-split old brokerage** (do this last, it changes August after approval): Gopinath → Map Account,
  RM Kiran, tick "re-split brokerage already received", save. August becomes Johnson 500, Kiran 650,
  Anmol 4,050 (others unchanged).
- **System → Lock months** up to Aug 2026, then Recalculate (do this after the re-split): July and August don't change.
