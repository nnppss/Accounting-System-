import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

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
 */

// ---- Enumerations (kept as const tuples so they drive both the DB CHECK and TS types) ----

/** Who/what an account is. "Defaulter" is a flag on the account, not a type. */
export const ACCOUNT_TYPES = ['kisan', 'vyapari', 'staff', 'loading_contractor', 'other'] as const
export type AccountType = (typeof ACCOUNT_TYPES)[number]

/** Accounting nature of a subgroup — drives reporting/classification. */
export const SUBGROUP_NATURES = ['asset', 'liability', 'income', 'expense', 'capital'] as const
export type SubgroupNature = (typeof SUBGROUP_NATURES)[number]

export const DR_CR = ['dr', 'cr'] as const
export type DrCr = (typeof DR_CR)[number]

export const VOUCHER_TYPES = ['receipt', 'payment', 'journal', 'contra'] as const
export type VoucherType = (typeof VOUCHER_TYPES)[number]

/** Lets a single running party balance still report rent vs loan vs trade separately. */
export const ENTRY_TAGS = ['rent', 'loan', 'interest', 'trade', 'opening', 'general'] as const
export type EntryTag = (typeof ENTRY_TAGS)[number]

export const CHEQUE_DIRECTIONS = ['received', 'given'] as const
export type ChequeDirection = (typeof CHEQUE_DIRECTIONS)[number]

export const CHEQUE_STATUSES = ['pending', 'cleared', 'bounced'] as const
export type ChequeStatus = (typeof CHEQUE_STATUSES)[number]

export const YEAR_STATUSES = ['open', 'closed'] as const
export type YearStatus = (typeof YEAR_STATUSES)[number]

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
