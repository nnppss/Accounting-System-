# Paritosh Cold — Build & Run

How to build and run Paritosh Cold from a clean checkout. This is the reproducibility
recipe; see [architecture.md](architecture.md) §10 for the deeper ops detail.

## Prerequisites

- **Node.js 20 LTS** (Electron 32 bundles Node 20; matching it keeps the native
  `better-sqlite3` ABI consistent between the app and the test runner).
- **npm** (the committed `package-lock.json` pins every dependency version).
- Git.

## Install

```sh
npm ci          # exact, reproducible install from package-lock.json
```

`npm ci` also runs electron-builder's `npmRebuild`, compiling `better-sqlite3` against the
Electron ABI.

## Run in development

```sh
npm run dev     # electron-vite dev — hot-reloading Electron + React
```

On **first run** the app seeds a default login and the current calendar year, so there's
no lockout — sign in with **`admin` / `admin123`** and change it. The SQLite database is
created at the app's userData directory (`paritosh-cold`):

- macOS: `~/Library/Application Support/paritosh-cold/paritosh.db`
- Windows: `%APPDATA%\paritosh-cold\paritosh.db`

Schema migrations in `drizzle/` run automatically on startup.

## Typecheck

```sh
npm run typecheck    # tsc over the node + web TS projects
```

## Tests

```sh
npm test             # vitest (unit + phase1–6 integration suites)
```

> **Native-module caveat.** `better-sqlite3` is compiled for the Electron ABI by the
> install step, so plain `npm test` under system Node can fail with a
> `NODE_MODULE_VERSION` mismatch. If it does, rebuild for your Node first:
> ```sh
> npm rebuild better-sqlite3      # for system Node (tests/scripts)
> npm run rebuild                 # electron-rebuild — switch back before running the app
> ```
> The seed/inspect scripts avoid this by driving the services under Electron's Node ABI
> (`ELECTRON_RUN_AS_NODE`).

## Database migrations

```sh
npm run db:generate  # drizzle-kit — regenerate SQL after editing schema.ts
```

Generated migrations live in `drizzle/` (`0000` → latest) and ship to production via
electron-builder `extraResources`.

## Package the Windows installer

Development is on macOS (Apple Silicon), but `better-sqlite3` is native and must be built
on the target OS. The Windows installer is therefore produced on a **Windows runner**:

```sh
npm run package      # electron-vite build + electron-builder → release/
```

In CI this runs on a GitHub Actions **windows-latest** runner, which compiles the native
module and emits the NSIS installer (`Paritosh Cold-<version>-setup.exe`). Running
`npm run package` on macOS produces a macOS build, not a Windows one.

## Seed realistic dev data (optional)

```sh
scripts/seed-2025-fullyear.ts   # drives the real services to seed a full year
```

See [architecture.md](architecture.md) §10 and the memory note *Test Data Seeding* for how
the seed scripts run under the Electron Node ABI.
