# Phase 2 done — and the handover for Phase 3

> **⚠️ SUPERSEDED — Phase 3 is complete. Start at [phase3.md](phase3.md).** This file is kept for
> history: §2–§4 (architecture conventions, reusable building blocks, the shared-contract
> boundary) are still accurate and worth reading, but the Phase 3 brief in §5–§9 below has been
> built and is now reference, not a to-do.

**This is the live handover doc. Start here in a new session.** It records what Phase 2
delivered, every convention and reusable building block you must follow, and the full Phase 3
brief (Loans + interest engine + cheque-clearing) with worked examples and a build recipe.

Read order for a cold start:
1. **This file** (where we are + how to build the next phase).
2. [software.md](../software.md) — *what* the app does (business rules). §3.8 Loans, §3.9 Money/cheques.
3. [architecture.md](../architecture.md) — *how* it's built. §5 data model, §6 posting map, §7 engines.
4. [README.md](../../README.md) — dev commands. [phase0.md](phase0.md)/[phase1.md](phase1.md) — older history.

Git baseline: Phase 0/1/2 are committed on `main` (latest: `46b2222` — "Phase 1 (complete) +
Phase 2: ledger core and stock operations"). Working tree clean.

---

## 0. TL;DR status

| Phase | Scope | State |
|---|---|---|
| 0 | Electron+React+SQLite scaffold, IPC, i18n, CI workflow | ✅ done (phase0.md) |
| 1 | Ledger core: PostingService, Trial Balance, Auth, Account Manager, Money Book, vouchers | ✅ done & tested |
| 2 | Stock: Store layout, Aamad, Maps, Sauda, Nikasi (auto-post), Bhada engine | ✅ done & tested |
| 3 | **Money depth: Loans + interest engine + cheque-clearing** | ⏭ **next — §6/§7 below** |

**48 tests green**, `npm run typecheck` + `npm run build` clean. Two things never verified by an
agent: (a) a manual GUI click-through of the Phase 1/2 screens; (b) the Windows CI installer
actually building green on GitHub Actions (workflow `.github/workflows/build-windows.yml` exists).

---

## 1. How to run, test, build (the ABI dance — READ FIRST)

`better-sqlite3` is a **native module**. Its compiled binary must match the runtime ABI:

| Task | Needs ABI | Command |
|---|---|---|
| `npm test` / `vitest` | **Node** | `npm rebuild better-sqlite3` first |
| `npm run dev` (the app) | **Electron** | `npm run rebuild` first |
| `npm run typecheck` / `npm run build` | neither (pure TS bundling) | run anytime |
| `npm run db:generate` | neither (drizzle-kit reads TS) | run anytime |

**The repo is currently left on the Electron ABI** (so `npm run dev` works now). Before running
tests, do `npm rebuild better-sqlite3`; afterwards `npm run rebuild` to use the app again. Tests
use `:memory:` DBs and never touch the real file. Login: **admin / admin123** (current year auto-seeded).

---

## 2. Architecture conventions you MUST follow

These are load-bearing. Phase 3 code that breaks them will corrupt the books or the build.

1. **All money is integer paise.** Never float rupees. Use `src/shared/money.ts`
   (`rupeesToPaise`, `paiseToRupees`, `formatINR`). Interest math uses **decimal.js**, rounded
   back to paise. Loan rates are **basis points** (1.5%/mo = `150` bps).
2. **Every money write goes through PostingService.** Nothing else inserts into `voucher` /
   `voucher_entry`. `post()` asserts Σdr = Σcr and writes header+lines+audit in one transaction.
   The loan/interest/cheque postings in Phase 3 build their Dr/Cr per the **posting map** (§6) and
   call `post()` (or `postCore` if inside a larger transaction).
3. **Single source of truth for types is `src/shared/`.** Enums live in `shared/enums.ts`, DTOs in
   `shared/contracts.ts`. The renderer & preload import ONLY from `src/shared` — never from
   `src/main`. Services define their data types in `shared/contracts.ts` and re-export them. See §4.
4. **No hard deletes.** Vouchers are voided (`voidVoucher`), never DELETEd. Every create/edit/void
   writes an `audit_log` row via `writeAudit`.
5. **Year-scoping.** Almost every operational table has `year_id → financial_year`. IPC handlers
   inject `yearId` + accountant `userId` from the session — the renderer never passes them.
6. **Business dates are TEXT `'YYYY-MM-DD'`; audit/created stamps are unix-epoch integers.**
7. **Idempotency for re-runnable postings.** Pattern (used by opening balance + bhada): find prior
   auto-vouchers by `sourceModule`, `voidVoucher` them, then re-post. Interest capitalisation will
   need the same discipline so re-running Close-Year doesn't double-charge.
8. **Schema change → migration.** Edit `schema.ts`, run `npm run db:generate`, commit the new
   `drizzle/000N_*.sql` + snapshot. `src/main/data/db.test.ts` asserts the table count — bump it.

---

## 3. Reusable building blocks (signatures Phase 3 will lean on)

Import these instead of re-implementing. All under `src/main/`.

**`services/posting.ts`** — the money writer:
```ts
post(input: PostInput): PostResult                       // own transaction
postCore(tx: Db, input: PostInput): PostResult           // inside your transaction
nextSeries(tx: Db, yearId: number, docType: string): number   // running serials (e.g. doc numbers)
voidVoucher(voucherId: number, reason: string, userId?: number): void
// PostInput { yearId; type: VoucherType; date; narration?; accountantUserId?;
//             sourceModule?; sourceId?; isAuto?; entries: { accountId; drPaise; crPaise; tag? }[] }
```
*Posting inside another transaction (atomic multi-write): open `db().transaction(tx => { … postCore(tx, …) … })`. Do NOT call `post()` inside a transaction — it opens its own. See `services/nikasi.ts` for the worked pattern.*

**`data/seed.ts`** — system accounts (the cold's own books):
```ts
SYSTEM_ACCOUNTS            // { CASH, CAPITAL, RENT_INCOME, INTEREST_INCOME, BARDANA_SALES,
                           //   BARDANA_PURCHASE, SALARY_EXPENSE, LOADING_EXPENSE, OPENING_EQUITY }
getSystemAccountId(name): number       // resolve by stable name; throws if unseeded
seedReferenceData()                    // subgroups + system accounts + store_config (idempotent)
```
*Phase 3 needs `INTEREST_INCOME` (already seeded) and a new **"Cheques in Clearing"** system
account — add it to `SYSTEM_ACCOUNTS` + the seed (see §7).*

**`services/ledger.ts`** — read models (pure queries):
```ts
getAccountLedger(accountId, yearId): LedgerLine[]   // running balance, oldest first
getAccountBalance(accountId, yearId): number        // net signed (Dr positive)
getTrialBalance(yearId): TrialBalance               // { rows, totalDr, totalCr, balanced }
```
*The `tag` on each entry (`rent | loan | interest | trade | opening | general`) lets you compute a
sub-balance from one account — e.g. standing loan = `loan`+`interest`-tagged net. `engines/bhada.ts`
`getStandingBhada` shows the rent-tag pattern; copy it for loans.*

**`audit/audit.ts`**: `writeAudit({ userId?, action, entity, entityId?, before?, after? }, handle?=db())`.

**`auth/auth.ts`**: `login`, `createUser`, `createYear`, `listYears`, `ensureBootstrap`; `Session`.
**`session.ts`**: `requireSession(): Session` (use in IPC), `setSession`, `clearSession`, `getSession`.

**`data/db.ts`**: `openDb(path)`, `migrate(folder)`, `db()`, `rawSqlite()`, `closeDb()`, type `Db`.

**`test-utils.ts`** (test helper, not a test): `setupDb()`, `makeYear(year=2026, rentRatePaise=0)`,
`makeAccount(name, type, subgroupName)`, `groupId(name)`.

---

## 4. The shared-contract boundary (the gotcha that bit me)

The web (renderer) tsconfig is `composite` with an explicit file list. If preload or a renderer
file imports a type from `src/main/**`, the whole backend gets pulled into the web program and
typecheck fails with **TS6307**. **Fix already in place:** DTOs live in `src/shared/contracts.ts`,
enums in `src/shared/enums.ts`; `schema.ts` re-exports the enums for Drizzle's column `{ enum }`.

To add a Phase 3 type that crosses the IPC boundary:
1. Define the interface in `src/shared/contracts.ts` (import enums from `./enums`).
2. In the service, `import type { X } from '../../shared/contracts'` and `export type { X } …` it.
3. In `src/preload/index.ts`, import it from `../shared/contracts` (never from `../main`).

---

## 5. Current schema (18 tables) + what Phase 3 adds

Existing (Phase 1+2): `person, subgroup, account, financial_year, opening_balance,
loading_contractor_year, voucher, voucher_entry, cheque, user, number_series, audit_log,
store_config, aamad, aamad_location, sauda, nikasi, nikasi_line`.

**`cheque` already exists** (Phase 1, unused so far): columns `voucherId?, no, bank, direction
('received'|'given'), amountPaise, date, issueDate, clearanceDate, status ('pending'|'cleared'|
'bounced'), bankAccountId?, partyAccountId?`. Phase 3 wires its lifecycle.

**Phase 3 must ADD** (architecture.md §5):
- `loan` — `id, yearId, category ('kisan'|'vyapari'|'other'), accountId→account, date,
  principalPaise, mobile?, mode ('cash'|'bank'), bankAccountId?, nature ('direct'|'indirect'),
  monthlyRateBps (default 150), interestStartDate (direct=sanction date; indirect=1 Jan next year),
  remark?, createdAt`. Suggest indexes on `(yearId, accountId)`.
- `loan_event` — `id, loanId→loan, date, type ('disbursement'|'payment'|'capitalisation'),
  amountPaise, voucherId?→voucher`.
- Add enums to `shared/enums.ts`: `LOAN_CATEGORIES`, `LOAN_NATURES`, `LOAN_MODES`, `LOAN_EVENT_TYPES`.

After editing `schema.ts`: `npm run db:generate` → migration `0002_*`; bump `db.test.ts` count to **20**.

---

## 6. Phase 3 spec — Loans (Udhaar) · software.md §3.8

Loans the cold gives, three categories: **Kisan / Vyapari / Others**.
- **Fields:** Date, Amount, Mobile, **Loan type** (single Cash-or-Bank choice → `mode`),
  **Direct / Indirect** (`nature`), Remark. Rate defaults **1.5%/month** = `monthlyRateBps 150`, editable.
- **Direct loan** — party asks directly; created manually; **interest accrues from the sanction date**.
- **Indirect loan** — arises from **unpaid dues**; created manually OR auto-generated at year-end;
  **interest-free in the year incurred, then from 1 Jan** of the next year.
- A party can hold **multiple loans**; all show in the party's ledger.
- **Part payment** deducts from the outstanding total (principal + interest to that day); the
  remainder keeps accruing.

**Posting map (architecture.md §6) — build these Dr/Cr and call `post()`:**
| Event | Debit | Credit | tag |
|---|---|---|---|
| Loan given | Party | Cash/Bank (`mode`) | `loan` |
| Loan interest (1 Jan + on payment) | Party | Interest Income | `interest` |
| Loan repaid by cash/cheque | Cash/Bank | Party | `loan` |

**Standing loan** for a party = `loan`+`interest`-tagged net (mirror `getStandingBhada`).

### Interest engine — architecture.md §7 (the core deliverable)
Rule: **simple in the first year, compound thereafter; capitalise every 1 Jan.** Use decimal.js,
round to paise. **Required tests — reproduce to the rupee (paise-exact):**

> **Full year:** ₹1,00,000 on **1 Jan 2026**, unpaid all year → on **1 Jan 2027** principal
> becomes **₹1,18,000** (12 × 1.5% = ₹18,000 added, simple). Then 1.5%/mo runs on ₹1,18,000 →
> **1 Jan 2028 = ₹1,39,240** (₹1,18,000 × 18% = ₹21,240, compound).
>
> **Mid-year:** sanctioned partway through 2026 → simple interest pro-rated by months to 31 Dec,
> capitalised 1 Jan 2027.
>
> **Part-payment:** a payment on day D clears (principal + interest accrued to D); the remainder
> continues accruing. Verify the post-payment balance and subsequent accrual.

The engine must also **compute the live figure on the fly** (for Bills/Party in Phase 5) — i.e. a
pure `outstandingAsOf(loanId, date)` that doesn't post, plus the posting functions that DO post at
capitalisation and on payment.

---

## 7. Phase 3 spec — Cheque-clearing engine · architecture.md §7 / software.md §3.9

**Cash and cheque only.** A cheque records no., bank, date, issue date, clearance date, and **only
hits the bank on its clearance date** (both received and given). Money Book shows **cleared money
only** (it already filters by the `Cash and Bank` subgroup — keep clearing OUT of that subgroup).

**Design:** add a system account **"Cheques in Clearing"** (a current asset/liability NOT in the
`Cash and Bank` subgroup, so the Money Book ignores it). Add it to `SYSTEM_ACCOUNTS` + `seed.ts`.
Lifecycle (build entries per posting map, post via `post()`; record in the `cheque` table):
- **Cheque received** (a Receipt by cheque): on entry **Dr Cheques-in-Clearing / Cr Party**
  (status `pending`). On clearance date **Dr Bank / Cr Cheques-in-Clearing** (status `cleared`).
- **Cheque given** (a Payment by cheque): on entry **Dr Party / Cr Cheques-in-Clearing**. On
  clearance **Dr Cheques-in-Clearing / Cr Bank**.
- **Bounce:** reverse the clearing entry and mark `bounced` (no bank movement ever happened).

**Required tests:** a pending cheque is not in the bank book; on its clearance date it moves into
the bank (and Money Book); a bounce reverses cleanly leaving the party owing again.

---

## 8. Recipe — how to add a Phase 3 module (follow the Phase 2 pattern exactly)

1. **Enums** → `src/shared/enums.ts` (loan categories/natures/modes/event types).
2. **Schema** → `src/main/data/schema.ts` (`loan`, `loan_event`); `npm run db:generate`; bump
   `db.test.ts` count to 20.
3. **Seed** → add `CHEQUES_IN_CLEARING` to `SYSTEM_ACCOUNTS` + `SYSTEM_ACCOUNT_SEED` in `seed.ts`.
4. **DTOs** → `src/shared/contracts.ts` (LoanInput, LoanRow, LoanEventRow, StandingLoan,
   ChequeInput, ChequeRow, interest-quote DTOs…).
5. **Service** → `src/main/services/loans.ts`, `services/cheques.ts` (CRUD + list + read models;
   import & re-export the DTOs).
6. **Engines** → `src/main/engines/interest.ts`, `engines/cheque-clearing.ts` (the math + the
   postings; decimal.js for interest). Put the worked-example tests beside them (`*.test.ts`).
7. **IPC** → `src/main/ipc/loans.ts` (or extend a file), register in `ipc/index.ts`; inject
   `yearId`/`userId` from `requireSession()`.
8. **Preload** → add a `loans` / `cheques` namespace in `src/preload/index.ts` (types from
   `../shared/contracts`).
9. **UI** → `src/renderer/src/pages/LoansPage.tsx` (+ cheque entry on the voucher screens / a
   Cheques page); add nav item + route in `components/AppLayout.tsx`; add EN+HI strings to
   `locales/{en,hi}.json` as you build (don't retrofit).
10. **Tests** → engine tests (the §6/§7 worked examples) + a `phase3.integration.test.ts` capstone
    (loan given → interest capitalised across a 1-Jan boundary → part-payment → cheque clears),
    asserting the trial balance stays balanced throughout.

Run `npm rebuild better-sqlite3 && npm test`, then `npm run typecheck && npm run build`, then
`npm run rebuild` to use the app.

---

## 9. Phase 3 done/verify checklist

- [ ] `npm run typecheck` + `npm run build` clean; all tests green (Node ABI).
- [ ] Interest engine reproduces ₹1,00,000 → ₹1,18,000 → ₹1,39,240 to the paise; mid-year and
      part-payment cases correct.
- [ ] Loan given/repaid/interest post per the map; standing loan (loan+interest tag) correct; a
      party's ledger shows multiple loans.
- [ ] A cheque posts to "Cheques in Clearing" on entry and moves to the bank only on its clearance
      date; the Money Book shows it only when cleared; a bounce reverses cleanly.
- [ ] Trial balance stays net-zero throughout; `phase3.integration.test.ts` capstone passes.
- [ ] EN + HI strings added for every new screen.
- [ ] Update this handover: write **phase3.md** and add a "superseded" banner here.

---

## 10. What Phase 2 delivered (reference)

**New files:** `drizzle/0001_*.sql`; `shared/{enums.ts (+DELIVERY_TARGETS), contracts.ts}`;
`main/data/{schema.ts +6 tables, seed.ts +store_config}`; `main/services/{store,aamad,maps,sauda,
nikasi}.ts`; `main/engines/bhada.ts`; `main/ipc/stock.ts`; tests for aamad/nikasi/maps/bhada +
`phase2.integration.test.ts`; preload `store/aamad/sauda/nikasi/maps/bhada` namespaces; renderer
pages `Aamad/Maps/Sauda/Nikasi/Store`; nav+routes; EN/HI strings.

**Key decisions:**
- Locations are **denormalised ints** (room/floor/rack); `store_config` holds only grid dims
  (cap 8×10×200, current 5×6×160); `assertLocationInBounds` validates.
- **Nikasi posting is atomic** (`createNikasi` → one transaction → `postCore`): vyapari sale =
  Dr Vyapari (total) / Cr each Kisan (proceeds), tag `trade`; kisan self-withdrawal posts nothing.
  Over-withdrawal blocked via `currentStockAtRack` (Aamad − Nikasi).
- **Bhada = ledger + `rent` tag, no separate table.** `accrueRent` posts full-year rent
  (Dr Kisan / Cr Rent Income), idempotent (voids prior `sourceModule 'bhada'` voucher + re-posts).
  Recovery is **not** a separate entry — the kisan's sale-proceeds credit nets against the rent
  debit. `bhada_recovered_paise` on a nikasi is informational; `weight_kg` is recorded only.
- **`postCore`/`nextSeries`** were extracted from `posting.ts` so services post/serialise inside
  their own transaction.

**Required Phase 2 tests (all green):** bhada accrual + recovery netting; nikasi sale posting
(Vyapari Dr / Kisan Cr); Current Stock = Aamad − Nikasi; plus the settlement capstone.

---

## 11. Parked for later (do not build now)

Partial vyapari payments · GST · KYC fields · post-Nikasi rate revision · extra per-nikasi charges ·
bardana valuation/types · rack-capacity warnings · defaulter auto-clear · the full settlement
ordering UI (rent-first split is a **Bills/Phase 5** concern; the ledger already nets it) · AI
chatbot · multi-user/Postgres. Phases after 3: **4** Bardana + staff/loading expenses · **5** Bills
+ Party search · **6** Year-end Close + printing/PDF · **7** hardening + onboarding + go-live.
