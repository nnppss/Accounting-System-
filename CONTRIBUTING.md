# Contributing

Internal development guide for Paritosh Cold. This is a single-developer,
proprietary project; the conventions below keep the codebase consistent.

## Prerequisites

- **Node 20** (see [`.nvmrc`](.nvmrc) — run `nvm use`).
- macOS for development; Windows installers are produced by CI.

## Setup

```bash
npm install
npm run rebuild   # compile better-sqlite3 for Electron's ABI before `npm run dev`
npm run dev       # launch the app
```

`better-sqlite3` is a native module compiled for one ABI at a time. `npm install`
builds it for **Node** (used by Vitest); `npm run rebuild` switches it to
**Electron** for the app. Run `npm rebuild better-sqlite3` to switch back before
running tests.

## Everyday commands

| Command               | What it does                                          |
| --------------------- | ----------------------------------------------------- |
| `npm run dev`         | Run the app with hot reload (electron-vite).          |
| `npm test`            | Run the Vitest suite in plain Node.                   |
| `npm run test:watch`  | Vitest in watch mode.                                 |
| `npm run typecheck`   | Type-check both the node and web tsconfig projects.   |
| `npm run build`       | Production build into `out/`.                         |
| `npm run package`     | Build + produce an installer into `release/`.         |
| `npm run db:generate` | Generate a Drizzle migration from `schema.ts`.        |

Always run `npm run typecheck` and `npm test` before committing.

## Repository layout

See [README.md](README.md#repository-layout) for the annotated tree. In short:

- `src/main/` — Electron main process (data, services, engines, ipc, printing).
- `src/preload/` — context-bridge API exposed to the renderer.
- `src/renderer/src/` — React UI (pages, components, lib, store, locales).
- `src/shared/` — code shared by both sides (contracts, enums, money helpers).
- `drizzle/` — SQL migrations (generated; do not hand-edit).
- `docs/` — architecture, build and phase-history notes.
- `scripts/` — one-off dev/seed/verification scripts.

## Conventions

- **TypeScript strict mode** everywhere; no `any` escapes without a reason.
- **Money is integer paise** — never store or compute money as floats. Use the
  helpers in `src/shared/money.ts`.
- **Imports of shared code** use the `@shared/*` alias (`@renderer/*` in the UI).
- **Tests** are colocated as `*.test.ts` next to the unit they cover. Broader,
  cross-module integration tests live in `src/main/integration/`.
- **Database changes** go through Drizzle: edit `src/main/data/schema.ts`, then
  `npm run db:generate`. Never edit a committed migration.
- **Audit trail** — every write that changes accounting data must be credited via
  `writeAudit` with the session accountant name.

## Commit messages

Conventional Commits, e.g. `feat(nikasi): ...`, `fix(ledger): ...`,
`docs: ...`, `test: ...`, `refactor: ...`. Keep the subject under ~72 chars.
