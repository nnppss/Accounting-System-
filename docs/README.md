# Paritosh Cold — Documentation

This folder is the **design package** for Paritosh Cold: the *what*, the *how*, and the
build history — enough to understand the software and rebuild it from source.

Read in this order:

1. **[software.md](software.md)** — *what* the app does. The functional specification:
   the business it models, every module, and how they work together. Start here.
2. **[architecture.md](architecture.md)** — *how* it's built. Tech stack, process model,
   data model, the double-entry core, engines, and ops.
3. **[BUILD.md](BUILD.md)** — *how to build and run it* from a clean checkout, on the Mac
   dev machine and the Windows target.

## What's the source of truth?

`software.md` and `architecture.md` describe the software **as built** and are kept current
as features land — but the **real** source of truth for rebuilding is the repository itself:
the code, `package.json` + lockfile (exact dependency versions), and the Drizzle migrations
in `drizzle/` (the schema's full history). The prose explains *intent*; the repo *is* the
software.

## history/

[`history/`](history/) holds the phase-by-phase **build journals** (`phase0.md … phase6.md`).
These are a point-in-time **diary** of how the software was built, written as handover notes
between build sessions. They are **historical records, not current documentation** — they
contain forward-looking "do this next" instructions that no longer apply. Read them for
context on *why* a decision was made; do not trust them as a description of the app today
(use `software.md` / `architecture.md` for that).
