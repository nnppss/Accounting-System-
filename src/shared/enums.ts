/**
 * Enumerations shared across the whole app (DB CHECK constraints, service logic, and the
 * renderer). Kept here in `shared/` — the one place both the main (node) and renderer (web)
 * TypeScript projects include — so there is a single source of truth and the preload/renderer
 * never have to import backend files. `schema.ts` re-exports these for the Drizzle column enums.
 */

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

/** Who a Nikasi (gate pass) delivers to: a vyapari purchase (posts a sale) or the kisan himself (physical only). */
export const DELIVERY_TARGETS = ['kisan', 'vyapari'] as const
export type DeliveryTarget = (typeof DELIVERY_TARGETS)[number]

// ============================ LOANS (Phase 3) ============================

/** The three kinds of party the cold lends to (software.md §3.8). */
export const LOAN_CATEGORIES = ['kisan', 'vyapari', 'other'] as const
export type LoanCategory = (typeof LOAN_CATEGORIES)[number]

/**
 * How a loan arose, which decides when interest starts:
 *  - 'direct'   — the party asked directly; interest accrues from the sanction date.
 *  - 'indirect' — arose from unpaid dues; interest-free in the year incurred, then from 1 Jan next.
 */
export const LOAN_NATURES = ['direct', 'indirect'] as const
export type LoanNature = (typeof LOAN_NATURES)[number]

/** A loan is disbursed/repaid by cash or by a bank account (cash & cheque only — no other rails). */
export const LOAN_MODES = ['cash', 'bank'] as const
export type LoanMode = (typeof LOAN_MODES)[number]

/** The lifecycle events recorded against a loan; replayed by the interest engine. */
export const LOAN_EVENT_TYPES = ['disbursement', 'payment', 'capitalisation'] as const
export type LoanEventType = (typeof LOAN_EVENT_TYPES)[number]

// ============================ BARDANA & EXPENSES (Phase 4) ============================

/**
 * A bardana transaction's direction (software.md §3.7):
 *  - 'purchase' — the cold buys bags (Dr Bardana Purchase / Cr Cash-Bank);
 *  - 'issue'    — the cold sells bags (Dr Cash-Bank / Cr Bardana Sales).
 */
export const BARDANA_DIRECTIONS = ['purchase', 'issue'] as const
export type BardanaDirection = (typeof BARDANA_DIRECTIONS)[number]

/** How money settles on a side-ledger transaction (cash & cheque/bank only — no other rails). */
export const PAYMENT_MODES = ['cash', 'bank'] as const
export type PaymentMode = (typeof PAYMENT_MODES)[number]
