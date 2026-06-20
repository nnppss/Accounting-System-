# Phase 2 — Stock operations (done)

Handoff doc. Read [phase1.md](phase1.md) for the ledger-core baseline this builds on, then this
for the stock layer. See [software.md](software.md) for *what*, [architecture.md](architecture.md)
for *how*, [README.md](README.md) for dev commands.

---

## 1. Status

| Chunk | Status |
|---|---|
| Store layout config (Room → Floor → Rack; cap 8×10×200, current 5×6×160) | ✅ done |
| Aamad (stock-in: header + location lines; search w/ count + total) | ✅ done |
| Maps (Aamad / Nikasi / Current Stock grids; cell → rack drill) | ✅ done |
| Sauda (deal record; drives the Nikasi rate) | ✅ done |
| Nikasi (gate pass; vyapari sale **auto-posts**, kisan self-withdrawal physical-only) | ✅ done |
| Bhada engine (full-year accrual; recovery nets; standing bhada) | ✅ done |

**Verified:** `npm run typecheck` + `npm run build` clean; **48 tests green**, including the
required Phase 2 engine tests (bhada accrual + recovery netting · nikasi sale posting · Current
Stock = Aamad − Nikasi) and `phase2.integration.test.ts` — the worked settlement example
end-to-end (kisan stores → sauda → rent → nikasi → cash settlement) tying maps, ledger, standing
bhada, and money book.

---

## 2. What exists (new in Phase 2)

```
drizzle/0001_cynical_wither.sql      # migration: 6 new tables (now 18 total)

src/shared/
  enums.ts                           # + DELIVERY_TARGETS (kisan|vyapari)
  contracts.ts                       # + all Phase 2 DTOs (Aamad/Sauda/Nikasi/Map/Bhada/…)

src/main/
  data/schema.ts                     # + store_config, aamad, aamad_location, sauda, nikasi, nikasi_line
  data/seed.ts                       # + seeds the single store_config row (5×6×160)
  services/store.ts                  # store layout get/set + assertLocationInBounds
  services/aamad.ts                  # createAamad / listAamad (count+total) / getAamad
  services/maps.ts                   # getMap (3 types) / getRackStock / currentStockAtRack
  services/sauda.ts                  # createSauda / listSauda / latestRate
  services/nikasi.ts                 # createNikasi (atomic gate pass + sale) / listNikasi / getNikasi
  services/posting.ts                # REFACTORED: postCore(tx,…) + nextSeries(tx,…) exported
  engines/bhada.ts                   # accrueRent / accrueAllRent / getStandingBhada / getStoredPackets
  ipc/stock.ts                       # IPC for store/aamad/sauda/nikasi/maps/bhada
  *.test.ts                          # aamad, nikasi, maps, bhada + phase2.integration

src/preload/index.ts                 # + store / aamad / sauda / nikasi / maps / bhada namespaces
src/renderer/src/pages/              # AamadPage, MapsPage, SaudaPage, NikasiPage, StorePage
src/renderer/src/components/AppLayout.tsx  # nav + routes for the new pages
src/renderer/src/locales/{en,hi}.json      # Phase 2 strings (EN + HI)
```

---

## 3. Key design decisions

- **Locations are denormalised ints** (room/floor/rack) on `aamad_location` / `nikasi_line`, not
  FK rows. `store_config` (single row) holds only the grid dimensions, which the Maps render and
  `assertLocationInBounds` validates against. Cap enforced at 8 × 10 × 200.
- **Nikasi posting is atomic.** `createNikasi` opens one transaction and calls `postCore(tx, …)`
  so the gate pass, its lines, and the sale voucher commit together (or not at all). A vyapari
  buying from many kisans → one voucher: **Dr Vyapari (total) / Cr each Kisan (their proceeds)**,
  tag `trade`. Kisan **self-withdrawal** (`deliveredToType: 'kisan'`) posts nothing.
- **Stock integrity:** `createNikasi` refuses to withdraw more than `currentStockAtRack` (Aamad −
  Nikasi) for that kisan at that exact rack, summed across the gate pass's own lines.
- **Bhada = ledger + tag, no separate table.** `accrueRent` posts full-year rent (stored packets ×
  `financial_year.rent_rate_paise`) **Dr Kisan / Cr Rent Income** tagged `rent`, `sourceModule
  'bhada'`. Idempotent: re-running voids the prior accrual and re-posts at the current quantity.
  **Recovery is not a separate entry** — the kisan's sale-proceeds credit nets against the rent
  debit in his running balance (architecture.md §6). `getStandingBhada` = the rent-tagged net.
- **`postCore` / `nextSeries`** were extracted from `posting.ts` so any service can post or draw a
  serial inside its own transaction. `post()` is now just `db().transaction(tx => postCore(tx,…))`.

---

## 4. Gotchas (in addition to phase1.md §4)

- **ABI dance still applies (phase1.md §4.1).** `npm test` needs the Node ABI
  (`npm rebuild better-sqlite3`); `npm run dev` needs the Electron ABI (`npm run rebuild`).
  The repo is currently left on the **Electron ABI** (ready for `npm run dev`).
- **Schema change → migration.** New tables/columns: edit `schema.ts`, run `npm run db:generate`,
  commit both. `db.test.ts` asserts the table count (now **18**) — update it if you add tables.
- **`bhada_recovered_paise` on a nikasi is informational** (shown on the gate pass); it does NOT
  post a separate entry. Recovery happens through the kisan's netted balance.
- **Weight (`weight_kg`) is recorded only** — never used in money. Sale = packets × rate.

---

## 5. Phase 3 preview (Money depth — loans & cheques)

Next per the plan: **Loans (Udhaar)** + **interest engine** (1.5%/mo, simple year 1 then
compound, capitalise every 1 Jan, part-payments) + **cheque-clearing engine** (a "Cheques in
Clearing" account; bank effect on clearance date; bounce reversal). The `cheque` table already
exists from Phase 1; `loan` / `loan_event` tables are still to be added (architecture.md §5).
Engine tests to reproduce: ₹1,00,000 → ₹1,18,000 → ₹1,39,240; mid-year; part-payment; and a
cheque pending → cleared/bounced.

---

## 6. Git log baseline

```
e40b4d0 Phase 1: add handoff doc for remaining Phase 1 work and Phase 2 preview
d3e2d44 Phase 1: ledger schema, migrations, and Electron-free data layer
0452ec9 Phase 0: Electron + React + SQLite scaffold and project specs
```
(Phase 1 completion + Phase 2 are uncommitted in the working tree — commit when ready.)
