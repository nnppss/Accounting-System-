# Phase 6 done — and the handover for Phase 7

**This is the live handover doc. Start here in a new session.** It records what Phase 6 delivered
(Year-end Close + printing/PDF), the new conventions, and the Phase 7 brief (Hardening + backups +
onboarding + go-live). The load-bearing architecture rules live in **[phase2.md](phase2.md) §2–§4**
— read those first; they still hold verbatim.

Read order for a cold start:
1. **This file** (where we are + how to build the next phase).
2. **[phase2.md](phase2.md) §2–§4** — the architecture conventions, reusable building blocks, and
   the shared-contract boundary. Still 100% accurate; do not re-derive them.
3. [phase5.md](phase5.md) §2–§4 — the Bills/Party read models Phase 6's printing reuses.
4. [software.md](../software.md) — *what* the app does. §5 Login/users/safety for Phase 7 backups.
5. [architecture.md](../architecture.md) — *how* it's built. §7 engines, §8 cross-cutting (backups/printing).

Git baseline: Phase 0–5 are committed on `main` (latest commit `ce01801` — "Phase 5: Bills + Party
search (read layers)"). **Phase 6 is on the working tree, not yet committed** — review, then commit.

---

## 0. TL;DR status

| Phase | Scope | State |
|---|---|---|
| 0 | Electron+React+SQLite scaffold, IPC, i18n, CI | ✅ done (phase0.md) |
| 1 | Ledger core: PostingService, Trial Balance, Auth, Account Manager, Money Book, vouchers | ✅ done & tested |
| 2 | Stock: Store layout, Aamad, Maps, Sauda, Nikasi, Bhada engine | ✅ done & tested |
| 3 | Money depth: Loans + interest engine + cheque-clearing | ✅ done & tested |
| 4 | Bardana sub-ledger + staff salaries + loading-contractor expenses | ✅ done & tested |
| 5 | Views & insights: Bills + Party search | ✅ done & tested |
| 6 | **Year-end Close + printing/PDF** | ✅ **done & tested (this doc)** |
| 7 | **Hardening + backups + onboarding + go-live** | ⏭ **next — §6 below** |

**93 tests green** (was 81; +12 in Phase 6), `npm run typecheck` + `npm run build` clean. Repo is
left on the **Electron ABI** (`npm run dev` works now). Login: **admin / admin123**.

Still never verified by an agent (carried over since Phase 2): (a) a manual GUI click-through;
(b) the Windows CI installer actually building green on GitHub Actions; (c) **`printToPDF` actually
producing a PDF on a real run** — the pure HTML templates are unit-tested, but the Electron render
(`printing/print.ts`) is glue that only runs in the app, so it's untested here.

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

## 2. What Phase 6 delivered

Year-end Close is **the first feature that writes money on a button press** (capitalisation +
carry-forward). Printing posts nothing — it's a pure render of existing read models.

**Schema (`schema.ts`, migration `0005_overrated_masked_marvel.sql`) — now 23 tables:**
- `year_close` — `id, yearId, nextYearId, status ('closed'|'rolled_back'), closedByUserId?,
  summaryJson, rollbackJson, closedAt, rolledBackAt?`. Index `(yearId)`. `summaryJson` is a
  serialised `CloseSummary`; `rollbackJson` is the engine's private `RollbackPlan` (the ids the undo
  voids/deletes/clears). `db.test.ts` table count bumped 22 → **23**.
- New enum `CLOSE_STATUSES = ['closed','rolled_back']` in `enums.ts` (distinct from `YEAR_STATUSES`).

**Contracts (`shared/contracts.ts`):** `CloseSummary`, `CloseException` (+ `CloseExceptionKind`),
`ClosePreview`, `CloseResult`, `YearCloseInfo`, and `PrintResult` (`{ path: string | null }`).

**Close-Year engine (`engines/close-year.ts`)** — software.md §3.13. Runs in this order:
1. **Capitalise interest** — fold every loan's interest at `<nextYear>-01-01` (reuses
   `capitaliseLoan`). **Runs first**, so the closing balances that roll forward are final. (This is
   the documented order with one correctness refinement: capitalisation mutates the closing balance,
   so it must precede carry-forward — see the file header.)
2. **Carry-forward** — every non-system account's non-zero closing balance → next year's
   `opening_balance` + the balancing `opening` voucher (reuses `setOpeningBalance`).
3. **Indirect loans** — each owing (Dr) party's carried dues → an interest-free **indirect** loan
   for the new year (`createLoan`, `nature 'indirect'`, `interestStartDate = <nextYear>-01-01`).
   Posts nothing — the principal already rolled forward in the opening balance (no double-count).
4. **Flag defaulters** — every still-owing party (`setDefaulter`).
5. **Reset maps** — implicit (maps are year-scoped reads; the new year has no aamad/nikasi). The
   leftover current-stock packet count is recorded for the report.

Plus a **summary + exceptions** review (`CloseSummary` + `CloseException[]` — pending cheques,
credit balances, leftover stock, an unbalanced book). Functions:
```ts
previewClose(yearId): ClosePreview              // dry run — projects the numbers, posts NOTHING
closeYear(yearId, userId?): CloseResult          // does it; throws if already closed
rollbackClose(yearId, userId?): YearCloseInfo     // the undo — replays the rollback plan, reopens the year
getCloseStatus(yearId): YearCloseInfo | null      // the active (not rolled-back) close, or null
```

**Printing/PDF (`printing/`)** — architecture.md §8:
- `templates.ts` — **pure** functions `gatePassHtml / billHtml / voucherHtml / ledgerHtml /
  trialBalanceHtml` (DTO → bilingual `English / हिन्दी` HTML string). No DB, no Electron →
  unit-tested directly.
- `print.ts` — Electron glue: fetches the DTO via the existing services, calls a template, renders
  the HTML to PDF via a hidden `BrowserWindow` + `webContents.printToPDF`, and saves it via
  `dialog.showSaveDialog`. Returns `PrintResult`.

**IPC + preload:** `ipc/close.ts` (`close:preview/status/run/rollback`; `run`/`rollback` are
**password-gated** via `verifyPassword(session.userId, password)` — new in `auth.ts`) and
`ipc/print.ts` (`print:gatePass/bill/voucher/ledger/trialBalance`), both registered in
`ipc/index.ts`. Preload gained `close` + `print` namespaces (yearId/year injected from the session).

**UI:** `pages/ClosePage.tsx` (status tag, dry-run summary + exceptions, password-gated Close, and
an Undo for a closed year). Nav item + `/close` route in `AppLayout.tsx`. **Print buttons** wired on
BillPage, NikasiPage (gate pass in the detail drawer), VouchersPage (per-row), AccountLedgerPage,
TrialBalancePage — all via the shared `lib/usePrinter.ts` hook. EN+HI strings under `close.*` /
`print.*` / `common.print` / `nav.close`.

**Tests (all green):** `engines/close-year.test.ts` (preview == real close; capitalise → carry →
indirect loans → defaulters → leftover; refuses double-close; **rollback restores exactly**;
re-close works; pending-cheque exception), `printing/templates.test.ts` (each doc renders, figures
land, HTML is escaped, bilingual labels present), `phase6.integration.test.ts` (capstone: a worked
year closed → rolled back → re-closed; **trial balance net-zero in both years at every checkpoint**).

---

## 3. New conventions / decisions Phase 6 introduced (so Phase 7 stays consistent)

1. **Capitalisation runs before carry-forward.** It posts the year's final interest into the closing
   year, so the balance that rolls forward (and the indirect-loan principal) is complete. The
   software.md §3.13 list reads carry-forward → indirect → capitalise; the engine reorders
   capitalise to the front purely for correctness (carry-forward must read the final balance).
2. **Atomicity is application-level, not one SQLite transaction.** The close reuses services that
   each open their own transaction, so it can't sit inside one outer transaction. Instead it records
   a **`RollbackPlan`** as it goes; on any mid-way error it replays the plan and rethrows
   (all-or-nothing). That same plan is the user-facing **undo** the spec requires. Re-closing a
   year is **refused** until it's rolled back (cleaner than making the whole chain idempotent).
3. **Carry-forward is party-scoped.** Only **non-system** accounts roll forward (each balanced
   against Opening Balance Equity, exactly like `setOpeningBalance`), so both years' trial balances
   stay net-zero. System cash/bank/capital are deliberately NOT carried in v1 (the handover scoped
   it to "each party's closing balance"; revisit if a full balance-sheet roll-forward is wanted).
4. **An indirect loan posts nothing.** Its principal is the party's carried Dr balance, which is
   already in the new year's opening — so creating it never double-counts. It exists only to make
   the dues accrue interest from 1 Jan (its `interestStartDate`).
5. **The undo deletes the close's fresh artifacts (loans, opening_balance rows) but VOIDS its
   vouchers.** Vouchers are never hard-deleted (the ledger rule, phase2.md §2.4); the
   `opening_balance` rows and the indirect `loan`/`loan_event` rows the close created are not ledger
   records, so the undo deletes them (it only deletes opening_balance rows it newly created — a
   pre-existing one is left alone). The created next-year is left in place (voided vouchers FK it).
6. **Print templates are pure; PDF rendering is Electron glue.** Keep new documents the same way:
   add a pure `*Html(dto)` to `templates.ts` (testable) and a thin fetch-+-render wrapper in
   `print.ts`. Labels are bilingual inline (`English / हिन्दी`) — there's no i18n runtime in main.
7. **The Close is password-gated at the IPC layer** (`verifyPassword`), not in the engine — the
   engine assumes the caller is authorised, so tests call it directly.
8. Everything else is **unchanged from [phase2.md](phase2.md) §2**: integer paise, all money through
   `PostingService`, `shared/` is the only cross-boundary type source, no hard deletes (ledger),
   year-scoping, schema-change → migration + bump `db.test.ts`.

---

## 4. Reusable building blocks Phase 7 will lean on (new in Phase 6)

```ts
// engines/close-year.ts
previewClose(yearId): ClosePreview                 // dry run (posts nothing)
closeYear(yearId, userId?): CloseResult             // capitalise→carry→indirect→defaulters→report
rollbackClose(yearId, userId?): YearCloseInfo        // the undo (replays the rollback plan)
getCloseStatus(yearId): YearCloseInfo | null
// auth/auth.ts
verifyPassword(userId, password): boolean            // the gate for sensitive actions
// printing/templates.ts  (pure DTO → bilingual HTML)
gatePassHtml / billHtml / voucherHtml / ledgerHtml / trialBalanceHtml
// printing/print.ts  (Electron: fetch DTO → template → printToPDF → save)
printGatePass / printBill / printVoucher / printLedger / printTrialBalance
// renderer
lib/usePrinter.ts                                    // hook: run a print.* call + toast the result
```
Plus everything in **[phase5.md](phase5.md) §4** (`getBill`/`listBillSubjects`, `searchParty`),
**[phase4.md](phase4.md) §4**, **[phase3.md](phase3.md) §4** (`capitaliseLoan`, `capitaliseAllLoans`,
`outstandingAsOf`, `accruedForPayment`, …), and **[phase2.md](phase2.md) §3** (`post`/`postCore`,
`setOpeningBalance`, `setDefaulter`, `getTrialBalance`/`getAccountBalance`, `getMap`, …).

---

## 5. Current schema (23 tables)

Phase 1–5 (22): `person, subgroup, account, financial_year, opening_balance,
loading_contractor_year, voucher, voucher_entry, cheque, user, number_series, audit_log,
store_config, aamad, aamad_location, sauda, nikasi, nikasi_line, loan, loan_event, bardana,
saved_filter`. **Phase 6 (+1):** `year_close`.

---

## 6. Phase 7 brief — Hardening, onboarding & go-live (the last phase)

Goal: a real, installed, populated, trusted app. **No new accounting features** — this is making
the existing six phases robust and getting them onto the owner's Windows laptop.

1. **Backups (architecture.md §8 / software.md §5).** Timestamped `.db` copies **on open and on
   close**, plus the **pre-close snapshot** the Close-Year design assumed (a real file copy this
   time — Phase 6 settled for a logical rollback plan because tests run on `:memory:`; in the packaged
   app, copy the `.db` to a backups folder before `closeYear`). Configurable backup folder
   (OneDrive / Google Drive for off-machine safety). **Test a restore** end-to-end. The data layer
   (`data/db.ts`) knows the file path via `rawSqlite()`; the snapshot belongs in main, around the
   `close:run` IPC handler (keep the logical rollback too — it's the in-app undo).
2. **Validation / error handling / edge cases.** A pass over every form and engine: friendlier
   errors, guard rails (e.g. closing a year with pending cheques should warn, not silently carry the
   clearing balance), empty/oversized inputs.
3. **Performance pass.** Indexes on `(year, account, date)` are mostly there; verify the Party
   per-account metric loop and the bulk balance queries are fine at the real data size (they are at
   single-cold scale — see phase5.md §9).
4. **Data onboarding.** Enter the real first-year opening data — existing accounts, opening
   balances, current loans, pre-existing defaulters. (`setOpeningBalance`, `createLoan`,
   `setDefaulter` already exist; this is data entry + maybe a small import helper.)
5. **Packaging.** Get the GitHub Actions **windows-latest** workflow building the signed installer
   green (never yet verified), install on the **actual Windows laptop**, smoke-test, and **verify
   `printToPDF` produces a real PDF** there (untested in Phase 6).
6. **User acceptance.** Owner runs it on real data in parallel with the current method for a period;
   reconcile against the existing books; fix issues.

Follow the **recipe in [phase2.md](phase2.md) §8** for any new table/contract/service/IPC/UI/test.

---

## 7. Phase 7 done/verify checklist

- [ ] `npm run typecheck` + `npm run build` clean; all tests green (Node ABI).
- [ ] Automatic `.db` backups on open/close + a real pre-close snapshot; **a restore is tested**.
- [ ] Validation/edge-case pass; closing with pending cheques warns.
- [ ] Real opening data loaded (accounts, balances, loans, defaulters).
- [ ] Windows CI installer builds green; installed on the real laptop; PDFs print there.
- [ ] Parallel run reconciles against the existing books.
- [ ] Write **phase7.md** (or a go-live note) and add a "superseded" banner here.

---

## 8. Parked for later (unchanged + Phase 6 notes)

From phase5.md §9: push Party metrics into SQL aggregates if the dataset grows · a vyapari-bought
packets metric. From earlier phases: on-credit bardana · bardana valuation/types · partial vyapari
payments · GST · KYC fields · post-Nikasi rate revision · extra per-nikasi charges · rack-capacity
warnings · defaulter auto-clear · the settlement-ordering UI · cheque entry on the voucher screens ·
**AI chatbot** (its tools are the Party/Bills read services) · multi-user/Postgres. **Phase 6 notes:**
(a) carry-forward is party-scoped — a full balance-sheet roll-forward (cash/bank/capital) is parked;
(b) the pre-close snapshot is a logical rollback plan for now — a real `.db` file snapshot is a
Phase 7 backup task; (c) `print.ts`'s `printToPDF` path is unverified outside the packaged app.
