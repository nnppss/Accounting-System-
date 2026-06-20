# Phase 1 — Foundation (in progress)

Handoff doc. Read this (and `phase0.md` for the scaffold baseline), then continue
**Phase 1** where it left off before moving to Phase 2.

See [software.md](software.md) for *what* the app does, [architecture.md](architecture.md)
for *how* it's built, and [README.md](README.md) for dev commands.

---

## 1. Status

| Chunk | Status | Commit |
|---|---|---|
| DB foundation — schema, migrations, Electron-free data layer, seed | ✅ done | `d3e2d44` |
| PostingService (Σdr = Σcr enforcer, the single money writer) | ❌ not started |
| Trial Balance read model | ❌ not started |
| Auth + year-context (login: year · username · password · accountant) | ❌ not started |
| Account Manager (create/list/view-ledger) | ❌ not started |
| Money Book (cash + per-bank, month-wise) | ❌ not started |

**Do not start Phase 2 until all five remaining chunks are done and a net-zero Trial Balance
is provable on sample data.**

---

## 2. What exists (new files from Phase 1 so far)

```
drizzle/
  0000_busy_proudstar.sql   # first migration (all 12 tables); do NOT hand-edit
  meta/
    _journal.json            # drizzle-kit migration registry
    0000_snapshot.json       # schema snapshot for drizzle-kit

src/
  main/
    data/
      schema.ts             # REAL schema (replaced app_meta placeholder) — see §3
      db.ts                 # REWORKED: Electron-free openDb(path)/migrate/closeDb
      seed.ts               # NEW: idempotently inserts the 9 subgroups on startup
      db.test.ts            # NEW: 3 foundation tests (12 tables, seed idempotency, FK)
    index.ts                # UPDATED: calls openDb → migrate → seed on startup
    ipc/index.ts            # UPDATED: ping now reads seeded subgroup count (smoke test)

electron-builder.yml        # UPDATED: drizzle/ shipped as extraResources in prod build
```

**Still placeholders (Phase 0 era, to be replaced):**
- `src/main/ipc/index.ts` — only the demo `ping`. Real module handlers go here.
- `src/preload/index.ts` — only `ping`. Real typed API methods go here.
- `src/renderer/src/App.tsx` — demo card. Real routing/pages go here.
- `src/renderer/src/locales/{en,hi}.json` — still have `phase0.*` demo keys.

---

## 3. Schema summary (architecture.md §5)

12 tables in 3 groups:

**Masters**
| Table | Purpose |
|---|---|
| `person` | Real human — links multiple role-accounts (kisan + vyapari, etc.) |
| `subgroup` | 9 fixed accounting groups (seeded); drives reporting nature |
| `account` | Every party + the cold's own books; `is_defaulter` flag; `is_system` flag |
| `financial_year` | Jan–Dec year; holds flat per-packet `rent_rate_paise` |
| `opening_balance` | Carried-forward balance per account per year (bilateral dr/cr) |
| `loading_contractor_year` | Per-year charges + labourer counts for contractor accounts |

**Ledger core**
| Table | Purpose |
|---|---|
| `voucher` | Header; one per money action; `type` ∈ {receipt, payment, journal, contra} |
| `voucher_entry` | Ledger line; `dr_paise` + `cr_paise` + `tag` ∈ {rent, loan, interest, trade, opening, general} |
| `cheque` | Cash & cheque only; hits bank only on `clearance_date` (Phase 3 engine) |

**System**
| Table | Purpose |
|---|---|
| `user` | Login user; argon2/bcrypt `password_hash`; `accountant_name` stamped on vouchers |
| `number_series` | Per-(year, doc_type) running serial for system-issued numbers |
| `audit_log` | Every create/edit/void with before/after JSON + user + timestamp |

**Key conventions baked into the schema:**
- Money = **integer paise** everywhere (never float rupees).
- Business dates = **TEXT 'YYYY-MM-DD'** (timezone-free).
- Audit/created stamps = **unix epoch seconds** (`INTEGER`, `DEFAULT (unixepoch())`).
- Nearly every operational table is **year-scoped** via `year_id → financial_year`.
- Composite index on `(year_id, account_id, date)` pattern throughout.
- **No hard deletes** — `voucher` has `voided_at` / `voided_reason`; audit trail logs all changes.
- `tag` on `voucher_entry` lets a single running party balance still report standing bhada,
  loan remaining, and trade separately (needed by Bills module in Phase 5).

---

## 4. Gotchas (carry forward from phase0.md + new ones)

### 4.1 better-sqlite3 ABI dance (unchanged from Phase 0)
- `npm test` needs the **Node ABI**: `npm rebuild better-sqlite3`
- `npm run dev` needs the **Electron ABI**: `npm run rebuild`
- After running tests, always restore the Electron ABI before running the app.
- All new DB tests use **`:memory:`** via `openDb(':memory:')` — never touch the app's
  real `.db` file from a test. See `db.test.ts` for the pattern.

### 4.2 db.ts is now Electron-free
`openDb(path)` takes the DB path as an argument. The Electron layer (`main/index.ts`)
resolves `app.getPath('userData')` and passes it in. Tests pass `':memory:'`.
**Never import `electron` from anything under `services/`, `engines/`, `domain/`, or `data/`**
(except `main/index.ts`). This keeps the whole backend unit-testable in plain Node.

### 4.3 Migrations run via drizzle-kit's migrator
`migrate(migrationsFolder)` in `db.ts` calls `drizzle-orm/better-sqlite3/migrator`.
- Dev: `migrationsFolder = join(app.getAppPath(), 'drizzle')` (the repo root `drizzle/`).
- Prod: `migrationsFolder = join(process.resourcesPath, 'drizzle')` (shipped via
  `electron-builder.yml` `extraResources`).
- **Never hand-edit** files in `drizzle/`. Always edit `schema.ts` then run `npm run db:generate`.
- After adding tables/columns to `schema.ts`, run `npm run db:generate` to emit a new
  migration file, then commit both.

### 4.4 seed.ts is idempotent
`seedReferenceData()` uses `INSERT … ON CONFLICT DO NOTHING`. Safe to call on every
startup. Add more reference data (e.g. system accounts) to this file — don't do it in a
migration (migrations are structural, seed is data).

### 4.5 argon2 / bcrypt not yet installed
Auth (Phase 1 remaining) needs a password-hashing library. Neither is in `package.json`
yet. Add `argon2` (`npm install argon2`) — it has a native module like `better-sqlite3`
so it needs to be handled in the same rebuild pattern. Alternatively `bcryptjs` (pure JS,
no native rebuild needed, but slower). Recommendation: `bcryptjs` for simplicity since
this is single-user local software and speed doesn't matter.

---

## 5. Remaining Phase 1 work (do these in order)

### 5.1 PostingService — `src/main/services/posting.ts`
The **single function that writes all money**. Nothing else touches `voucher` or
`voucher_entry`.

```ts
interface PostInput {
  yearId: number
  type: VoucherType
  date: string           // 'YYYY-MM-DD'
  narration?: string
  accountantUserId?: number
  sourceModule?: string
  sourceId?: number
  isAuto?: boolean
  entries: Array<{
    accountId: number
    drPaise: number
    crPaise: number
    tag?: EntryTag
  }>
}

function post(input: PostInput): { voucherId: number; voucherNo: number }
```

Steps inside `post()`:
1. Assert `Σ drPaise === Σ crPaise` — throw if unbalanced (never write an unbalanced voucher).
2. Get the next voucher number from `number_series` (increment atomically).
3. Write `voucher` + all `voucher_entry` rows **in one SQLite transaction**.
4. Write an `audit_log` row (action: `'create'`, entity: `'voucher'`).

**Engine tests to write alongside:**
- Balanced voucher posts successfully and returns `voucherId`.
- Unbalanced voucher throws (Σdr ≠ Σcr).
- `number_series` increments correctly per (year, type).
- Transaction rolls back fully on any error (no partial writes).

### 5.2 Trial Balance read model — `src/main/services/ledger.ts`
A pure query — no writes. Two functions:

```ts
// All entries for one account in one year, with running balance.
function getAccountLedger(accountId: number, yearId: number): LedgerLine[]

// Sum of all dr_paise and cr_paise across all non-voided entries for a year.
// Must always return { totalDr === totalCr } if PostingService is the only writer.
function getTrialBalance(yearId: number): TrialBalanceRow[]
```

The Trial Balance proves the books tie. Write a test: post two balanced sample vouchers,
assert `Σdr === Σcr` from `getTrialBalance`.

### 5.3 Auth + year-context — `src/main/auth/`
Login flow: year → username → password → accountant.
- `src/main/auth/auth.ts` — `createUser(username, password, accountantName)` (hashes pw),
  `login(year, username, password)` returns a session object.
- Session = `{ userId, yearId, accountantName }` — held in memory (Zustand on the renderer,
  passed as IPC context in the main process).
- The `accountantUserId` field on `voucher` is stamped from the session on every `post()`.
- Seed a default user (`admin` / `admin123` or configurable) so the app isn't locked out
  on first run — the owner can change it after.

IPC channels to add:
- `auth.login(year, username, password)` → `{ ok, session? }`
- `auth.createYear(year, rentRatePaise)` → creates a `financial_year` row
- `auth.listYears()` → available years for the login dropdown

### 5.4 Account Manager — `src/main/services/accounts.ts` + IPC + UI
Backend:
- `createPerson(fields)` → `personId`
- `createAccount(fields)` → `accountId` (validate type, subgroup exists, person optional)
- `listAccounts(filters?)` → paginated list
- `getAccountLedger(accountId)` → calls `ledger.getAccountLedger`
- `setOpeningBalance(accountId, yearId, amountPaise, drCr)`
- `setDefaulter(accountId, isDefaulter)`

IPC channels: `account.create`, `account.list`, `account.ledger`, `account.setOpening`,
`account.setDefaulter`.

UI pages (renderer):
- **Account list** — table with name / type / subgroup / balance; filter by type; click → ledger.
- **Create account** form — type selector drives which fields appear; person-link selector
  (search existing persons or create new).
- **Account ledger** — date / narration / dr / cr / balance columns.
- **Opening balance** entry — per account, for the working year.

**Subgroups to seed as system accounts** (needed before any posting works):
These are the cold's own books. Seed them in `seed.ts` after the subgroup seed:
- Cash (type: other, subgroup: Cash and Bank, isSystem: true)
- Capital (type: other, subgroup: Capital Account, isSystem: true)
- Rent/Bhada Income (type: other, subgroup: Revenue Account, isSystem: true)
- Interest Income (type: other, subgroup: Income from Other Resource, isSystem: true)
- Bardana Sales (type: other, subgroup: Income from Other Resource, isSystem: true)
- Bardana Purchase (type: other, subgroup: Direct Expense, isSystem: true)
- Salary Expense (type: other, subgroup: Direct Expense, isSystem: true)
- Loading Expense (type: other, subgroup: Direct Expense, isSystem: true)
- Opening Balance Equity (type: other, subgroup: Capital Account, isSystem: true)

Banks are created by the user (type: other, subgroup: Cash and Bank) — one per actual bank.

### 5.5 Money Book read model — UI only (no new backend needed)
Query over `voucher_entry` joining `voucher` and `account` where `account.subgroup =
'Cash and Bank'`, grouped by month.

IPC channel: `moneybook.getSummary(accountId, yearId)` → month rows with
`{ month, openingPaise, receiptsPaise, paymentsPaise, balancePaise }`.
Drill-down: `moneybook.getDetail(accountId, yearId, month)` → transaction lines.

UI: selector (Cash / each Bank) → month-wise table → click month → detail drawer.

---

## 6. Phase 1 done/verify checklist

Before calling Phase 1 complete and moving to Phase 2:

- [ ] `npm run typecheck` clean
- [ ] `npm test` green (all existing + new engine tests)
  - PostingService: balanced posts, unbalanced rejects, number_series increments, rollback
  - Trial Balance: Σdr = Σcr after sample posts
  - Auth: login succeeds/fails, wrong password rejected
- [ ] `npm run build` clean
- [ ] Can log in with a year + username + password
- [ ] Can create a Kisan account + a Vyapari account + a Cash account
- [ ] Can post a sample Receipt voucher (Vyapari pays cash → Cash Dr / Vyapari Cr)
- [ ] Trial Balance shows net zero
- [ ] Money Book shows the receipt in the Cash book under the right month

---

## 7. Phase 2 preview (Stock operations)

After Phase 1 is fully verified, Phase 2 adds the physical stock flow:

1. **Store layout config** — Room → Floor → Rack (up to 8 × 10 × 200; currently 5 × 6 × 160).
   New tables: `room`, `floor`, `rack` (or a config table + denormalised location columns on
   `aamad_location` and `nikasi_line` — simpler). See architecture.md §5.
2. **Aamad** (stock-in) — `aamad` header + `aamad_location` lines. Physical only, no posting.
   IPC: `aamad.create`, `aamad.list`, `aamad.search`.
3. **Maps** (three grids: Aamad / Nikasi / Current Stock) — pure read queries over aamad +
   nikasi. Cell drill-down → racks → popup. No writes.
4. **Sauda** (deal record) — `sauda` table; physical only; drives rate into Nikasi.
5. **Nikasi** (gate-pass / stock-out) — `nikasi` header + `nikasi_line`; auto-posts via
   PostingService (Vyapari Dr / Kisan Cr per line; bhada recovery).
6. **Bhada engine** — `src/main/engines/bhada.ts`; posts full-year rent once total stored
   qty is known (Dr Kisan / Cr Rent Income); tracks recovery per nikasi; standing bhada query.

Phase 2 engine tests:
- Bhada accrual + recovery netting.
- Nikasi sale posting (Vyapari Dr / Kisan Cr).
- Current Stock = Aamad − Nikasi at all times.

Phase 2 done/verify: run the worked settlement example end-to-end (kisan stores → deals →
nikasi → money) and confirm maps, ledger entries, and standing bhada all agree.

---

## 8. Git log (as of this handoff)

```
d3e2d44 Phase 1: ledger schema, migrations, and Electron-free data layer
0452ec9 Phase 0: verified Electron + React + SQLite scaffold and project specs
```
