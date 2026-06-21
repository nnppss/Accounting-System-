# Phase 4 done — and the handover for Phase 5

**This is the live handover doc. Start here in a new session.** It records what Phase 4 delivered
(Bardana sub-ledger + staff/loading expenses), the new conventions, and the Phase 5 brief
(Bills + Party search). The load-bearing architecture rules live in **[phase2.md](phase2.md)
§2–§4** — read those first; they still hold verbatim.

Read order for a cold start:
1. **This file** (where we are + how to build the next phase).
2. **[phase2.md](phase2.md) §2–§4** — the architecture conventions, reusable building blocks, and the
   shared-contract boundary. Still 100% accurate; do not re-derive them.
3. [software.md](software.md) — *what* the app does. §3.11 Bills, §3.12 Party for Phase 5.
4. [architecture.md](architecture.md) — *how* it's built. §5 data model, §6 posting map, §7 engines.

Git baseline: Phase 0/1/2/3 are committed on `main` (latest commit `6368b49` — "Phase 3: loans,
interest engine, and cheque-clearing"). **Phase 4 is on the working tree, not yet committed** —
review, then commit.

---

## 0. TL;DR status

| Phase | Scope | State |
|---|---|---|
| 0 | Electron+React+SQLite scaffold, IPC, i18n, CI | ✅ done (phase0.md) |
| 1 | Ledger core: PostingService, Trial Balance, Auth, Account Manager, Money Book, vouchers | ✅ done & tested |
| 2 | Stock: Store layout, Aamad, Maps, Sauda, Nikasi, Bhada engine | ✅ done & tested |
| 3 | Money depth: Loans + interest engine + cheque-clearing | ✅ done & tested |
| 4 | **Bardana sub-ledger + staff salaries + loading-contractor expenses** | ✅ **done & tested (this doc)** |
| 5 | **Views & insights: Bills + Party search** | ⏭ **next — §6 below** |

**71 tests green** (was 61; +10 in Phase 4), `npm run typecheck` + `npm run build` clean. Repo is
left on the **Electron ABI** (`npm run dev` works now). Login: **admin / admin123**.

Still never verified by an agent (carried over since Phase 2): (a) a manual GUI click-through;
(b) the Windows CI installer actually building green on GitHub Actions.

---

## 1. The ABI dance (unchanged — READ before running anything)

`better-sqlite3` is native; its binary must match the runtime ABI.

| Task | Command |
|---|---|
| `npm test` / `vitest` | `npm rebuild better-sqlite3` **first** (Node ABI) |
| `npm run dev` (the app) | `npm run rebuild` **first** (Electron ABI) |
| `npm run typecheck` / `npm run build` / `npm run db:generate` | run anytime |

The repo is currently on the **Electron ABI**. To run tests: `npm rebuild better-sqlite3 && npm test`,
then `npm run rebuild` to use the app again. Tests use `:memory:` DBs.

---

## 2. What Phase 4 delivered

**Schema (`schema.ts`, migration `0003_tan_nehzno.sql`) — now 21 tables:**
- `bardana` — `id, yearId, direction('purchase'|'issue'), date, partyAccountId?, ratePaise, qty,
  amountPaise (= ratePaise × qty), mode('cash'|'bank'), bankAccountId?, voucherId?, createdAt`.
  Index `(yearId, direction)`.
- New enums in `shared/enums.ts`: `BARDANA_DIRECTIONS = ['purchase','issue']`, **`PAYMENT_MODES =
  ['cash','bank']`** (a generic settlement mode, kept distinct from `LOAN_MODES` so loans stay
  untouched) — both re-exported from `schema.ts`.
- `loading_contractor_year` (existed since Phase 1, unused) is now **wired** — no new table for it.
- `db.test.ts` table count bumped 20 → **21**.

**Seed (`seed.ts`):** unchanged. The four heads Phase 4 posts to — `BARDANA_SALES`,
`BARDANA_PURCHASE`, `SALARY_EXPENSE`, `LOADING_EXPENSE` — were **already seeded** in Phase 1.

**Bardana service (`services/bardana.ts`):**
- `createBardana(yearId, BardanaInput, userId?)` — one transaction: writes the `bardana` row and
  posts via `postCore`. **purchase** → Dr Bardana Purchase / Cr Cash-Bank (a `payment`);
  **issue** → Dr Cash-Bank / Cr Bardana Sales (a `receipt`). tag `general`, `sourceModule 'bardana'`.
- `listBardana(yearId, direction?)` — all transactions newest-first, party + bank names resolved.
- `getBardanaAccount(yearId)` — the **A/C**: two lists (purchases/issues) + totals + **stock count
  = Σpurchased − Σissued (pieces)** + **profit = Σsales − Σpurchases (paise)**. Pure aggregate.

**Expense service (`services/expenses.ts`):**
- `paySalary(yearId, ExpensePaymentInput, userId?)` — Dr **Salary Expense** / Cr Cash-Bank,
  `sourceModule 'salary'`, `sourceId = staffAccountId`.
- `payLoadingContractor(yearId, ExpensePaymentInput, userId?)` — Dr **Loading Expense** / Cr
  Cash-Bank, `sourceModule 'loading'`, `sourceId = contractorAccountId`.
- `listSalaryRegister` / `listLoadingRegister(yearId)` — per-party register (groups the
  `sourceModule`-tagged vouchers, attributes each to its `sourceId` account).
- `getLoadingContractorYear(accountId, yearId)` (defaults to zeros), `setLoadingContractorYear`
  (upsert via `onConflictDoUpdate`), `listLoadingContractorYears(yearId)` (one row per
  `loading_contractor` account).

**IPC (`ipc/expenses.ts`, registered in `ipc/index.ts`)** + **preload** namespaces `bardana` &
`expenses` (yearId/userId injected from `requireSession()`). **UI:** `pages/BardanaPage.tsx`
(create + A/C stat cards: stock/purchases/sales/profit) and `pages/ExpensesPage.tsx` (two tabs:
**Staff salary** register + pay form; **Loading contractor** year-charges editor + pay form +
register). Nav items + routes in `AppLayout.tsx`; EN+HI strings under `bardana.*` / `expenses.*` /
`nav.bardana` / `nav.expenses`.

**Tests (all green):** `services/bardana.test.ts` (purchase/issue posting, stock count, profit,
bank-settled in the money book, named-party recorded-not-posted, validation),
`services/expenses.test.ts` (salary + loading post to the right head + register + money book,
loading-year upsert), and `phase4.integration.test.ts` (bardana trade → salary → loading payment;
cash money book = ledger; trial balance net-zero throughout).

---

## 3. New conventions / decisions Phase 4 introduced (so Phase 5 stays consistent)

1. **Bardana settles to cash/bank (the `mode`), not the named party.** The "Name" (`partyAccountId`)
   is recorded for the A/C lists and party reporting, but the money posts Cash/Bank ↔ Bardana
   Sales/Purchase — matching the software spec's "payment mode (cash / which bank)". **On-credit
   bardana** (Dr/Cr the party's own ledger) is deliberately **parked** for v1.
2. **The Bardana A/C is a pure aggregate** over the `bardana` table — there is no separate balance
   or stock table. Stock count and profit are computed on read (`getBardanaAccount`).
3. **Expenses post to the expense head, not the party's ledger.** Per the posting map ("Salary /
   Loading | Expense | Cash/Bank") a salary/loading payment is Dr Expense / Cr Cash-Bank. The paid
   staff/contractor is captured on the voucher's **`sourceId` + narration** (`sourceModule 'salary'`
   / `'loading'`) so Phase 5 Bills/registers can attribute it — but it does **not** appear in the
   party's running ledger balance. (If a future need is "the staff owes/we owe", introduce an
   accrual step then — parked.)
4. **`PAYMENT_MODES` is the generic cash/bank settlement enum** (bardana + expenses use it). It is a
   separate tuple from `LOAN_MODES` on purpose, to avoid coupling the loan module to side-ledgers.
5. Everything else is **unchanged from [phase2.md](phase2.md) §2 / [phase3.md](phase3.md) §3**:
   integer paise, all money through `PostingService`, `shared/` is the only cross-boundary type
   source, no hard deletes, year-scoping, `postCore` inside your own transaction, schema-change →
   migration + bump `db.test.ts`.

---

## 4. Reusable building blocks Phase 5 will lean on (new in Phase 4)

```ts
// services/bardana.ts
getBardanaAccount(yearId): BardanaAccount          // two lists + totals + stock count + profit
listBardana(yearId, direction?): BardanaRow[]
// services/expenses.ts
listSalaryRegister(yearId): ExpenseRow[]           // per-party salary payments (sourceModule 'salary')
listLoadingRegister(yearId): ExpenseRow[]          // per-party loading payments (sourceModule 'loading')
getLoadingContractorYear(accountId, yearId): LoadingContractorYearRow
```
Plus everything in **[phase3.md](phase3.md) §4** (`outstandingAsOf`, `getStandingLoan`,
`recordCheque`/`clearCheque`) and **[phase2.md](phase2.md) §3** (`post`/`postCore`/`nextSeries`/
`voidVoucher`, `getSystemAccountId` + `SYSTEM_ACCOUNTS`, `getAccountLedger`/`getTrialBalance`,
`getStandingBhada`, `writeAudit`, `requireSession`, `setupDb`/`makeYear`/`makeAccount`).

---

## 5. Current schema (21 tables)

Phase 1+2+3 (20): `person, subgroup, account, financial_year, opening_balance,
loading_contractor_year, voucher, voucher_entry, cheque, user, number_series, audit_log,
store_config, aamad, aamad_location, sauda, nikasi, nikasi_line, loan, loan_event`.
**Phase 4 (+1):** `bardana`.

`loading_contractor_year` is now fully wired (the only table that was sitting unused).

---

## 6. Phase 5 brief — Views & insights (Bills + Party search)

Goal: the read layers over everything posted so far. **No new money postings** — Bills and Party
are pure read models. The ledger is the source of truth; live loan interest comes from the engine.

**Bills (software.md §3.11).** A person-wise record-to-date statement of all party↔cold dealings.
- **One bill per person, a section per role** (kisan / vyapari / staff / loading-contractor / other),
  each showing that role's lines + balance, plus a **single combined net** at the bottom.
- **Live loan interest** via `outstandingAsOf(loanId, asOf)` (engine, not the posted ledger) — the
  bill shows the up-to-date figure, including interest not yet capitalised.
- Pulls from the **ledger** (`getAccountLedger`), standing bhada (`getStandingBhada`), standing
  loans (`getStandingLoan` + the live engine figure), the **bardana** A/C, and the salary/loading
  registers. Same person across roles is matched by **son-of / village / phone** (a person can own
  several role-accounts — see `account.personId`); **no auto-merge**, just grouping hints.
- **Print-ready** (the actual print/PDF templates are Phase 6 — Bills just needs to render cleanly).

**Party (software.md §3.12).** A filter-based search/insights view over all parties.
- Filters **AND** together; numeric ones support **=/≤/≥/between**. Categories: identity (type,
  subgroup, village, phone, defaulter, multi-role), stock (packets brought, aamads, current stock,
  location), sales (packets sold, to/from a party), balance (owes us / we owe, amount, aging), rent
  (standing bhada), loans (outstanding, type, overdue), bardana, activity.
- Default columns; **saved presets** (the `saved_filter` table in architecture.md §5 doesn't exist
  yet — add it: `user, module, criteria_json`; +migration, bump `db.test.ts` to 22). Each row
  clicks through to that party's **Bill / ledger**.

Follow the **recipe in [phase2.md](phase2.md) §8** for any new table/contract/service/IPC/UI/test.
Most of Phase 5 is read services + UI; the only schema add is `saved_filter` (for Party presets).

---

## 7. Phase 5 done/verify checklist

- [ ] `npm run typecheck` + `npm run build` clean; all tests green (Node ABI).
- [ ] A multi-role person's bill is correct: a section per role, a correct combined net, and **live
      loan interest** (matches `outstandingAsOf`, not just the posted ledger).
- [ ] The two example Party filters (software.md §3.12) return the right parties; numeric filters
      (=/≤/≥/between) AND together; saved presets persist; rows link to Bill/ledger.
- [ ] Trial balance still net-zero (Phase 5 posts nothing); a `phase5.integration.test.ts` capstone
      builds a multi-role person and asserts the bill sections + net.
- [ ] EN + HI strings for every new screen.
- [ ] Write **phase5.md** and add a "superseded" banner here.

---

## 8. Phases after 5 (unchanged)

**6** Year-end Close (carry-forward → indirect loans → **`capitaliseAllLoans`** → flag defaulters →
reset maps; reversible snapshot) + printing/PDF (gate pass, bill, voucher, ledger, trial balance) ·
**7** hardening + backups + real-data onboarding + Windows install + parallel-run acceptance.

## 9. Parked for later (unchanged + Phase 4 additions)

From phase3.md §9: partial vyapari payments · GST · KYC fields · post-Nikasi rate revision · extra
per-nikasi charges · rack-capacity warnings · defaulter auto-clear · the settlement-ordering UI ·
cheque entry directly on the voucher screens · AI chatbot · multi-user/Postgres.
**New in Phase 4:** **on-credit bardana** (settle to a party's ledger rather than cash/bank) ·
bardana valuation/types · a salary/loading **accrual** step (so a staff/contractor carries a
running owed balance, rather than direct expense-on-payment).
