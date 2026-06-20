# Paritosh Cold — Architecture & Tech Stack

Technical design for the Paritosh Cold accounting software. See [software.md](software.md) for what the software does; this document is **how it's built**.

---

## 1. The decision: a local-first desktop app

The software is **personal, single-user, offline, on one Windows laptop** (developed on a MacBook Air M2). That rules out a client-server web app — running a backend server + a database server just to serve one person is pure overhead. Instead:

> **A local-first desktop app, built with web technology, with the entire database in a single file.**

This gives a modern UI and easy AI integration (it's JavaScript/TypeScript), with desktop simplicity: one app, one database file, offline, trivial backups (copy the file), full data ownership. Developed on the Mac, shipped to Windows. If it ever became multi-user, the same core lifts onto a server — but that isn't built now.

---

## 2. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Desktop shell | **Electron** + **electron-vite** (dev) + **Electron Forge** (package) | cross-platform; build on Mac, ship to Windows |
| UI | **React 18 + TypeScript + Vite** | modern, fast |
| Component kit | **Ant Design** (or Mantine) | strong tables / forms / date-pickers for a data-dense accounting UI |
| Data fetching / state | **TanStack Query** + **Zustand** | cache the IPC API + light UI state |
| Database | **SQLite** via **better-sqlite3** | embedded, synchronous, fast; one file; ACID; WAL mode; FKs on |
| Schema / queries | **Drizzle ORM** | typed schema + migrations; compile-time safety; raw SQL when needed |
| Money | **integer paise** in DB; **decimal.js** for interest, then round to paise | never raw floating point |
| Printing | HTML templates → Electron **printToPDF** (or `@react-pdf/renderer`) | gate pass, bills, vouchers, ledgers |
| Auth | users table + **argon2 / bcrypt** hash | local login |
| AI (later) | **Anthropic TypeScript SDK** in the main process | tool-calling over the query services |
| Build / release | dev on **Mac**; Windows installer via **GitHub Actions** (windows runner) | better-sqlite3 is a native module → build on Windows |

---

## 3. Process model = the architecture

Electron splits into two OS processes, and that split *is* the layering:

- **Renderer (Chromium)** — the **React UI**. No database access (`contextIsolation` on, `nodeIntegration` off). Security-critical.
- **Preload** — a `contextBridge` exposing one **typed API** (`window.api.nikasi.create(...)`). The renderer's only door to the backend.
- **Main process (Node)** — the **brain**: IPC handlers → application services → engines → domain → SQLite. All logic, the database, the filesystem, and the AI key live here.

Renderer ↔ Main talk over **IPC** (`ipcRenderer.invoke` / `ipcMain.handle`) — request/response. Because everything goes through these typed handlers, **if the app ever went multi-user the IPC handlers lift to HTTP endpoints with minimal change.**

```
Renderer (React UI)        ← Presentation
      │  typed IPC
Preload (contextBridge)    ← the API contract
      │  secure boundary
Main process (Node):
   IPC handlers            ← the API surface
   Application services    ← business rules
   Engines                 ← interest · bhada · cheque-clearing · close-year
   Domain                  ← the double-entry ledger core
   Data (Drizzle + SQLite) ← persistence
      │
   one .db file            ← the books
```

---

## 4. Folder structure

```
paritosh/
  src/
    main/                 # Node — the brain
      index.ts            # app + window bootstrap
      ipc/                # handlers per module = the API surface
      services/           # posting, settlement, query/report
      engines/            # interest, bhada, cheque-clearing, close-year
      domain/             # entities + invariants
      data/               # drizzle schema, migrations, repositories
      audit/  backup/  auth/
    preload/index.ts      # contextBridge typed API
    renderer/             # React app: pages / components / hooks
  resources/              # pdf templates, icons
  drizzle/                # migration files
  electron.vite.config.ts · forge.config.ts · package.json
```

---

## 5. Data model (SQLite — money as INTEGER paise)

**Masters**
- `person` (name, son_of, village_city, state, phone)
- `account` (person_id?, type, subgroup_id, name, is_defaulter, job?)
- `subgroup` (name, nature) — the 9 groups
- `financial_year` (year, status, rent_rate_paise)
- `opening_balance` (account, year, amount_paise, dr_cr)
- `loading_contractor_year` (loading/unloading charge_paise, labourer counts)

**Ledger core**
- `voucher` (year, no, type, date, narration, accountant_user_id, source_module, source_id, is_auto)
- `voucher_entry` (voucher, account, **dr_paise**, **cr_paise**, **tag**) — *the ledger line*
- `cheque` (no, bank, date, issue_date, clearance_date, direction, status)

**Operations**
- `aamad` (year, aamad_no, date, kisan_account_id, total_packets) + `aamad_location` (room, floor, rack, packets)
- `sauda` (year, date, vyapari, kisan, packets, rate_paise)
- `nikasi` (year, bill_no, date, vehicle_no, delivered_to_type, delivered_to_account, received_by, bhada_recovered_paise) + `nikasi_line` (from_kisan, room, floor, rack, packets, weight, rate_paise)
- `bhada` (year, kisan, quantity, rate_paise, amount_paise, remark)
- `loan` (year, category, account, date, principal_paise, mobile, mode, nature, monthly_rate_bps, remark) + `loan_event` (date, type, amount_paise)
- `bardana_txn` (year, type, date, account, rate_paise, quantity, amount_paise, mode, bank?)

**System**
- `user` (username, password_hash, accountant_name, role)
- `audit_log` (ts, user, action, entity, entity_id, before_json, after_json)
- `number_series` (year, doc_type, current_no)
- `saved_filter` (user, module, criteria_json)

**Read models — stored nowhere, all queries:** ledger, trial balance, the three maps, money book, bills, party search.

**Conventions:** money as **integer paise**; loan rate as **basis points** (1.5% = 150 bps); year scoping on every operational table; index on `(year_id, account_id, date)`.

---

## 6. The double-entry core

Every money action calls one **`PostingService.post(voucher)`**, which:
1. builds the entries per the **posting map** (below),
2. asserts **Σ dr = Σ cr** (refuses otherwise),
3. writes the voucher + entries in **one SQLite transaction**.

Nothing else writes money. The `tag` on each entry (rent / loan / interest / trade) lets a party's single running balance still report **standing bhada** and **loan remaining** separately.

### Posting map (Dr / Cr per document)

| Event | Debit | Credit |
|---|---|---|
| Bhada charged (full year, once stored qty known) | Kisan | Rent Income |
| Nikasi sale to vyapari (packets × rate) | Vyapari | Kisan (proceeds) |
| Receipt — party pays (cheque posts on clearance) | Cash/Bank | Party |
| Payment — cash to kisan | Kisan | Cash/Bank |
| Loan given | Party | Cash/Bank |
| Loan interest (1 Jan + on payment) | Party | Interest Income |
| Loan repaid by cash | Cash/Bank | Party |
| Bardana sold / bought | Buyer / Bardana Purchase | Bardana Sales / Supplier·Cash |
| Salary / Loading | Expense | Cash/Bank |
| Contra (cash↔bank) | Bank (in) | Cash/Bank (out) |
| Rent discount (rare) | Rent Income | Kisan |

*Physical-only, post nothing:* Aamad, Sauda, and a Nikasi where the kisan takes his own potatoes. *Bhada recovery and loan repayment from sale proceeds aren't separate entries* — the kisan's proceeds-credit nets against his rent/loan-debit automatically.

---

## 7. The engines (TypeScript, in main)
- **Cheque-clearing** — a "Cheques in Clearing" account holds a cheque until its clearance date; only then does it move to the bank, so bank balances show cleared money only.
- **Interest** — 1.5%/month, simple within a year, **capitalised every 1 Jan**; posts at capitalisation and on payment; computes the live figure on the fly for bills. (decimal.js for the math, rounded back to paise.)
- **Bhada** — posts the full-year rent once the kisan's stored quantity is known; recovery nets automatically; tracks standing bhada.
- **Close-Year** — password-gated; runs in one transaction after a pre-close snapshot; carry-forward → indirect loans → capitalise interest → flag defaulters → reset stock; produces summary + exceptions; reversible.

---

## 8. Cross-cutting
- **Auth / session** — login (year · username · password · accountant) sets the working-year context and the accountant stamp.
- **Audit** — one write-wrapper in the data layer logs every create/edit/void with before/after + user + time. **No hard deletes** — void/reverse only.
- **Backups** — timestamped copies of the `.db` on open/close + the pre-close snapshot; can point at a OneDrive / Google-Drive folder for off-machine safety.
- **Printing** — HTML templates rendered to PDF via Electron.
- **AI (later)** — an Anthropic-SDK service in main answers questions by **tool-calling the existing read-only query services** (the Party filters become its tools) → exact answers, never posts. A vector DB is unnecessary; if semantic search is ever wanted, `sqlite-vec` lives in the same file.

---

## 9. Non-functional
- **Integrity:** WAL mode, foreign keys ON, every write transactional, voucher balance enforced, money in integer paise.
- **Performance:** trivial at this scale (thousands of accounts, tens of thousands of rows/year); covered by the `(year, account, date)` indexes.
- **Security:** renderer sandboxed (no Node, no DB); only main touches the database, the filesystem, and the AI key; passwords hashed.
- **Packaging (Mac → Windows):** develop and run on the M2 with `npm run dev`; a GitHub Actions **windows-latest** runner builds the native `better-sqlite3` module and produces the Windows installer.

---

## 10. Build order

1. **Foundation** — Drizzle schema + auth/year-context + Account Manager + PostingService + live **Trial Balance** + Money Book *(prove the ledger balances first)*.
2. **Stock** — store layout + Aamad + Maps + Sauda + Nikasi (auto-posting) + Bhada.
3. **Money depth** — Loans + interest engine + cheque-clearing.
4. **Bardana + expenses** (staff, loading).
5. **Views** — Bills + Party search.
6. **Close-Year + printing + audit/backup hardening**, then the optional AI chatbot.
