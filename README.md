# Paritosh Cold

Personal, offline, single-user accounting software for Paritosh Cold Storage.
Local-first desktop app: **Electron + React + TypeScript + SQLite (better-sqlite3 + Drizzle)**.

See [docs/software.md](docs/software.md) for what it does, [docs/architecture.md](docs/architecture.md) for how it's built, and [docs/BUILD.md](docs/BUILD.md) for the full build & run recipe. New here? Start with [CONTRIBUTING.md](CONTRIBUTING.md).

## Repository layout

```
src/
  main/                 Electron main process (Node side)
    data/               SQLite + Drizzle: schema, db client, seed
    services/           domain logic (aamad, nikasi, sauda, accounts, …)
    engines/            calculation engines (interest, bhada, cheque-clearing, close-year)
    ipc/                typed IPC handlers exposed to the renderer
    printing/           print job + receipt/voucher templates
    auth/ audit/        login/session and the audit-log writer
    integration/        cross-module integration tests
  preload/              context-bridge API surface (the only main↔renderer bridge)
  renderer/src/         React UI
    pages/              one screen per route
    components/         shared UI building blocks
    lib/                hooks & helpers (hotkeys, formatting, printer, key-nav)
    store/              Zustand stores (session, filters, views)
    locales/            en/hi i18n strings
  shared/               code used by both sides: contracts, enums, money helpers

drizzle/                generated SQL migrations (do not hand-edit)
docs/                   architecture, build and phase-history notes
scripts/                one-off dev / seed / verification scripts
resources/              app icon and packaged build resources
```

Path aliases: `@shared/*` (everywhere) and `@renderer/*` (UI only). Tests are
colocated as `*.test.ts`; broader integration tests live in `src/main/integration/`.

## Develop (macOS)

```bash
npm install
npm run rebuild   # build better-sqlite3 for Electron's ABI — run before `npm run dev`
npm run dev       # launches the app
```

## Tests (money engines)

```bash
npm test          # Vitest, runs in plain Node
```

> Note on the native module: `better-sqlite3` is compiled for one ABI at a time.
> `npm install` builds it for **Node** (used by Vitest). Run `npm run rebuild` to
> switch it to **Electron** before `npm run dev`; run `npm rebuild better-sqlite3`
> to switch back to Node for tests. (CI builds each target on a clean checkout, so
> this only matters for local switching.)

## Build a Windows installer

Push to `main` (or run the **Build Windows** workflow) — GitHub Actions produces the
installer under `release/` as an artifact. Local packaging: `npm run package`.

## Status

All planned modules ship — Account Manager + People, Aamad, Maps, Sauda, Nikasi,
Bhada, Loans, Cheques, Bardana, Expenses, the Vouchers/Ledger accounting core,
Money Book, Trial Balance, Bills & Salaries, Party search, Audit Trail and the
password-gated Year-end Close — behind a bilingual (en/hi) Electron shell with the
Material-3 theme. The only unbuilt items are automated file backups and the optional
AI assistant. See [docs/architecture.md](docs/architecture.md) §11 for the build
history and [docs/history/](docs/history/) for the phase-by-phase journals.
