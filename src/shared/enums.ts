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
