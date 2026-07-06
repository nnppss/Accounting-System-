# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] — 2026-07-06

### Added
- Loans by cheque, with a Cash-and-Bank money guard.
- Closed-year read-only enforcement, cascading undo-close, and oldest-first
  re-close.
- Bardana pre-booking, remarks, and party-ledger completeness.
- Aamad editing with optional/partial locations and kisan stock lookup.
- Type-ahead field suggestions and auto title-case for person fields.
- `S/o` shown in accounts list and account pickers to disambiguate
  same-named parties.

### Fixed
- Credit-only bardana failing NOT NULL on mode.
- Missing `DATE_FORMAT` import in LoansPage.

### Changed
- Repository structure hardening: grouped the phase integration tests under
  `src/main/integration/`, added a `@shared` path alias for the main and preload
  processes (mirroring the renderer), and added project governance and
  repo-hygiene files (`LICENSE`, `CONTRIBUTING.md`, `.gitattributes`, `.nvmrc`,
  `.editorconfig`, `.vscode/`).

## [0.0.1] — 2025

Initial internal build. All planned modules ship:

- **Accounting core** — Vouchers (Receipt/Payment/Journal/Contra), double-entry
  Ledger, Trial Balance, Money Book.
- **Parties & people** — Account Manager with multi-role accounts, People view.
- **Stock flow** — Aamad (intake), Maps (room/floor/rack), Sauda (deals),
  Nikasi (stock-out gate passes), Bardana (bags), Bhada (rent).
- **Finance** — Loans (direct/indirect with interest), Cheques lifecycle,
  Expenses, Bills & Salaries, Party search.
- **Operations** — Audit Trail, password-gated Year-end Close.
- Bilingual (English/Hindi) Electron shell with a Material-3 theme; SQLite
  storage via better-sqlite3 + Drizzle; Windows installer via GitHub Actions.

Not yet built: automated file backups and the optional AI assistant.

[Unreleased]: https://example.com/compare/v1.1.0...HEAD
[1.1.0]: https://example.com/releases/tag/v1.1.0
[0.0.1]: https://example.com/releases/tag/v0.0.1
