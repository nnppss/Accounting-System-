# Paritosh Cold

Personal, offline, single-user accounting software for Paritosh Cold Storage.
Local-first desktop app: **Electron + React + TypeScript + SQLite (better-sqlite3 + Drizzle)**.

See [docs/software.md](docs/software.md) for what it does, [docs/architecture.md](docs/architecture.md) for how it's built, and [docs/BUILD.md](docs/BUILD.md) for the full build & run recipe.

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
