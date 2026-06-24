# Paritosh Cold — Architecture & Tech Stack

Technical design of the Paritosh Cold accounting software, **as built**. See [software.md](software.md) for *what* it does; this document is *how* it's built. (Updated to reflect the shipped code — phases 0–6 complete plus the post-phase hardening that followed: accountant identity, account numbers, people management, the Bills & Salaries view, and the Material-3 UI theme makeover.)

---

## 1. The decision: a local-first desktop app

The software is **personal, single-user, offline, on one Windows laptop** (developed on a MacBook Air M2). That rules out a client-server web app — running a backend server + a database server for one person is pure overhead. Instead:

> **A local-first desktop app, built with web technology, with the entire database in a single file.**

This gives a modern UI and easy AI integration (it's JavaScript/TypeScript) with desktop simplicity: one app, one database file, offline, trivial backups (copy the file), full data ownership. Developed on the Mac, shipped to Windows. If it ever became multi-user, the same core lifts onto a server — but that isn't built now.

---

## 2. Tech stack (actual)

| Layer | Choice | Notes |
|---|---|---|
| Desktop shell | **Electron 32** | `contextIsolation` on, `nodeIntegration` off, `sandbox` off |
| Dev / build | **electron-vite 2** (dev + bundle), **electron-builder 25** (`npm run package`) | one config: `electron.vite.config.ts` |
| UI | **React 18 + TypeScript 5.6 + Vite 5** | |
| Routing | **react-router-dom 6**, `HashRouter` | hash routing works from `file://` in the packaged app |
| Component kit | **Ant Design 5** (`antd` + `@ant-design/icons`) | tables / forms / date-pickers for a data-dense accounting UI |
| Theming | shared antd **`ConfigProvider` theme** (`renderer/src/theme.ts`) + global CSS (`styles.css`) + **Inter** web font | Material-3-derived teal/cool-slate palette; cosmetic only — no page changes its markup |
| Data fetching / state | **TanStack Query 5** + **Zustand 5** | Query caches the IPC API; Zustand holds session + UI filter state (`accountsFilter`, `billsView`) |
| i18n | **i18next + react-i18next** | **bilingual English / Hindi**, toggled live from the header (`locales/en.json`, `hi.json`) |
| Database | **SQLite** via **better-sqlite3 11** | embedded, synchronous; one file; ACID; WAL; FKs on |
| Schema / migrations | **Drizzle ORM 0.36** + **drizzle-kit** | typed schema; generated SQL migrations in `drizzle/` (0000 → 0009) |
| Money | **integer paise** in DB; **decimal.js** for interest, rounded back to paise | never raw float (`src/shared/money.ts`) |
| Dates | **dayjs** in the UI; business dates stored as `TEXT 'YYYY-MM-DD'` | audit/created stamps are unix-epoch ints |
| Auth | `user` table + **bcryptjs** hash | local login (spec said argon2/bcrypt; bcryptjs shipped) |
| Printing | HTML templates → Electron **`printToPDF`** | gate pass, bill, voucher, ledger, trial balance |
| AI | **planned, not built** — Anthropic TS SDK in main, tool-calling the read services | see §9 |
| Release | dev on **Mac**; Windows installer via **GitHub Actions** (windows runner) | better-sqlite3 is native → must build on Windows |

---

## 3. Process model = the architecture

Electron splits into OS processes, and that split *is* the layering:

- **Renderer (Chromium)** — the **React UI**. No database access (`contextIsolation` on, `nodeIntegration` off).
- **Preload** — a `contextBridge` exposing one **typed API** (`window.api.nikasi.create(...)`). The renderer's only door to the backend. Fully typed: `preload/index.ts` imports the shared contract types, so the renderer is typed end-to-end.
- **Main process (Node)** — the **brain**: IPC handlers → application services → engines → domain → SQLite. All logic, the database, and the filesystem live here.

Renderer ↔ Main talk over **IPC** (`ipcRenderer.invoke` / `ipcMain.handle`) — request/response. Because everything goes through these typed handlers, **if the app ever went multi-user the IPC handlers lift to HTTP endpoints with minimal change.** The working **year + accountant live in a main-process session** (`src/main/session.ts`), so query/post methods never pass them across the bridge.

```
Renderer (React UI)        ← Presentation  (src/renderer)
      │  typed IPC
Preload (contextBridge)    ← the API contract  (src/preload)
      │  secure boundary
Main process (Node):       (src/main)
   ipc/                    ← the API surface (one module per namespace)
   services/               ← business rules (posting, nikasi, bills, party, …)
   engines/                ← interest · bhada · cheque-clearing · close-year
   data/                   ← drizzle schema, db, seed
   audit/ auth/ printing/  ← cross-cutting
      │
   one .db file            ← the books (userData/paritosh.db)
```

Shared types/enums live in **`src/shared/`** — the one place both the Node and web TS projects include — so preload/renderer never import backend files.

---

## 4. Folder structure (actual)

```
paritosh/
  src/
    main/                       # Node — the brain
      index.ts                  # app + window bootstrap (open db → migrate → seed → bootstrap → backfill codes)
      session.ts                # working-year + accountant session
      ipc/                      # one registrar per namespace; index.ts wires them all
        accounts auth vouchers ledger moneybook stock loans
        expenses views close print audit
      services/                 # accounts, posting, vouchers, ledger, moneybook,
                                # store, aamad, sauda, nikasi, maps, loans, cheques,
                                # bardana, expenses, bills, party
      engines/                  # interest, bhada, cheque-clearing, close-year
      data/                     # db.ts, schema.ts, seed.ts
      audit/audit.ts            # writeAudit wrapper
      auth/auth.ts              # login, bootstrap, hashing
      printing/                 # templates.ts (HTML) + print.ts (printToPDF)
      *.integration.test.ts     # phase1–6 end-to-end tests
    preload/index.ts            # contextBridge typed API  (+ index.d.ts)
    renderer/                   # React app
      src/pages/                # 20 route pages (see §8)
      src/components/           # AppLayout, AccountSearchSelect
      src/store/                # zustand: session, accountsFilter, billsView
      src/locales/              # en.json, hi.json
      src/lib/                  # format, usePrinter
      src/theme.ts · src/styles.css  # shared antd theme + global CSS (UI makeover)
    shared/                     # enums.ts, contracts.ts, money.ts (+ tests)
  drizzle/                      # generated migrations 0000–0009 + meta
  scripts/                      # seed-2025-fullyear.ts, test-close-2025.ts, verify-close-fix.ts
  docs/                         # architecture.md, software.md, BUILD.md, README.md + history/ (phase0–6 build journals)
  electron.vite.config.ts · electron-builder.yml · drizzle.config.ts · vitest.config.ts
  README.md                     # repo-root dev quickstart
```

---

## 5. Data model (SQLite — money as INTEGER paise)

All tables in `src/main/data/schema.ts`. Conventions: money as **integer paise**; loan rate as **basis points** (1.5% = 150 bps); business dates `TEXT 'YYYY-MM-DD'`; nearly every operational table scoped by `year_id`; **no hard deletes** of ledger data (void/reverse); indexes on the `(year, account, date)` access paths.

**Masters**
- `person` (name, son_of, village_city, state, phone) — one human, many role-accounts.
- `account` (**code**, name, type, subgroup_id, person_id?, is_defaulter, **is_system**, job?) — every party + the cold's own books. `code` is the human account number (e.g. `K-26-0001` = type prefix · 2-digit year · per-type serial); `is_system` marks the cold's own heads.
- `account_series` (type → current_no) — lifetime per-type serial for account numbers.
- `subgroup` (name, nature) — the **9 fixed groups** (seeded).
- `financial_year` (year, status `open|closed`, **rent_rate_paise**).
- `opening_balance` (account, year, amount_paise, dr_cr) — carried forward, bilateral.
- `loading_contractor_year` (loading/unloading charge_paise, labourer counts) — per contractor per year.

**Ledger core**
- `voucher` (year, **no**, type, date, narration, accountant_user_id, source_module, source_id, is_auto, **voided_at/voided_reason**).
- `voucher_entry` (voucher, account, **dr_paise**, **cr_paise**, **tag**) — *the ledger line*.
- `cheque` (no, bank, direction, amount, date/issue/clearance dates, **status** `pending|cleared|bounced`, bank_account_id, party_account_id) — links to its voucher.

**Operations**
- `store_config` (single row: rooms, floors, racks_per_floor — current 5×6×160, cap 8×10×200).
- `aamad` (year, no `YYYY-serial`, date, kisan, total_packets) + `aamad_location` (room, floor, rack, packets).
- `sauda` (year, date, vyapari, kisan, packets, rate_paise).
- `nikasi` (year, bill_no, date, vehicle_no, delivered_to_type, delivered_to_account, received_by, bhada_recovered_paise, voucher_id?) + `nikasi_line` (from_kisan, room/floor/rack, packets, weight_kg, rate_paise).
- `loan` (year, category, account, date, principal_paise, mobile, mode, bank_account_id?, nature, **monthly_rate_bps**, **interest_start_date**, remark) + `loan_event` (date, type `disbursement|payment|capitalisation`, amount_paise, voucher_id?).
- `bardana` (year, direction, date, party_account_id?, rate_paise, qty, amount_paise, **paid_paise**, mode, bank_account_id?, voucher_id?) — supports full / partial / on-credit settlement.

**System**
- `user` (username, password_hash, accountant_name, role).
- `audit_log` (ts, user_id, **accountant_name**, action, entity, entity_id, before_json, after_json).
- `number_series` (year, doc_type, current_no) — per-(year, doc) serials (voucher no., nikasi bill no., …).
- `saved_filter` (user, module, name, criteria_json) — Party-search presets (deletable; not a ledger record).
- `year_close` (year, next_year, status `closed|rolled_back`, closed_by, **summary_json**, **rollback_json**, closed_at, rolled_back_at).

**Seeded reference data** (`data/seed.ts`, idempotent on startup):
- The **9 subgroups**: Capital Account · Cash and Bank · Direct Expense · Farmer · Sundry Creditors · Sundry Debtors · Secured Loans · Revenue Account · Income from Other Resource.
- The cold's own **system accounts**: Cash · Capital · Rent/Bhada Income · Interest Income · Bardana Sales · Bardana Purchase · Salary Expense · Loading Expense · Opening Balance Equity · **Cheques in Clearing**. (Banks are *not* seeded — the user creates one account per real bank.)

**Read models — stored nowhere, all computed by queries:** ledger, trial balance, the three stock maps, money book, bills, party search.

---

## 6. The double-entry core

Every money action calls one **`PostingService.post()`** (`services/posting.ts`), which in a single SQLite transaction:
1. asserts **Σ dr_paise === Σ cr_paise** (refuses an unbalanced voucher),
2. allocates the next per-(year, type) voucher number atomically (`nextSeries`),
3. writes the voucher header + all entries + an audit row.

**Nothing else writes money.** The `tag` on each entry (`rent | loan | interest | trade | opening | general`) lets a party's single running balance still report **standing bhada** and **loan remaining** separately. Vouchers are **voided/reversed**, never deleted.

### Posting map (Dr / Cr per document)

| Event | Debit | Credit |
|---|---|---|
| Bhada charged (full year, once stored qty known) | Kisan | Rent/Bhada Income |
| Nikasi sale to vyapari (packets × rate) | Vyapari | Kisan (proceeds) |
| Bhada recovered on a nikasi (agreed slice) | Kisan (nets his rent) | — *(within the same voucher, no separate entry)* |
| Receipt — party pays (cheque posts on clearance) | Cash/Bank | Party |
| Payment — cash to kisan | Kisan | Cash/Bank |
| Loan given (direct) | Party | Cash/Bank |
| Loan interest (capitalisation 1 Jan + on payment) | Party | Interest Income |
| Loan repaid | Cash/Bank | Party |
| Bardana purchase | Bardana Purchase (amount) | Cash/Bank (paid) + Party (credit, `trade`) |
| Bardana issue (sale) | Cash/Bank (paid) + Party (credit, `trade`) | Bardana Sales (amount) |
| Salary / Loading paid | Salary/Loading Expense | Cash/Bank |
| Contra (cash↔bank / bank↔bank) | Bank (in) | Cash/Bank (out) |
| Cheque received/given | Cheques in Clearing → Bank on clearance | Party / … |

*Physical-only, post nothing:* Aamad, Sauda, and a Nikasi where the kisan takes his own potatoes. *Bhada recovery and loan repayment from sale proceeds are not separate entries* — the kisan's proceeds-credit nets against his rent/loan-debit automatically.

---

## 7. The engines (TypeScript, in `src/main/engines`)

- **Cheque-clearing** — the **Cheques in Clearing** suspense account (deliberately *not* in the `Cash and Bank` subgroup) holds a cheque between entry and clearance; on **clear** it moves to the bank (so bank/Money-Book balances show cleared money only), on **bounce** it reverses. Pending-totals report shows uncleared received vs given.
- **Interest** — 1.5%/month (`monthly_rate_bps`, editable per loan), **simple within the first year, compound thereafter, capitalised every 1 Jan**; posts at capitalisation and on payment; replays `loan_event`s to compute the live outstanding for bills/lists. (decimal.js, rounded to paise.)
- **Bhada** — posts the full-year rent once the kisan's stored quantity is known; piecemeal recovery nets automatically; tracks **standing bhada**; `accrueAll` charges every kisan for the year.
- **Close-Year** — password-gated; chains reusable services **capitalise interest → carry-forward balances → create indirect loans → flag defaulters → reset stock maps**. Because each sub-service runs its own transaction, all-or-nothing is achieved via a recorded **rollback plan** (`year_close.rollback_json`) that also powers the user-facing **undo close** (status flips to `rolled_back`). Carries cash/bank balances forward but does **not** loan/flag banks. Produces a `CloseSummary` + exceptions list.

---

## 8. The UI surface

**20 route pages** (`AppLayout.tsx`), behind an auth gate (`App.tsx` → `LoginPage` until a session exists):

Accounts · Account ledger (`/accounts/:id`) · People · Aamad · Maps · Sauda · Nikasi · Loans · Cheques · Bardana · Expenses · Bills & Salaries · Bill (`/bills/:accountId`) · Party · Vouchers · Trial Balance · Money Book · Close · Audit · Store (config).

**IPC namespaces** (`window.api.*`): `auth, accounts, persons, vouchers, ledger, moneybook, store, aamad, sauda, nikasi, maps, bhada, loans, cheques, bardana, expenses, bills, party, audit, close, print`.

Reusable UI: `AccountSearchSelect` (type-ahead party picker, with an optional `showType` flag to disambiguate a person's multi-role accounts), `usePrinter` hook, money/format helpers, the shared antd theme (`theme.ts`), and a live **EN/HI** language toggle. Cross-navigation UI state (e.g. the Bills & Salaries Bill/Salary tab + search, the Accounts filters) lives in small zustand stores so it survives a drill-down and back.

---

## 9. Cross-cutting

- **Auth / session** — login (year · username · password · accountant) sets the working-year context and the accountant stamp held in the main-process session. `ensureBootstrap()` creates a default admin + the current calendar year on first run (no lockout).
- **Audit** — `writeAudit` logs every create/edit/void with **before/after JSON + the session accountant name + time**; surfaced on the Audit page (filters + facets). No hard deletes — void/reverse only.
- **Account numbers** — human-facing codes (`K-26-0001`) assigned from `account_series`; `backfillAccountCodes()` on startup numbers any pre-existing accounts.
- **Printing** — HTML templates (`printing/templates.ts`) rendered to PDF via Electron `printToPDF`: gate pass, bill, voucher, ledger, trial balance.
- **Backups** — *planned, not yet wired:* timestamped copies of the `.db` on open/close + the pre-close snapshot (the close's logical rollback plan exists today; file-level backups don't). Can point at OneDrive/Drive for off-machine safety.
- **AI (later)** — an Anthropic-SDK service in main answering questions by **tool-calling the existing read-only query services** (the Party filters become its tools) → exact answers, never posts. A vector DB is unnecessary; if semantic search is ever wanted, `sqlite-vec` lives in the same file. **Not built.**

---

## 10. Non-functional & ops

- **Integrity:** WAL mode, foreign keys ON, every write transactional, voucher balance enforced, money in integer paise.
- **Performance:** trivial at this scale (thousands of accounts, tens of thousands of rows/year); covered by the `(year, account, date)` indexes.
- **Security:** renderer sandboxed (no Node, no DB); only main touches the database and filesystem; passwords hashed (bcryptjs).
- **Database location:** `app.getPath('userData')/paritosh.db`; migrations ship in `extraResources` (prod) / repo root (dev) and run on startup.
- **Tests:** ~31 Vitest files — unit (engines, services, money, auth) + `phase1–6` integration suites. **Caveat:** `better-sqlite3` is compiled for the Electron ABI, so plain `npm test` under system Node fails with a `NODE_MODULE_VERSION` mismatch; run after `npm run rebuild` (electron-rebuild) against a matching Node, or drive via `ELECTRON_RUN_AS_NODE` (as the seeding scripts do).
- **Dev data:** `scripts/seed-2025-fullyear.ts` seeds a realistic year by driving the real services under Electron's Node ABI; `test-close-2025.ts` / `verify-close-fix.ts` exercise the year-end close.
- **Packaging (Mac → Windows):** develop on the M2 with `npm run dev`; a GitHub Actions **windows-latest** runner builds the native `better-sqlite3` and produces the Windows installer (`npm run package`, electron-builder).

---

## 11. Build history (phases — all complete)

1. **Phase 0** — Electron + React + SQLite scaffold + specs.
2. **Phase 1** — Drizzle schema + auth/year-context + Account Manager + PostingService + live **Trial Balance** + Money Book *(ledger balances first)*.
3. **Phase 2** — store layout + Aamad + Maps + Sauda + Nikasi (auto-posting) + Bhada.
4. **Phase 3** — Loans + interest engine + cheque-clearing.
5. **Phase 4** — Bardana sub-ledger + staff/loading expenses.
6. **Phase 5** — Bills + Party search (read layers).
7. **Phase 6** — Year-end Close + printing/PDF.
8. **Post-phase hardening** — per-session accountant identity + audit trail; Accounts Master (search, account page, identity edit, account numbers); deletes + audit coverage for physical-stock docs + searchable account pickers; People management page + type-ahead person picker; year-end close fix (carry cash/bank, don't loan/flag banks); aamad gate-serial numbering; bardana partial/on-credit settlement; loan composition breakdown; list filters across Nikasi / Cheques / Expenses / Sauda; **Bills & Salaries** (Bill/Salary toggle + salary register); **Material-3 UI theme makeover**.

**Still open:** automated file backups, the optional AI chatbot. (See the memory note *Open Items / Gaps* and the `history/phase*.md` build journals.)
