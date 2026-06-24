# Phase 3 done — and the handover for Phase 4

> **⚠️ SUPERSEDED — Phase 4 is complete. Start at [phase4.md](phase4.md).** This file is kept for
> history: §2–§4 (the Phase 3 conventions and building blocks) are still accurate, but the Phase 4
> brief in §6–§7 below has been built and is now reference, not a to-do.

**This is the live handover doc. Start here in a new session.** It records what Phase 3 delivered
(Loans + interest engine + cheque-clearing), the few new conventions, and the Phase 4 brief
(Bardana + staff/loading expenses). The load-bearing architecture rules live in **[phase2.md](phase2.md)
§2–§4** — read those first; they still hold verbatim.

Read order for a cold start:
1. **This file** (where we are + how to build the next phase).
2. **[phase2.md](phase2.md) §2–§4** — the architecture conventions, reusable building blocks, and the
   shared-contract boundary. Still 100% accurate; do not re-derive them.
3. [software.md](../software.md) — *what* the app does. §3.6 Bardana, §3.7 Staff/Loading for Phase 4.
4. [architecture.md](../architecture.md) — *how* it's built. §5 data model, §6 posting map, §7 engines.

Git baseline: Phase 0/1/2 are committed on `main` (latest commit `8dd1eea`). **Phase 3 is on the
working tree, not yet committed** — review, then commit.

---

## 0. TL;DR status

| Phase | Scope | State |
|---|---|---|
| 0 | Electron+React+SQLite scaffold, IPC, i18n, CI | ✅ done (phase0.md) |
| 1 | Ledger core: PostingService, Trial Balance, Auth, Account Manager, Money Book, vouchers | ✅ done & tested |
| 2 | Stock: Store layout, Aamad, Maps, Sauda, Nikasi, Bhada engine | ✅ done & tested |
| 3 | **Money depth: Loans + interest engine + cheque-clearing** | ✅ **done & tested (this doc)** |
| 4 | **Bardana & expenses (staff salaries, loading-contractor charges)** | ⏭ **next — §6 below** |

**61 tests green** (was 48; +13 in Phase 3), `npm run typecheck` + `npm run build` clean. Repo is
left on the **Electron ABI** (`npm run dev` works now). Login: **admin / admin123**.

Still never verified by an agent (carried over from Phase 2): (a) a manual GUI click-through;
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

## 2. What Phase 3 delivered

**Schema (`schema.ts`, migration `0002_curvy_stephen_strange.sql`) — now 20 tables:**
- `loan` — `id, yearId, category('kisan'|'vyapari'|'other'), accountId, date, principalPaise,
  mobile?, mode('cash'|'bank'), bankAccountId?, nature('direct'|'indirect'), monthlyRateBps
  (default 150), interestStartDate, remark?, createdAt`. Index `(yearId, accountId)`.
- `loan_event` — `id, loanId, date, type('disbursement'|'payment'|'capitalisation'), amountPaise,
  voucherId?`. The interest engine **replays these** to compute the live outstanding.
- New enums in `shared/enums.ts`: `LOAN_CATEGORIES, LOAN_NATURES, LOAN_MODES, LOAN_EVENT_TYPES`
  (+ types), re-exported from `schema.ts`.
- `db.test.ts` table count bumped 18 → **20**.

**Seed (`seed.ts`):** added system account **`CHEQUES_IN_CLEARING` = "Cheques in Clearing"** in the
**`Sundry Debtors`** subgroup — deliberately NOT `Cash and Bank`, so the Money Book (which filters by
that subgroup) shows **cleared money only**. It nets to zero once every cheque clears/bounces.

**Interest engine (`engines/interest.ts`)** — the core deliverable. Pure decimal.js math, integer
paise. Rule: **1.5%/mo, simple within a year, compound thereafter, capitalised every 1 Jan.**
- `monthsBetween(from, to)` — whole calendar months + a day fraction (days ÷ days-in-target-month).
  **Two consecutive 1-Jans = exactly 12 months**, which makes the worked examples paise-exact.
- `accrue(basePaise, from, to, bps)` — simple interest, rounded HALF_UP to paise.
- `outstandingAsOf(loanId, asOf)` → `LoanOutstanding` — **pure live figure**, posts nothing
  (auto-folds every 1 Jan, applies recorded payments). This is what Bills/Party (Phase 5) call.
- `capitaliseLoan(loanId, onDate, userId)` — **posts** the prior-year interest (Dr Party / Cr
  Interest Income, tag `interest`), records a `capitalisation` event. Posts any missing earlier
  boundaries first; idempotent (re-running an `onDate` voids + re-posts).
- `ensureCapitalisedBefore`, `accruedForPayment` — helpers the loan service uses.

**Loan service (`services/loans.ts`):**
- `createLoan` — **direct** posts the disbursement Dr Party / Cr Cash-or-Bank (tag `loan`) and
  records a `disbursement` event; **indirect** posts NO cash (dues already in the books) — only
  records the event so the engine knows the principal + start date. `interestStartDate` defaults:
  direct → sanction date; indirect → **1 Jan of the next year**.
- `recordPayment(loanId, amountPaise, date, mode, bankAccountId?, userId)` — folds any whole years
  first, posts interest-to-date (Dr Party / Cr Interest Income) **and** the cash received
  (Dr Cash/Bank / Cr Party, type `receipt`) in one voucher; records a `payment` event. Guards
  against over-payment.
- `capitaliseAllLoans(yearId, onDate)` — the Close-Year hook (Phase 6).
- `listLoans`, `getLoan` (with events + live breakdown), `getStandingLoan` (ledger `loan`+`interest`
  tagged net — mirrors `getStandingBhada`).

**Cheque-clearing engine (`engines/cheque-clearing.ts`) + `services/cheques.ts`:**
- `recordCheque` (status `pending`): received → Dr Clearing / Cr Party (Receipt); given → Dr Party /
  Cr Clearing (Payment). Writes the `cheque` row and links the entry voucher.
- `clearCheque(id, clearanceDate)`: received → Dr Bank / Cr Clearing; given → Dr Clearing / Cr Bank.
  **Only now does money touch the bank** (and the Money Book). Status → `cleared`.
- `bounceCheque(id, date)`: reverses the entry (no bank money ever moved). Status → `bounced`.
  Both guard `status === 'pending'`.
- `listCheques(yearId, status?)`, `pendingTotals(yearId)`. Cheques are year-scoped via their entry
  voucher.

**IPC (`ipc/loans.ts`, registered in `ipc/index.ts`)** + **preload** namespaces `loans` & `cheques`
(yearId/userId injected from `requireSession()`). **UI:** `pages/LoansPage.tsx` (create + pay modal
+ live outstanding) and `pages/ChequesPage.tsx` (record + clear/bounce), nav items + routes in
`AppLayout.tsx`, EN+HI strings under `loans.*` / `cheques.*` / `nav.loans` / `nav.cheques`.

**Tests (all green):** `engines/interest.test.ts` (the worked examples paise-exact — full year
₹1,00,000→₹1,18,000→₹1,39,240, mid-year, part-payment, indirect, idempotency),
`engines/cheque-clearing.test.ts` (pending-not-in-bank, clears-to-bank, bounce-reverses, given
cheque), and `phase3.integration.test.ts` (loan → capitalise across 1 Jan → part-payment → cheque
clears; trial balance net-zero throughout).

---

## 3. New conventions / decisions Phase 3 introduced (so Phase 4 stays consistent)

1. **The engine vs the ledger.** `outstandingAsOf` is the **live** figure (includes interest not yet
   posted) and auto-compounds at each 1 Jan. The **ledger** (and `getStandingLoan`) only reflects
   what's been *posted* — they're equal at any point where everything up to that date is posted
   (e.g. right after a payment). Bills/Party must use the engine for the live number, not the tags.
2. **Capitalisation events ≠ outstanding.** `outstandingAsOf` ignores `capitalisation` rows (it
   re-derives boundaries itself); they exist so the *posting* side knows what interest is already
   booked. Don't double-count.
3. **Indirect loans post no disbursement.** Their principal already sits in the party's ledger as the
   original dues; creating one only seeds the interest engine. (Auto-generating indirect loans from
   year-end dues is a **Phase 6 Close-Year** job — `capitaliseAllLoans` is the hook.)
4. **Cheque postings are tagged `general`.** A cheque is a settlement rail, not a trade/loan event —
   it nets against the party's existing balance. If a cheque ever needs to specifically pay down a
   loan's `loan`/`interest` tag, that's a deliberate future change.
5. Everything else is **unchanged from [phase2.md](phase2.md) §2**: integer paise, all money through
   `PostingService`, `shared/` is the only cross-boundary type source, no hard deletes, year-scoping,
   `postCore` inside your own transaction, schema-change → migration + bump `db.test.ts`.

---

## 4. Reusable building blocks Phase 4 will lean on (new in Phase 3)

```ts
// engines/interest.ts
outstandingAsOf(loanId, asOf): LoanOutstanding        // pure live figure (for Bills/Party)
capitaliseLoan(loanId, onDate, userId?): CapitaliseResult | null
// services/loans.ts
createLoan(yearId, LoanInput, userId?): CreateLoanResult
recordPayment(loanId, amountPaise, date, mode, bankAccountId?, userId?): LoanPaymentResult
getStandingLoan(accountId, yearId): StandingLoan      // ledger loan+interest net
// engines/cheque-clearing.ts
recordCheque(yearId, ChequeInput, userId?) / clearCheque(id, date) / bounceCheque(id, date)
```
Plus everything in **[phase2.md](phase2.md) §3** (`post`/`postCore`/`nextSeries`/`voidVoucher`,
`getSystemAccountId` + `SYSTEM_ACCOUNTS`, `getAccountLedger`/`getTrialBalance`, `writeAudit`,
`requireSession`, `setupDb`/`makeYear`/`makeAccount` in `test-utils.ts`).

---

## 5. Current schema (20 tables)

Phase 1+2 (18): `person, subgroup, account, financial_year, opening_balance,
loading_contractor_year, voucher, voucher_entry, cheque, user, number_series, audit_log,
store_config, aamad, aamad_location, sauda, nikasi, nikasi_line`.
**Phase 3 (+2):** `loan, loan_event`.

`loading_contractor_year` already exists (Phase 1, unused) — Phase 4 wires it. `cheque` is now fully
used by the clearing engine.

---

## 6. Phase 4 brief — Bardana & expenses (the side ledgers)

Goal: the buy/sell sub-ledger and the simple expense postings. Follow the **recipe in
[phase2.md](phase2.md) §8** exactly (enums → schema + migration `0003_*` + bump `db.test.ts` to
**21/22** → contracts → service → engine(s) → IPC → preload → UI + EN/HI → tests).

**Bardana (software.md §3.6).** Bags potatoes are filled into; a buy/sell sub-ledger.
- **Issue (sell)** and **Purchase (buy)** rows: date, name/party, rate, qty-pieces, **amount auto =
  rate × qty**. Needs a `bardana` table (year-scoped; direction issue|purchase; partyAccountId?; rate;
  qty; date).
- **Stock count** = Σ purchased − Σ issued (pieces). **A/C** view = two lists (purchases, issues) +
  totals; **profit = sales − purchases** (paise).
- **Posting map (architecture.md §6):** Bardana sale → Dr Cash/Bank or Party / Cr **Bardana Sales**;
  Bardana purchase → Dr **Bardana Purchase** / Cr Cash/Bank or Party. Both system accounts are
  **already seeded** (`SYSTEM_ACCOUNTS.BARDANA_SALES` / `BARDANA_PURCHASE`). Use `post()`.

**Staff salaries.** Payment vouchers to a `staff`-type account: Dr **Salary Expense** / Cr Cash/Bank
(`SYSTEM_ACCOUNTS.SALARY_EXPENSE`, already seeded). Likely just a thin screen over `createPayment`
with the salary expense pre-filled — or a small service if you want a salary register.

**Loading-contractor charges.** `loading_contractor_year` holds per-year `loadingChargePaise`,
`unloadingChargePaise`, `labourersLoading/Unloading`. Wire: a year-fields editor + **payment
vouchers** Dr **Loading Expense** / Cr Cash/Bank (`SYSTEM_ACCOUNTS.LOADING_EXPENSE`, seeded).

**Required tests:** bardana profit (sales − purchases) + stock count correct; expense postings hit
the ledger and the Money Book; trial balance stays net-zero.

---

## 7. Phase 4 done/verify checklist

- [ ] `npm run typecheck` + `npm run build` clean; all tests green (Node ABI).
- [ ] Bardana issue/purchase post per the map; stock count (Σpurchased − Σissued) + A/C totals +
      profit correct.
- [ ] Staff salary + loading-contractor payments post and show in the Money Book.
- [ ] Trial balance net-zero; a `phase4.integration.test.ts` capstone passes.
- [ ] EN + HI strings for every new screen.
- [ ] Write **phase4.md** and add a "superseded" banner here.

---

## 8. Phases after 4 (unchanged)

**5** Bills (person-wise, section-per-role, **live loan interest via `outstandingAsOf`**) + Party
search · **6** Year-end Close (carry-forward → indirect loans → **`capitaliseAllLoans`** → flag
defaulters → reset maps; reversible snapshot) + printing/PDF · **7** hardening + onboarding + go-live.

## 9. Parked for later (unchanged from phase2.md §11)

Partial vyapari payments · GST · KYC fields · post-Nikasi rate revision · extra per-nikasi charges ·
bardana valuation/types · rack-capacity warnings · defaulter auto-clear · the settlement-ordering UI
(rent-first split is a Bills/Phase 5 concern; the ledger already nets it) · cheque entry directly on
the voucher screens (Phase 3 used a dedicated Cheques page instead) · AI chatbot · multi-user/Postgres.
