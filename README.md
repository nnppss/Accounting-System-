# Paritosh Cold

Personal, offline, single-user accounting software for Paritosh Cold Storage.
Local-first desktop app: **Electron + React + TypeScript + SQLite (better-sqlite3 + Drizzle)**.

See [software.md](software.md) for what it does and [architecture.md](architecture.md) for how it's built.

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

## Phase status

Phase 0 (scaffold) — **done**: Electron + React + Ant Design + i18n (en/hi) shell,
secure typed IPC, SQLite (better-sqlite3 + Drizzle) wired with a live DB round-trip,
integer-paise money utilities with tests, and the Windows CI/installer pipeline.
`npm run typecheck`, `npm test`, and `npm run build` all pass.

Next: Phase 1 (Foundation) — real Drizzle schema + migrations, auth/year-context,
Account Manager, PostingService, live Trial Balance, Money Book. See
[architecture.md](architecture.md) §10 for the full build order.
