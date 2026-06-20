# Phase 0 — Scaffold (DONE)

Handoff doc. Read this, then start **Phase 1 (Foundation)**. It records exactly what
exists, the conventions already baked in, the gotchas that will bite you, and where to
make the first Phase 1 change.

See [software.md](software.md) for *what* the app does, [architecture.md](architecture.md)
for *how* it's built (§10 is the build order), and [README.md](README.md) for the dev
commands.

---

## 1. Status

Phase 0 is complete and verified on macOS (Apple Silicon, dev machine):

| Check | Command | Result |
|---|---|---|
| Types | `npm run typecheck` | ✅ clean (node + web tsconfigs) |
| Tests | `npm test` | ✅ 4/4 (money math) |
| Bundle | `npm run build` | ✅ main + preload + renderer |
| Run | `npm run dev` | ✅ Electron launches, no errors |
| DB round-trip | (in-app "Test database round-trip" button) | ✅ writes/reads `app_meta` in `paritosh.db` |

The goal of Phase 0 was only to **prove the stack works end to end** — Electron ⇄ React ⇄
typed IPC ⇄ SQLite — not to model any business logic. That is proven. There is **no real
schema and no business logic yet**; that's Phase 1.

---

## 2. What exists (file map)

```
src/
  main/                      # Node — the "brain" (DB, filesystem, all logic live here)
    index.ts                 # app bootstrap: BrowserWindow + initDb() + registerIpc()
    data/
      db.ts                  # opens the single SQLite file (WAL + FK on); getDb/rawSqlite
      schema.ts              # ⚠ PLACEHOLDER: only `app_meta`. Real schema goes here.
    ipc/
      index.ts               # ⚠ PLACEHOLDER: only the `ping` handler. Real handlers here.
  preload/
    index.ts                 # contextBridge → window.api (currently only `ping`)
    index.d.ts               # global Window.api typing
  renderer/
    index.html
    src/
      main.tsx               # React root: QueryClientProvider + antd ConfigProvider
      App.tsx                # ⚠ PLACEHOLDER demo UI (ping button + lang toggle)
      i18n.ts                # i18next init (en default, hi fallback chain)
      locales/{en,hi}.json   # translation strings
  shared/
    money.ts                 # integer-paise helpers (KEEP — real code, used everywhere)
    money.test.ts            # vitest specs for money.ts

electron.vite.config.ts      # 3 build targets; aliases @shared, @renderer
drizzle.config.ts            # drizzle-kit: schema → ./drizzle migrations
electron-builder.yml         # Windows NSIS installer config
.github/workflows/build-windows.yml   # CI: npm ci → test → package → upload .exe
tsconfig.{json,node.json,web.json}    # project refs: node.json = main/preload/shared, web.json = renderer
vitest.config.ts             # node env, runs src/**/*.test.ts
```

**Placeholders to delete/replace in Phase 1** (marked ⚠ above):
- `src/main/data/schema.ts` — replace `app_meta` with the real tables (see §6).
- `src/main/ipc/index.ts` — remove `ping`, add real module handlers.
- `src/preload/index.ts` — remove `ping`, expose the real typed API.
- `src/renderer/src/App.tsx` — replace the demo card with real routing/pages.
- `phase0.*` keys in `locales/*.json` — demo strings, remove when App.tsx is replaced.
- `db.ts` `initDb()` — drop the `CREATE TABLE app_meta` line once migrations exist.

---

## 3. How to run

```bash
npm install          # if node_modules is missing/broken
npm run rebuild      # compile better-sqlite3 for ELECTRON's ABI — REQUIRED before `npm run dev`
npm run dev          # launches the app
npm run typecheck    # tsc, both project refs
npm test             # vitest (plain Node)
npm run build        # bundle all three processes (no installer)
npm run package      # build + electron-builder (Windows installer; real output on CI)
npm run db:generate  # drizzle-kit: generate a migration from schema.ts (Phase 1+)
```

---

## 4. Gotchas (read before Phase 1)

### 4.1 The `better-sqlite3` ABI dance — this WILL bite you
`better-sqlite3` is a **native module compiled for one ABI at a time**:
- `npm install` / `npm rebuild better-sqlite3` → builds for **Node** (what Vitest uses).
- `npm run rebuild` (`electron-rebuild`) → builds for **Electron** (what `npm run dev` uses).

Symptom of the wrong ABI:
`NODE_MODULE_VERSION 128 ... requires NODE_MODULE_VERSION 137` (or vice-versa).
- `128` = Electron 32's bundled Node. `137` = Node 24.

**Right now the module is built for Electron** (so `npm run dev` works). `npm test` still
passes *only because the current tests touch pure money math, not SQLite.* The moment you
write a Phase 1 test that opens a DB, you must `npm rebuild better-sqlite3` to switch to the
Node ABI for Vitest, then `npm run rebuild` to switch back before running the app. CI avoids
this entirely (clean checkout per target).

**Recommendation for Phase 1 testing:** prefer testing services/engines against an
**in-memory or temp-file SQLite** opened directly, and keep that test suite runnable under
the Node ABI. Don't import Electron (`app`, `BrowserWindow`) from anything you want to unit
test — see §4.2.

### 4.2 Don't couple domain/services to Electron
`db.ts` currently calls `app.getPath('userData')` to locate the DB file — that pulls in
Electron and can't run under Vitest. In Phase 1, **factor the DB-open logic to take a path
argument** (e.g. `openDb(path)`), and let the Electron layer pass `app.getPath(...)` while
tests pass `:memory:` or a tmp file. Keep `services/`, `engines/`, `domain/` free of any
`electron` import so they're unit-testable in plain Node.

### 4.3 Node version
Local dev is on Node 24; CI pins Node 20. Both build fine. The integer-paise money code
assumes JS numbers stay exact — safe because paise stay well under `Number.MAX_SAFE_INTEGER`
for this business. Keep money as **integer paise** everywhere (never float rupees); use
`decimal.js` for interest math then round back to paise (see `shared/money.ts`).

### 4.4 Security model (don't regress it)
`contextIsolation: true`, `nodeIntegration: false`. The renderer has **no DB and no Node
access** — its only door is `window.api` from the preload bridge. Every new feature adds:
(1) an `ipcMain.handle` in `main/ipc`, (2) a matching method in `preload/index.ts`, (3) the
type flows automatically via `Api`. Never expose `ipcRenderer` or raw DB to the renderer.

---

## 5. Conventions already established

- **Money** = integer **paise** in storage and arithmetic. Helpers in `shared/money.ts`
  (`rupeesToPaise`, `paiseToRupees`, `formatINR`, `sum`). `formatINR` does Indian grouping
  (lakh/crore). Loan rates will be **basis points** (1.5%/mo = 150 bps) per architecture.
- **IPC naming**: `module.action` channels (e.g. future `account.create`, `nikasi.create`).
  One typed `api` object in preload; `export type Api = typeof api` drives renderer types.
- **i18n**: every user-facing string goes through `t('...')`; add the key to BOTH
  `en.json` and `hi.json`. English is the default language.
- **UI kit**: Ant Design (tables/forms/date-pickers). State: TanStack Query for the IPC
  cache, Zustand for light UI state (Zustand is a dep but not yet used).
- **No hard deletes** (architecture rule) — Phase 1+ writes go through an audit wrapper and
  use void/reverse, not DELETE. Not built yet; design services with this in mind.
- **Year scoping**: nearly every operational table is scoped by financial year; the login
  flow (year · username · password · accountant) sets the working-year context.

---

## 6. Phase 1 — Foundation (where to start)

Goal (architecture.md §10, step 1): **prove the ledger balances first.** Build:

1. **Real Drizzle schema + migrations** in `src/main/data/schema.ts` — start with the
   masters and the ledger core (see architecture.md §5):
   - Masters: `person`, `account`, `subgroup`, `financial_year`, `opening_balance`.
   - Ledger core: `voucher`, `voucher_entry` (with `dr_paise`, `cr_paise`, `tag`).
   - System: `user`, `audit_log`, `number_series`.
   Then `npm run db:generate` to emit migrations into `./drizzle`, and have `initDb()` run
   them on startup (replace the `app_meta` CREATE TABLE).
2. **Auth + year-context** — login (year · username · password · accountant); password
   hashed (argon2/bcrypt — not yet a dep, add it). Session holds working year + accountant
   name for stamping entries.
3. **Account Manager** — create/list accounts by type (Kisan/Vyapari/Staff/Loading
   Contractor/Other/Defaulter*), assign subgroup, person-link, opening balances, view ledger.
4. **PostingService** — the single `post(voucher)` that builds entries per the posting map
   (architecture.md §6), asserts **Σdr = Σcr**, and writes voucher+entries in one transaction.
   Nothing else writes money.
5. **Trial Balance** (read model) — live query proving Σdebits = Σcredits.
6. **Money Book** (read model) — cash + per-bank, month-wise opening/receipts/payments/balance.

**Suggested first commit for the session:** factor `db.ts` to `openDb(path)` (§4.2), add the
real schema + first migration, and wire `initDb()` to migrate — that unblocks everything else.

Subsequent phases (for context): Phase 2 = Stock (layout, Aamad, Maps, Sauda, Nikasi, Bhada);
Phase 3 = Loans + interest + cheque-clearing; Phase 4 = Bardana + expenses; Phase 5 = Bills +
Party search; Phase 6 = Year-end Close + printing + audit/backup hardening, then optional AI.

---

## 7. Git

No commits exist yet (`main` is empty). When ready:
```bash
git add -A
git commit -m "Phase 0: verified Electron + React + SQLite scaffold"
```
`.gitignore` already excludes `node_modules`, `out`, `release`, `*.db*`, `.DS_Store`.
