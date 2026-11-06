# Demo data: what to check

Start from an empty database (Admin Console → System → Factory Reset, or stop the server and delete
`server/data`). Then, with the server running on port 5000, open a new terminal in the `wealthflow`
folder and run:

```
npm run seed:demo
```

Admin login: admin@wealthflow.com / Admin@123. Team logins: any email below with password `Welcome@123`.

## Team (Clients & Map → Hierarchy)

| Person | Email | Level | Reports to |
|---|---|---|---|
| Finowise Freedom LLP | finowise@example.com | L6 | (top) |
| PRIYA NAIR | priya@example.com | L5 | Finowise |
| ANMOL KUMAR JHA | anmol@example.com | L4 | Priya |
| RAVISANKAR K K | ravi@example.com | L3 | Anmol |
| DIVYA DILIP SHINDE | divya@example.com | L2 | Ravi |
| Johnson M John | johnson@example.com | L1 | Divya |
| KIRAN PATIL | kiran@example.com | L1 | Ravi (no L2) |
| SURESH MENON | suresh@example.com | L3 | Priya (no L4) |
| MEENA IYER | meena@example.com | L1 | Suresh |

## Payout cases (Reports & Payouts → Client-wise, or Payouts)

Each client's brokerage should split like this (L5/L6/L7 5% each first; the lead gets L1 25 / L2 50 / L3 75 and the rest of the 85% goes to the nearest L4+ manager):

| Client | Lead | Split |
|---|---|---|
| M V GOPINATH, K KAVITHA | Johnson L1 | Johnson 25, Anmol 60, Priya 5, Finowise 5, company 5 |
| R RAJAVASANTHAKUMARI, SHIV KUMAR | Kiran L1 | Kiran 25, Anmol 60, Priya 5, Finowise 5, company 5 |
| MISHA LALIT CHANDWANI, PRIYA KUSHWAHA | Divya L2 | Divya 50, Anmol 35, Priya 5, Finowise 5, company 5 |
| VARSHA UPENDRA PAREKH | Ravi L3 | Ravi 75, Anmol 10, Priya 5, Finowise 5, company 5 |
| SHILPA JOHNSON, SWATI KUMARI | Meena L1, no L4 | Meena 25, Priya 65 (5 + 60 as manager), Finowise 5, company 5 |
| REENA JOHNSON | not mapped | company 100 (shows in Reconciliation and "Clients with no RM") |

## Other things the demo sets up

- **Dashboard:** 3 months of brokerage (Jun–Aug 2026), redemptions, compliance alerts (Priya's ARN expires soon, Anmol's EUIN has expired, Johnson has no EUIN).
- **Imports & Data:** CAMS and Karvy transactions, folio masters and brokerage batches. Try deleting a batch, then restore it from Trash.
- **Reports → Approvals:** July invoices from Johnson, Kiran and Meena are waiting. June invoices for Johnson, Divya and Ravi are already approved.
- **Payouts:** June payments of ₹500 (Johnson) and ₹1,000 (Ravi) are recorded, so brought-forward and still-owed amounts show.
- **Admin Console → System:** June 2026 is locked, so recalculating leaves June untouched.
- **Partner Brokerage:** a MOFSL statement for July 2026.
- **Brokerage Rates:** upload `Sample rate sheet 2026-10.xlsx` from this folder.
- **Log in as Johnson** to see the RM view: only their own clients and earnings.

To start clean afterwards: Admin Console → System → Factory Reset (type RESET).
