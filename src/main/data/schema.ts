import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import {
  ACCOUNT_TYPES,
  CHEQUE_DIRECTIONS,
  CHEQUE_STATUSES,
  DELIVERY_TARGETS,
  DR_CR,
  ENTRY_TAGS,
  SUBGROUP_NATURES,
  VOUCHER_TYPES,
  YEAR_STATUSES
} from '../../shared/enums'

/**
 * Phase 1 schema — masters + the double-entry ledger core + system tables.
 *
 * Conventions (architecture.md §5):
 *  - Money is stored as INTEGER **paise** (never float rupees).
 *  - Loan rates are basis points (1.5%/mo = 150 bps) — added in Phase 3.
 *  - Business dates are TEXT 'YYYY-MM-DD' (timezone-free); audit/created stamps
 *    are unix-epoch-seconds integers.
 *  - Nearly every operational table is scoped by financial year.
 *  - No hard deletes: rows are voided/reversed, never DELETEd (audit rule).
 *
 * Enum tuples/types live in `shared/enums.ts` (single source of truth, importable by the
 * renderer); re-exported here so existing `from './schema'` imports keep working.
 */
export {
  ACCOUNT_TYPES,
  CHEQUE_DIRECTIONS,
  CHEQUE_STATUSES,
  DELIVERY_TARGETS,
  DR_CR,
  ENTRY_TAGS,
  SUBGROUP_NATURES,
  VOUCHER_TYPES,
  YEAR_STATUSES
} from '../../shared/enums'
export type {
  AccountType,
  ChequeDirection,
  ChequeStatus,
  DeliveryTarget,
  DrCr,
  EntryTag,
  SubgroupNature,
  VoucherType,
  YearStatus
} from '../../shared/enums'

const createdAt = integer('created_at', { mode: 'timestamp' })
  .notNull()
  .default(sql`(unixepoch())`)

// ============================ MASTERS ============================

/** A real human. One person can own several role-accounts (kisan + vyapari, …). */
export const person = sqliteTable('person', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  sonOf: text('son_of'),
  villageCity: text('village_city'),
  state: text('state'),
  phone: text('phone'),
  createdAt
})

/** The 9 accounting groups every account rolls into (seeded; see seed.ts). */
export const subgroup = sqliteTable('subgroup', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  nature: text('nature', { enum: SUBGROUP_NATURES }).notNull()
})

/** Every party + the cold's own books. `isSystem` = the cold's own heads (cash, capital, rent income…). */
export const account = sqliteTable(
  'account',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    type: text('type', { enum: ACCOUNT_TYPES }).notNull(),
    subgroupId: integer('subgroup_id')
      .notNull()
      .references(() => subgroup.id),
    personId: integer('person_id').references(() => person.id),
    isDefaulter: integer('is_defaulter', { mode: 'boolean' }).notNull().default(false),
    isSystem: integer('is_system', { mode: 'boolean' }).notNull().default(false),
    job: text('job'), // staff role
    createdAt
  },
  (t) => ({
    bySubgroup: index('account_subgroup_idx').on(t.subgroupId),
    byType: index('account_type_idx').on(t.type),
    byPerson: index('account_person_idx').on(t.personId)
  })
)

/** Accounting year (1 Jan – 31 Dec). Holds the flat per-packet rent rate for the year. */
export const financialYear = sqliteTable('financial_year', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  year: integer('year').notNull().unique(),
  status: text('status', { enum: YEAR_STATUSES }).notNull().default('open'),
  rentRatePaise: integer('rent_rate_paise').notNull().default(0)
})

/** Carried-forward opening balance per account per year (bilateral: dr = they owe us, cr = we owe them). */
export const openingBalance = sqliteTable(
  'opening_balance',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: integer('account_id')
      .notNull()
      .references(() => account.id),
    yearId: integer('year_id')
      .notNull()
      .references(() => financialYear.id),
    amountPaise: integer('amount_paise').notNull(),
    drCr: text('dr_cr', { enum: DR_CR }).notNull()
  },
  (t) => ({ uniq: uniqueIndex('opening_balance_acct_year_idx').on(t.accountId, t.yearId) })
)

/** Per-year charges/labourer counts for a loading-contractor account. */
export const loadingContractorYear = sqliteTable(
  'loading_contractor_year',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: integer('account_id')
      .notNull()
      .references(() => account.id),
    yearId: integer('year_id')
      .notNull()
      .references(() => financialYear.id),
    loadingChargePaise: integer('loading_charge_paise').notNull().default(0),
    unloadingChargePaise: integer('unloading_charge_paise').notNull().default(0),
    labourersLoading: integer('labourers_loading').notNull().default(0),
    labourersUnloading: integer('labourers_unloading').notNull().default(0)
  },
  (t) => ({ uniq: uniqueIndex('loading_contractor_year_idx').on(t.accountId, t.yearId) })
)

// ========================= LEDGER CORE =========================

/** A voucher header. Every money action produces exactly one (built by PostingService). */
export const voucher = sqliteTable(
  'voucher',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    yearId: integer('year_id')
      .notNull()
      .references(() => financialYear.id),
    no: integer('no').notNull(), // per-year, per-type serial from number_series
    type: text('type', { enum: VOUCHER_TYPES }).notNull(),
    date: text('date').notNull(), // 'YYYY-MM-DD' business date
    narration: text('narration'),
    accountantUserId: integer('accountant_user_id').references(() => user.id),
    sourceModule: text('source_module'), // 'manual' | 'nikasi' | 'loan' | 'bhada' | …
    sourceId: integer('source_id'),
    isAuto: integer('is_auto', { mode: 'boolean' }).notNull().default(false),
    voidedAt: integer('voided_at', { mode: 'timestamp' }),
    voidedReason: text('voided_reason'),
    createdAt
  },
  (t) => ({
    byYearDate: index('voucher_year_date_idx').on(t.yearId, t.date),
    uniqNo: uniqueIndex('voucher_year_type_no_idx').on(t.yearId, t.type, t.no)
  })
)

/** A single ledger line. Σ dr_paise must equal Σ cr_paise across a voucher (enforced by PostingService). */
export const voucherEntry = sqliteTable(
  'voucher_entry',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    voucherId: integer('voucher_id')
      .notNull()
      .references(() => voucher.id),
    accountId: integer('account_id')
      .notNull()
      .references(() => account.id),
    drPaise: integer('dr_paise').notNull().default(0),
    crPaise: integer('cr_paise').notNull().default(0),
    tag: text('tag', { enum: ENTRY_TAGS }).notNull().default('general')
  },
  (t) => ({
    byVoucher: index('entry_voucher_idx').on(t.voucherId),
    byAccount: index('entry_account_idx').on(t.accountId)
  })
)

/** Cash & cheque only. A cheque hits its bank book only on its clearance date (Phase 3 engine). */
export const cheque = sqliteTable(
  'cheque',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    voucherId: integer('voucher_id').references(() => voucher.id),
    no: text('no').notNull(),
    bank: text('bank'),
    direction: text('direction', { enum: CHEQUE_DIRECTIONS }).notNull(),
    amountPaise: integer('amount_paise').notNull(),
    date: text('date'), // date written on the cheque
    issueDate: text('issue_date'),
    clearanceDate: text('clearance_date'),
    status: text('status', { enum: CHEQUE_STATUSES }).notNull().default('pending'),
    bankAccountId: integer('bank_account_id').references(() => account.id),
    partyAccountId: integer('party_account_id').references(() => account.id)
  },
  (t) => ({ byStatus: index('cheque_status_idx').on(t.status) })
)

// ============================ SYSTEM ============================

/** Login user. Password argon2/bcrypt-hashed; accountant name stamped on vouchers. */
export const user = sqliteTable('user', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  accountantName: text('accountant_name').notNull(),
  role: text('role').notNull().default('accountant'),
  createdAt
})

/** Per-(year, doc-type) running serial — for system-issued numbers (voucher no., …). */
export const numberSeries = sqliteTable(
  'number_series',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    yearId: integer('year_id')
      .notNull()
      .references(() => financialYear.id),
    docType: text('doc_type').notNull(),
    currentNo: integer('current_no').notNull().default(0)
  },
  (t) => ({ uniq: uniqueIndex('number_series_idx').on(t.yearId, t.docType) })
)

/** Every create/edit/void, with who + when + before/after JSON. No hard deletes. */
export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ts: integer('ts', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    userId: integer('user_id').references(() => user.id),
    action: text('action').notNull(), // 'create' | 'update' | 'void'
    entity: text('entity').notNull(),
    entityId: integer('entity_id'),
    beforeJson: text('before_json'),
    afterJson: text('after_json')
  },
  (t) => ({ byEntity: index('audit_entity_idx').on(t.entity, t.entityId) })
)

// ===================== STORE & STOCK (Phase 2) =====================

/**
 * Single-row store layout config: Room → Floor → Rack (cap 8×10×200; current 5×6×160).
 * Locations on aamad/nikasi are denormalised (room/floor/rack ints) rather than FK rows —
 * the layout is just the grid dimensions the Maps render and validate against.
 */
export const storeConfig = sqliteTable('store_config', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  rooms: integer('rooms').notNull().default(5),
  floors: integer('floors').notNull().default(6),
  racksPerFloor: integer('racks_per_floor').notNull().default(160)
})

/** Inward stock (filling season). `no` is staff-typed (not auto-serialised). Physical only — posts nothing. */
export const aamad = sqliteTable(
  'aamad',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    yearId: integer('year_id')
      .notNull()
      .references(() => financialYear.id),
    no: text('no').notNull(),
    date: text('date').notNull(),
    kisanAccountId: integer('kisan_account_id')
      .notNull()
      .references(() => account.id),
    totalPackets: integer('total_packets').notNull(),
    createdAt
  },
  (t) => ({
    byYearDate: index('aamad_year_date_idx').on(t.yearId, t.date),
    byKisan: index('aamad_kisan_idx').on(t.kisanAccountId)
  })
)

/** Where an aamad's packets physically sit: Room/Floor/Rack → packets. */
export const aamadLocation = sqliteTable(
  'aamad_location',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    aamadId: integer('aamad_id')
      .notNull()
      .references(() => aamad.id),
    room: integer('room').notNull(),
    floor: integer('floor').notNull(),
    rack: integer('rack').notNull(),
    packets: integer('packets').notNull()
  },
  (t) => ({ byAamad: index('aamad_location_aamad_idx').on(t.aamadId) })
)

/** Deal record: a vyapari agrees a per-packet rate with a kisan. Drives the Nikasi rate. Physical only. */
export const sauda = sqliteTable(
  'sauda',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    yearId: integer('year_id')
      .notNull()
      .references(() => financialYear.id),
    date: text('date').notNull(),
    vyapariAccountId: integer('vyapari_account_id')
      .notNull()
      .references(() => account.id),
    kisanAccountId: integer('kisan_account_id')
      .notNull()
      .references(() => account.id),
    packets: integer('packets').notNull(),
    ratePaise: integer('rate_paise').notNull(),
    createdAt
  },
  (t) => ({ byYear: index('sauda_year_idx').on(t.yearId, t.date) })
)

/** Outward gate pass. Vyapari delivery auto-posts a sale; kisan self-withdrawal is physical only. */
export const nikasi = sqliteTable(
  'nikasi',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    yearId: integer('year_id')
      .notNull()
      .references(() => financialYear.id),
    billNo: integer('bill_no').notNull(), // gate-pass no., auto from number_series
    date: text('date').notNull(),
    vehicleNo: text('vehicle_no'),
    deliveredToType: text('delivered_to_type', { enum: DELIVERY_TARGETS }).notNull(),
    deliveredToAccountId: integer('delivered_to_account_id')
      .notNull()
      .references(() => account.id),
    receivedBy: text('received_by'),
    bhadaRecoveredPaise: integer('bhada_recovered_paise').notNull().default(0),
    voucherId: integer('voucher_id').references(() => voucher.id), // the sale voucher (null for self-withdrawal)
    createdAt
  },
  (t) => ({
    byYearDate: index('nikasi_year_date_idx').on(t.yearId, t.date),
    uniqBill: uniqueIndex('nikasi_year_bill_idx').on(t.yearId, t.billNo)
  })
)

/** A nikasi line: packets taken from one kisan's stock at a location, at a per-packet sale rate. */
export const nikasiLine = sqliteTable(
  'nikasi_line',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    nikasiId: integer('nikasi_id')
      .notNull()
      .references(() => nikasi.id),
    fromKisanAccountId: integer('from_kisan_account_id')
      .notNull()
      .references(() => account.id),
    room: integer('room').notNull(),
    floor: integer('floor').notNull(),
    rack: integer('rack').notNull(),
    packets: integer('packets').notNull(),
    weightKg: integer('weight_kg'), // recorded only; not used in money
    ratePaise: integer('rate_paise').notNull()
  },
  (t) => ({ byNikasi: index('nikasi_line_nikasi_idx').on(t.nikasiId) })
)
