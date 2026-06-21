# Phase 5 done — and the handover for Phase 6

**This is the live handover doc. Start here in a new session.** It records what Phase 5 delivered
(Bills + Party search — the read layers), the new conventions, and the Phase 6 brief (Year-end
Close + printing/PDF). The load-bearing architecture rules live in **[phase2.md](phase2.md) §2–§4**
— read those first; they still hold verbatim.

Read order for a cold start:
1. **This file** (where we are + how to build the next phase).
2. **[phase2.md](phase2.md) §2–§4** — the architecture conventions, reusable building blocks, and
   the shared-contract boundary. Still 100% accurate; do not re-derive them.
3. [software.md](software.md) — *what* the app does. §3.13 Year-end Close for Phase 6.
4. [architecture.md](architecture.md) — *how* it's built. §5 data model, §6 posting map, §7 engines.

Git baseline: Phase 0/1/2/3 are committed on `main` (latest commit `a7ef2b2` — "Phase 4: bardana
sub-ledger and staff/loading expenses"). **Phase 5 is on the working tree, not yet committed** —
review, then commit. (Phase 4's own code was committed as part of `a7ef2b2`.)

---

## 0. TL;DR status

| Phase | Scope | State |
|---|---|---|
| 0 | Electron+React+SQLite scaffold, IPC, i18n, CI | ✅ done (phase0.md) |
| 1 | Ledger core: PostingService, Trial Balance, Auth, Account Manager, Money Book, vouchers | ✅ done & tested |
| 2 | Stock: Store layout, Aamad, Maps, Sauda, Nikasi, Bhada engine | ✅ done & tested |
| 3 | Money depth: Loans + interest engine + cheque-clearing | ✅ done & tested |
| 4 | Bardana sub-ledger + staff salaries + loading-contractor expenses | ✅ done & tested |
| 5 | **Views & insights: Bills + Party search** | ✅ **done & tested (this doc)** |
| 6 | **Year-end Close + printing/PDF** | ⏭ **next — §6 below** |

**81 tests green** (was 71; +10 in Phase 5), `npm run typecheck` + `npm run build` clean. Repo is
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

## 2. What Phase 5 delivered

**Phase 5 posts NO money.** Bills and Party are pure read models over everything Phases 1–4 posted;
the ledger is the source of truth, and live loan interest comes from the engine. The only schema
add is `saved_filter` (for Party presets).

**Schema (`schema.ts`, migration `0004_majestic_puff_adder.sql`) — now 22 tables:**
- `saved_filter` — `id, userId?, module, name, criteriaJson, createdAt`. Index `(module)`.
  `criteriaJson` is a serialised `PartyCriteria`. UI convenience only (not a financial record), so
  these **may be deleted** — the no-hard-delete rule covers the ledger, not user presets.
- `db.test.ts` table count bumped 21 → **22**.

**Contracts (`shared/contracts.ts`):** new Bills DTOs (`Bill`, `BillSection`, `BillLoanLine`,
`BillSubject`), Party DTOs (`PartyCriteria`, `NumericFilter`, `NumericOp`, `PartyRow`,
`PartyResult`, `SavedFilterRow`). `NumericOp = 'eq' | 'lte' | 'gte' | 'between'` lives in
`contracts.ts` (it's not a DB enum, so it is **not** in `enums.ts` — import it from `@shared/contracts`).

**Bills service (`services/bills.ts`)** — software.md §3.11:
- `getBill(accountId, yearId, asOf?)` — the full person-wise bill reachable from any of its
  role-accounts. Resolves the owning **person** (via `account.personId`; no auto-merge), gathers
  every sibling role-account, and builds **one `BillSection` per role** (kisan / vyapari / staff /
  loading_contractor / other), plus a single **combined net**.
- `listBillSubjects(yearId, asOf?)` — the Bills index: one row per person (grouping roles) or per
  standalone account, with the combined net. Bulk balances in one pass.
- **Section net = posted ledger balance + live un-posted loan interest** (Dr positive = party owes
  the cold). The live interest is `accruedForPayment(loanId, asOf).interestPaise` summed over the
  account's loans — the interest accrued on the **posted base** that hasn't been capitalised yet.
  Each loan line also shows `outstandingAsOf(loanId, asOf)` as its standalone live total.

**Party service (`services/party.ts`)** — software.md §3.12:
- `searchParty(yearId, criteria, asOf?)` — scores every non-system account on every metric the
  filters target (balance, packets brought, aamad turns, current stock, packets sold, standing
  bhada, live loan outstanding, bardana pieces, activity), then applies the **ANDed** criteria.
  Numeric filters support **= / ≤ / ≥ / between** (`matchNum`). Metrics are computed in bulk Maps;
  the engine's `outstandingAsOf` is the live loan figure.
- Saved presets: `listSavedFilters(module, userId?)`, `saveFilter(module, name, criteria, userId?)`,
  `deleteSavedFilter(id)`.

**IPC (`ipc/views.ts`, registered in `ipc/index.ts`)** + **preload** namespaces `bills` & `party`
(yearId/userId injected from `requireSession()`). **UI:** `pages/BillsPage.tsx` (subject index +
client-side search), `pages/BillPage.tsx` (the bill at `/bills/:accountId` — section cards with
ledger + loans + standing bhada + a combined-net header; print-ready), `pages/PartyPage.tsx`
(filter form with op/value/value2 numeric rows, results table with count+totals, saved-preset
load/save/delete, rows → Bill/ledger). Nav items + routes in `AppLayout.tsx`; EN+HI strings under
`bills.*` / `party.*` / `nav.bills` / `nav.party`.

**Tests (all green):** `services/bills.test.ts` (multi-role person → section per role, combined
net, live un-posted interest, reachable from any role-account, standalone account, subject index),
`services/party.test.ts` (the §3.12 example, between/eq numeric ops, loan filters, multi-role,
preset persistence), and `phase5.integration.test.ts` (capstone: a multi-role person's bill +
party hit; trial balance net-zero throughout — Phase 5 posts nothing).

---

## 3. New conventions / decisions Phase 5 introduced (so Phase 6 stays consistent)

1. **Bills/Party post nothing.** They are pure read models. The "live" figure a bill shows beyond
   the posted ledger is loan interest that has accrued but not been capitalised — computed by the
   interest engine, never written. (Capitalising it is the Close-Year step in Phase 6.)
2. **A section net = posted balance + un-posted loan interest.** Use
   `accruedForPayment(loanId, asOf).interestPaise` (interest only — the principal is already in the
   ledger, for both direct loans and indirect dues), NOT `outstandingAsOf(...).outstandingPaise`
   (which includes the principal and would double-count it). `outstandingAsOf` is for a loan's
   *standalone* live total (the per-loan display and the Party `loanOutstanding` metric).
3. **People are grouped by `account.personId`, never by name.** A bill subject is a person (when
   linked) or a standalone account. Son-of / village / phone are display/search hints only — no
   auto-merge (software.md §3.1/§3.11).
4. **Bardana / salary / loading rows on a bill are informational.** They're cash-settled and don't
   sit in the party's ledger balance, so they're shown for the record but **do not change the net**
   (consistent with phase4.md §3.3 — expenses post to the expense head, not the party).
5. **`saved_filter` is deletable.** The no-hard-delete rule is about the ledger; UI presets are not
   financial records. `criteriaJson` is a serialised `PartyCriteria`.
6. **`NumericOp` is a contract type, not a DB enum** — it lives in `shared/contracts.ts`. Money
   filters carry **paise**; count filters carry integers (the UI converts ₹→paise via `toPaise`).
7. Everything else is **unchanged from [phase2.md](phase2.md) §2**: integer paise, all money
   through `PostingService`, `shared/` is the only cross-boundary type source, no hard deletes
   (ledger), year-scoping, schema-change → migration + bump `db.test.ts`.

---

## 4. Reusable building blocks Phase 6 will lean on (new in Phase 5)

```ts
// services/bills.ts
getBill(accountId, yearId, asOf?): Bill | null      // section per role + combined net (live interest)
listBillSubjects(yearId, asOf?): BillSubject[]       // the Bills index, grouped by person
// services/party.ts
searchParty(yearId, criteria, asOf?): PartyResult    // ANDed filters; =/≤/≥/between; live metrics
listSavedFilters / saveFilter / deleteSavedFilter    // Party presets (saved_filter)
```
Plus everything in **[phase4.md](phase4.md) §4** (`getBardanaAccount`, `listSalaryRegister`,
`listLoadingRegister`, …), **[phase3.md](phase3.md) §4** (`outstandingAsOf`, `accruedForPayment`,
`capitaliseLoan`, **`capitaliseAllLoans`**, `getStandingLoan`, `recordCheque`/`clearCheque`), and
**[phase2.md](phase2.md) §3** (`post`/`postCore`/`nextSeries`/`voidVoucher`, `getSystemAccountId` +
`SYSTEM_ACCOUNTS`, `getAccountLedger`/`getAccountBalance`/`getTrialBalance`, `accrueRent`/
`getStandingBhada`, `writeAudit`, `requireSession`, `setupDb`/`makeYear`/`makeAccount`/`groupId`).

---

## 5. Current schema (22 tables)

Phase 1+2+3+4 (21): `person, subgroup, account, financial_year, opening_balance,
loading_contractor_year, voucher, voucher_entry, cheque, user, number_series, audit_log,
store_config, aamad, aamad_location, sauda, nikasi, nikasi_line, loan, loan_event, bardana`.
**Phase 5 (+1):** `saved_filter`.

---

## 6. Phase 6 brief — Year-end Close + printing/PDF (software.md §3.13, architecture.md §7)

Goal: close a year and produce documents. This is the first feature that **writes money on a button
press** (capitalisation + carry-forward), so it must be transactional, idempotent, and reversible.

**Close-Year engine (`engines/close-year.ts` — new).** Password-gated; one button. Runs after a
**pre-close snapshot** (a `.db` file copy — see Phase 7 backups; for now at least snapshot the data
needed to roll back) inside **one SQLite transaction**, in this order:
1. **Carry-forward** each party's closing balance → next year's `opening_balance` (+ the balancing
   `opening` voucher in the new year, exactly like `setOpeningBalance` already does).
2. **Indirect loans** — turn unpaid dues / standing bhada at year-end into indirect loans
   (interest-free this year, from 1 Jan next; `nature 'indirect'`, `interestStartDate` = next 1 Jan).
3. **Capitalise interest** — `capitaliseAllLoans(yearId, '<nextYear>-01-01')` already exists and is
   idempotent (voids + re-posts a prior capitalisation at that date). Reuse it.
4. **Flag defaulters** — set `account.isDefaulter` for parties who failed to clear (use
   `setDefaulter`). Reversible: record which flags the close set so rollback can clear them.
5. **Reset maps** — the maps already start empty per year (they're year-scoped reads over aamad/
   nikasi), so "reset" is implicit when the new year has no stock; nothing to delete.
6. Produce a **summary + exceptions** review (counts + totals + anything that couldn't be carried),
   and mark the year `status 'closed'`.

It must be **reversible** (roll back to the snapshot / undo the close). Idempotency discipline:
follow phase2.md §2.7 (find prior auto-vouchers by `sourceModule`, void, re-post).

**Printing/PDF (bilingual).** HTML templates → Electron `printToPDF` (main process). The documents:
gate pass (Nikasi), **bill** (Bills is already render-ready — wire its data into a print template),
receipt/payment voucher, ledger statement, trial balance. Keep EN+HI.

**Engine tests:** close-year on seeded data (balances carried to the new year, indirect loans
created with the right `interestStartDate`, interest capitalised, defaulters flagged, maps empty in
the new year); rollback restores the pre-close state. Trial balance net-zero before and after.

Follow the **recipe in [phase2.md](phase2.md) §8** for any new table/contract/service/IPC/UI/test.

---

## 7. Phase 6 done/verify checklist

- [ ] `npm run typecheck` + `npm run build` clean; all tests green (Node ABI).
- [ ] Close-Year on seeded data: balances carried forward, indirect loans created, interest
      capitalised, defaulters flagged, new-year maps empty; **rollback restores** the prior state.
- [ ] Trial balance net-zero before and after the close.
- [ ] The five core documents print to PDF (bilingual): gate pass, bill, voucher, ledger, trial
      balance.
- [ ] EN + HI strings for every new screen.
- [ ] Write **phase6.md** and add a "superseded" banner here.

---

## 8. Phases after 6 (unchanged)

**7** Hardening + backups (auto `.db` copies on open/close + the pre-close snapshot; test a restore)
+ real-data onboarding + Windows install + parallel-run acceptance.

## 9. Parked for later (unchanged + Phase 5 notes)

From phase4.md §9: on-credit bardana · bardana valuation/types · a salary/loading accrual step ·
partial vyapari payments · GST · KYC fields · post-Nikasi rate revision · extra per-nikasi charges ·
rack-capacity warnings · defaulter auto-clear · the settlement-ordering UI · cheque entry on the
voucher screens · AI chatbot (its tools are the Party/Bills read services — already shaped for it) ·
multi-user/Postgres. **Phase 5 notes:** Party metrics are computed per-account on each search (fine
at single-cold scale); if a future dataset is large, push the bulk Maps into SQL aggregates or add
indexes. `packetsSold` is kisan-centric (packets a kisan sold to a vyapari); a vyapari-bought
metric was not needed for v1.
