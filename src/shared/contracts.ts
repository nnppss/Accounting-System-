import type {
  AccountType,
  BardanaDirection,
  ChequeDirection,
  ChequeStatus,
  CloseStatus,
  DeliveryTarget,
  DrCr,
  EntryTag,
  LoanCategory,
  LoanEventType,
  LoanMode,
  LoanNature,
  PaymentMode,
  SubgroupNature,
  VoucherType,
  YearStatus
} from './enums'

/**
 * The IPC contract — every DTO that crosses between the renderer and the main process
 * (architecture.md §3: "the API contract"). Defined once here in `shared/` so the preload and
 * renderer never import backend files; the services import and re-export these so there is a
 * single source of truth on both sides of the boundary.
 */

// ---- auth ----
export interface Session {
  userId: number
  username: string
  accountantName: string
  role: string
  yearId: number
  year: number
  /** True while the user is still on the seeded default password — drives the change-password nudge. */
  mustChangePassword?: boolean
}

export interface YearInfo {
  id: number
  year: number
  status: YearStatus
  rentRatePaise: number
}

// ---- persons & accounts ----
export interface PersonInput {
  name: string
  sonOf?: string
  villageCity?: string
  state?: string
  phone?: string
}

export interface PersonRow {
  id: number
  name: string
  sonOf: string | null
  villageCity: string | null
  state: string | null
  phone: string | null
  createdAt: Date
}

export interface SubgroupRow {
  id: number
  name: string
  nature: SubgroupNature
}

export interface AccountInput {
  name: string
  type: AccountType
  subgroupId: number
  personId?: number
  job?: string
  /** Bank details — only meaningful for type 'bank'. */
  bankAccountNumber?: string
  bankIfsc?: string
  bankBranch?: string
  /** Optional opening balance recorded at creation (setup time). */
  opening?: { amountPaise: number; drCr: DrCr; date: string }
}

/** Editable identity fields (live on the linked person, the single source of truth). */
export interface AccountIdentityInput {
  sonOf?: string
  villageCity?: string
  state?: string
  phone?: string
}

/** Full account view (header + identity) for the opened-account page. */
export interface AccountDetail {
  id: number
  code: string | null
  name: string
  type: AccountType
  subgroupName: string
  personId: number | null
  personName: string | null
  sonOf: string | null
  villageCity: string | null
  state: string | null
  phone: string | null
  bankAccountNumber: string | null
  bankIfsc: string | null
  bankBranch: string | null
  isDefaulter: boolean
  isSystem: boolean
  balancePaise: number
  /** Whether an opening balance is already set for the working year. */
  hasOpening: boolean
}

export interface AccountListFilter {
  type?: AccountType
  /** Matches the account's own name or the linked person's name. */
  name?: string
  villageCity?: string
  state?: string
  phone?: string
  /** Narrow the list to accounts flagged as defaulters. */
  defaultersOnly?: boolean
  /** Additive: include the cold's own system heads alongside party accounts. */
  includeSystem?: boolean
  /** Return ONLY the cold's own system heads — used by the Accounts page "Show system accounts"
   *  toggle when no party filter is active, so it lists the ~10 heads, not every account. */
  systemOnly?: boolean
}

export interface AccountListRow {
  id: number
  code: string | null
  name: string
  type: AccountType
  subgroupName: string
  personName: string | null
  isDefaulter: boolean
  isSystem: boolean
  balancePaise: number
}

// ---- ledger / trial balance ----
export interface LedgerLine {
  voucherId: number
  voucherNo: number
  type: VoucherType
  date: string
  narration: string | null
  tag: EntryTag
  drPaise: number
  crPaise: number
  balancePaise: number
}

export interface TrialBalanceRow {
  accountId: number
  accountName: string
  subgroupName: string
  nature: SubgroupNature
  drPaise: number
  crPaise: number
}

export interface TrialBalance {
  rows: TrialBalanceRow[]
  totalDr: number
  totalCr: number
  balanced: boolean
}

// ---- posting / vouchers ----
export interface PostResult {
  voucherId: number
  voucherNo: number
}

export interface SimpleVoucherInput {
  yearId: number
  date: string
  partyAccountId: number
  cashBankAccountId: number
  amountPaise: number
  narration?: string
  tag?: EntryTag
  accountantUserId?: number
}

export interface ContraInput {
  yearId: number
  date: string
  fromAccountId: number
  toAccountId: number
  amountPaise: number
  narration?: string
  accountantUserId?: number
}

export interface JournalLineInput {
  accountId: number
  drPaise: number
  crPaise: number
  tag?: EntryTag
}

export interface JournalInput {
  yearId: number
  date: string
  narration?: string
  entries: JournalLineInput[]
  accountantUserId?: number
}

/** Args the renderer sends — yearId + accountant are injected from the session in main. */
export type ReceiptArg = Omit<SimpleVoucherInput, 'yearId' | 'accountantUserId'>
export type ContraArg = Omit<ContraInput, 'yearId' | 'accountantUserId'>
export type JournalArg = Omit<JournalInput, 'yearId' | 'accountantUserId'>

export interface VoucherListRow {
  id: number
  no: number
  type: VoucherType
  date: string
  narration: string | null
  isAuto: boolean
  totalPaise: number
}

export interface VoucherEntryView {
  accountId: number
  accountName: string
  drPaise: number
  crPaise: number
  tag: EntryTag
}

export interface VoucherDetail {
  id: number
  no: number
  type: VoucherType
  date: string
  narration: string | null
  entries: VoucherEntryView[]
}

// ---- money book ----
export interface CashBankAccount {
  id: number
  name: string
}

export interface MoneyBookMonth {
  month: number
  openingPaise: number
  receiptsPaise: number
  paymentsPaise: number
  closingPaise: number
}

export interface MoneyBookSummary {
  months: MoneyBookMonth[]
  openingPaise: number
  closingPaise: number
}

export interface MoneyBookDetailRow {
  voucherId: number
  voucherNo: number
  type: VoucherType
  date: string
  narration: string | null
  counterparty: string
  receiptPaise: number
  paymentPaise: number
}

// ============================ STORE & STOCK (Phase 2) ============================

export interface StoreConfig {
  rooms: number
  floors: number
  racksPerFloor: number
}

// ---- Aamad (stock-in) ----
export interface AamadLocationInput {
  room: number
  floor: number
  rack: number
  packets: number
}

export interface AamadInput {
  /** Serial allotted at the gate. The service prefixes the working year → `no` = `YYYY-serial`. */
  serial: number
  date: string
  kisanAccountId: number
  totalPackets: number
  locations: AamadLocationInput[]
}

export interface AamadListRow {
  id: number
  no: string
  date: string
  kisanAccountId: number
  kisanName: string
  totalPackets: number
}

export interface AamadSearchFilter {
  kisanAccountId?: number
  fromDate?: string
  toDate?: string
}

/** Search result with the count + total-packets summary the screen shows. */
export interface AamadListResult {
  rows: AamadListRow[]
  count: number
  totalPackets: number
}

export interface AamadDetail extends AamadListRow {
  locations: Array<AamadLocationInput & { id: number }>
}

// ---- Sauda (deal) ----
export interface SaudaInput {
  date: string
  vyapariAccountId: number
  kisanAccountId: number
  packets: number
  ratePaise: number
}

export interface SaudaListRow {
  id: number
  date: string
  vyapariAccountId: number
  vyapariName: string
  kisanAccountId: number
  kisanName: string
  packets: number
  ratePaise: number
}

// ---- Nikasi (stock-out / gate pass) ----
export interface NikasiLineInput {
  fromKisanAccountId: number
  room: number
  floor: number
  rack: number
  packets: number
  weightKg?: number
  ratePaise: number
}

export interface NikasiInput {
  date: string
  vehicleNo?: string
  deliveredToType: DeliveryTarget
  deliveredToAccountId: number
  receivedBy?: string
  bhadaRecoveredPaise?: number
  lines: NikasiLineInput[]
}

export interface NikasiListRow {
  id: number
  billNo: number
  date: string
  deliveredToType: DeliveryTarget
  deliveredToAccountId: number
  deliveredToName: string
  totalPackets: number
  totalAmountPaise: number
  isPosted: boolean
}

export interface NikasiLineView extends NikasiLineInput {
  id: number
  fromKisanName: string
  amountPaise: number
}

export interface NikasiDetail {
  id: number
  billNo: number
  date: string
  vehicleNo: string | null
  deliveredToType: DeliveryTarget
  deliveredToAccountId: number
  deliveredToName: string
  receivedBy: string | null
  bhadaRecoveredPaise: number
  voucherNo: number | null
  lines: NikasiLineView[]
}

// ---- Maps ----
export type MapType = 'aamad' | 'nikasi' | 'current'

export interface MapCell {
  room: number
  floor: number
  packets: number
}

export interface StockMap {
  type: MapType
  rooms: number
  floors: number
  cells: MapCell[]
  totalPackets: number
}

/** Rack-level drill of one cell: packets per rack, broken down by kisan. */
export interface RackKisanStock {
  rack: number
  kisanAccountId: number
  kisanName: string
  packets: number
}

// ---- Bhada (rent) ----
export interface StandingBhada {
  kisanAccountId: number
  kisanName: string
  storedPackets: number
  ratePaise: number
  accruedRentPaise: number
  standingPaise: number
}

// ---- Phase 2 operation results ----
export interface CreateNikasiResult {
  nikasiId: number
  billNo: number
  voucherId: number | null
}

export interface AccrueResult {
  voucherId: number
  packets: number
  amountPaise: number
}

export interface AccrueAllResult {
  kisans: number
  totalPaise: number
}

// ============================ LOANS (Phase 3) ============================

/** Args the renderer sends to create a loan — yearId + accountant come from the session. */
export interface LoanInput {
  category: LoanCategory
  accountId: number
  date: string
  amountPaise: number
  mobile?: string
  mode: LoanMode
  bankAccountId?: number // required when mode = 'bank'
  nature: LoanNature
  /** Monthly rate in basis points (default 150 = 1.5%/mo); editable per loan. */
  monthlyRateBps?: number
  /** Override the interest-start date; otherwise derived from nature (direct = date, indirect = 1 Jan next). */
  interestStartDate?: string
  remark?: string
}

export interface LoanRow {
  id: number
  category: LoanCategory
  accountId: number
  accountName: string
  date: string
  principalPaise: number
  mobile: string | null
  mode: LoanMode
  bankAccountId: number | null
  nature: LoanNature
  monthlyRateBps: number
  interestStartDate: string
  remark: string | null
  /** Live outstanding (principal + accrued interest − repayments) as of the as-of date. */
  outstandingPaise: number
}

export interface LoanEventRow {
  id: number
  loanId: number
  date: string
  type: LoanEventType
  amountPaise: number
  voucherId: number | null
}

/** Live breakdown from the interest engine — pure computation, posts nothing. */
export interface LoanOutstanding {
  loanId: number
  /** Capitalised base after the last fold (capitalisation/payment) at or before `asOf`. */
  principalPaise: number
  /** Interest accrued on the base since that last fold, up to `asOf`. */
  accruedInterestPaise: number
  /** principalPaise + accruedInterestPaise. */
  outstandingPaise: number
  asOf: string
}

export interface LoanDetail extends LoanRow {
  events: LoanEventRow[]
  breakdown: LoanOutstanding
}

/** One tagged slice of what a carried-forward indirect loan's principal is made of. */
export interface LoanComponentLine {
  tag: EntryTag
  paise: number
}

/**
 * What constitutes a carried-forward indirect loan — the prior (closed) year's dues for the party,
 * broken down by ledger tag (loan / interest / rent / trade / opening / general). The slices sum to
 * the loan's principal. Null for manual indirect loans (no year-end origin to reconstruct).
 */
export interface LoanComposition {
  loanId: number
  /** The closed year whose dues rolled into this indirect loan. */
  sourceYear: number
  lines: LoanComponentLine[]
  totalPaise: number
}

/** Party-level standing loan from the ledger (loan + interest tagged net) — mirrors StandingBhada. */
export interface StandingLoan {
  accountId: number
  accountName: string
  standingPaise: number
}

export interface CreateLoanResult {
  loanId: number
  voucherId: number | null
}

export interface LoanPaymentResult {
  voucherId: number
  interestPaise: number
  principalPaise: number
}

export interface CapitaliseResult {
  loanId: number
  voucherId: number
  interestPaise: number
}

export interface CapitaliseAllResult {
  loans: number
  totalInterestPaise: number
}

// ============================ CHEQUES (Phase 3) ============================

export interface ChequeInput {
  direction: ChequeDirection
  partyAccountId: number
  bankAccountId: number
  amountPaise: number
  no: string
  bank?: string
  date?: string
  issueDate?: string
  clearanceDate?: string
}

export interface ChequeRow {
  id: number
  direction: ChequeDirection
  status: ChequeStatus
  partyAccountId: number
  partyName: string
  bankAccountId: number
  bankName: string
  amountPaise: number
  no: string
  bank: string | null
  date: string | null
  issueDate: string | null
  clearanceDate: string | null
}

export interface RecordChequeResult {
  chequeId: number
  voucherId: number
}

// ============================ BARDANA (Phase 4) ============================

/** Args the renderer sends to record a bardana buy/sell — yearId + accountant come from the session. */
export interface BardanaInput {
  direction: BardanaDirection
  date: string
  /**
   * The buyer/supplier ledger account (the "Name"). Optional only when the deal is settled in full
   * upfront; REQUIRED when any amount is left unpaid, since the balance is carried on this ledger.
   */
  partyAccountId?: number
  ratePaise: number
  qty: number // pieces
  /**
   * How much was settled in cash/bank at the time of the deal. Omit to mean "paid in full"
   * (= ratePaise × qty). 0 means fully on credit; anything in between is a partial payment.
   */
  paidPaise?: number
  mode: PaymentMode
  bankAccountId?: number // required when mode = 'bank' and paidPaise > 0
}

export interface BardanaRow {
  id: number
  direction: BardanaDirection
  date: string
  partyAccountId: number | null
  partyName: string | null
  ratePaise: number
  qty: number
  amountPaise: number
  /** Settled in cash/bank; `amountPaise − paidPaise` is the outstanding amount on the party ledger. */
  paidPaise: number
  mode: PaymentMode
  bankAccountId: number | null
  bankName: string | null
}

/** The Bardana A/C: two lists (purchases / issues) + totals + stock count + profit. */
export interface BardanaAccount {
  purchases: BardanaRow[]
  issues: BardanaRow[]
  totalPurchasesPaise: number
  totalSalesPaise: number
  /** Pieces still on hand = Σ purchased − Σ issued. */
  stockCount: number
  /** profit = total sales − total purchases (paise). */
  profitPaise: number
}

export interface CreateBardanaResult {
  bardanaId: number
  voucherId: number
}

// ============================ EXPENSES (Phase 4) ============================

/** Args the renderer sends to pay a staff salary or a loading contractor — yearId + accountant from session. */
export interface ExpensePaymentInput {
  /** The staff / loading-contractor account being paid (recorded for the register). */
  partyAccountId: number
  amountPaise: number
  date: string
  mode: PaymentMode
  bankAccountId?: number // required when mode = 'bank'
  narration?: string
}

/** One row of the salary / loading register: a payment voucher attributed to a party. */
export interface ExpenseRow {
  voucherId: number
  voucherNo: number
  date: string
  partyAccountId: number | null
  partyName: string | null
  amountPaise: number
  narration: string | null
}

export interface PayExpenseResult {
  voucherId: number
}

/**
 * The lump-sum yearly amounts a loading contractor quotes (the `loading_contractor_year` row).
 * Loading and unloading are recorded separately — often settled at different points of the year,
 * sometimes with different contractors. `null` = not decided yet (distinct from an agreed ₹0).
 * Labourer counts and per-labour rates are the contractor's business, not ours.
 */
export interface LoadingContractorYearInput {
  accountId: number
  loadingAmountPaise: number | null
  unloadingAmountPaise: number | null
}

export interface LoadingContractorYearRow extends LoadingContractorYearInput {
  accountName: string
}

// ============================ BILLS (Phase 5) ============================

/**
 * One loan, summarised for a bill: the live engine figures (software.md §3.11 — "computes live
 * figures like loan interest, but posts nothing"). `liveOutstandingPaise` is the standalone
 * principal+interest as of the bill date; `unpostedInterestPaise` is the interest accrued on the
 * posted base that has NOT yet been capitalised (what the section net adds on top of the ledger).
 */
export interface BillLoanLine {
  loanId: number
  date: string
  category: LoanCategory
  nature: LoanNature
  /** Capitalised base the engine has posted to date. */
  basePaise: number
  /** outstandingAsOf(loanId, asOf) — full live principal + interest. */
  liveOutstandingPaise: number
  /** Interest accrued on the posted base, not yet in the ledger. */
  unpostedInterestPaise: number
}

/**
 * A bill section for one role-account a person holds (kisan / vyapari / staff / contractor / other).
 * `netPaise` = posted ledger balance + un-posted live loan interest (Dr positive = party owes us).
 * Bardana / salary / loading rows are informational (cash-settled, not in the ledger balance).
 */
export interface BillSection {
  accountId: number
  accountName: string
  role: AccountType
  subgroupName: string
  ledgerLines: LedgerLine[]
  /** Posted running balance (Dr positive). */
  postedBalancePaise: number
  /** Rent still carried on the kisan's books (subset of the balance; informational). */
  standingBhadaPaise: number
  loans: BillLoanLine[]
  /** Σ loans unpostedInterestPaise — the live interest the bill adds beyond the ledger. */
  unpostedInterestPaise: number
  /** Bardana dealings attributed to this account (cash-settled; does not affect net). */
  bardanaRows: BardanaRow[]
  /** Salary/loading payments attributed to this account (posted to the expense head, not here). */
  expenseRows: ExpenseRow[]
  /** postedBalancePaise + unpostedInterestPaise. */
  netPaise: number
}

/** A full person-wise bill: a section per role + a single combined net (software.md §3.11). */
export interface Bill {
  /** 'person:<id>' when role-accounts are grouped under a person, else 'account:<id>'. */
  subjectKey: string
  personId: number | null
  name: string
  sonOf: string | null
  villageCity: string | null
  phone: string | null
  sections: BillSection[]
  /** Σ sections netPaise (Dr positive = the party owes the cold). */
  combinedNetPaise: number
  asOf: string
}

/** One row of the Bills index: a person (grouping their role-accounts) or a standalone account. */
export interface BillSubject {
  subjectKey: string
  personId: number | null
  /** An account id to open the bill / ledger from this row. */
  primaryAccountId: number
  name: string
  sonOf: string | null
  villageCity: string | null
  phone: string | null
  /** Distinct roles this subject holds (multi-role when length > 1). */
  roles: AccountType[]
  /** Combined net across the subject's accounts (Dr positive = owes the cold). */
  netPaise: number
  /** Salary paid to this subject's staff account(s) this year (0 for non-staff). */
  salaryPaidPaise: number
}

// ============================ PARTY SEARCH (Phase 5) ============================

/** A numeric comparison for a Party filter (software.md §3.12: = / ≤ / ≥ / between). */
export type NumericOp = 'eq' | 'lte' | 'gte' | 'between'

export interface NumericFilter {
  op: NumericOp
  /** Money filters are in paise; count filters are integers. */
  value: number
  /** Upper bound for 'between' (inclusive). */
  value2?: number
}

/**
 * The stackable Party filters (software.md §3.12) — every present field is ANDed. Money filters
 * are paise; counts are integers. `owes` is a sign filter over the signed balance (Dr positive).
 */
export interface PartyCriteria {
  // identity
  type?: AccountType
  subgroupId?: number
  village?: string // substring (case-insensitive)
  phone?: string // substring
  defaulter?: boolean
  multiRole?: boolean // the person holds more than one role-account
  // stock
  packetsBrought?: NumericFilter
  aamadCount?: NumericFilter
  currentStock?: NumericFilter
  // sales
  packetsSold?: NumericFilter
  // balance (signed Dr positive = owes us; negative = we owe them)
  balance?: NumericFilter
  owes?: 'us' | 'them'
  // rent
  standingBhada?: NumericFilter
  // loans
  loanOutstanding?: NumericFilter
  loanCategory?: LoanCategory
  hasLoan?: boolean
  // bardana
  bardanaQty?: NumericFilter // net pieces dealt (purchased − issued) attributed to the party
  // activity
  hasActivity?: boolean // any (non-void) ledger entry this year
}

/** One party in the Party results — identity + every computed metric the filters can target. */
export interface PartyRow {
  accountId: number
  personId: number | null
  name: string
  sonOf: string | null
  villageCity: string | null
  phone: string | null
  type: AccountType
  subgroupName: string
  isDefaulter: boolean
  /** Signed Dr positive (owes us) / negative (we owe). */
  balancePaise: number
  packetsBrought: number
  aamadCount: number
  currentStock: number
  packetsSold: number
  standingBhadaPaise: number
  loanOutstandingPaise: number
  bardanaQty: number
}

export interface PartyResult {
  rows: PartyRow[]
  count: number
  totalBalancePaise: number
  totalLoanOutstandingPaise: number
}

// ---- saved presets (the `saved_filter` table) ----
export interface SavedFilterRow {
  id: number
  module: string
  name: string
  criteria: PartyCriteria
}

// ============================ YEAR-END CLOSE (Phase 6) ============================

/**
 * The closing report's headline numbers (software.md §3.13). `totalDuesPaise` is the sum of every
 * party's owing (Dr) closing balance carried forward; `indirectLoanTotalPaise` is the same dues
 * reclassified into interest-bearing indirect loans for the new year; `interestCapitalisedPaise`
 * is what the 1-Jan fold posted into the closing year. `leftoverPackets` is the current stock that
 * the new (empty) year's maps drop — recorded for the record (the spec's "leftover packets disposed").
 */
export interface CloseSummary {
  yearId: number
  year: number
  nextYear: number
  /** Non-system accounts whose non-zero closing balance was carried to next year's opening. */
  accountsCarried: number
  /** Σ owing (Dr) closing balances carried forward. */
  totalDuesPaise: number
  /** Σ credit (Cr — the cold owes) closing balances carried forward. */
  totalCreditsPaise: number
  /** Parties newly flagged defaulter by this close (already-flagged ones aren't recounted). */
  newDefaulters: number
  /** Indirect loans created from owing parties for the new year. */
  indirectLoans: number
  indirectLoanTotalPaise: number
  /** Loans whose interest was capitalised at the 1-Jan boundary. */
  loansCapitalised: number
  interestCapitalisedPaise: number
  /** Current-stock packets the new year starts without (leftover, "disposed"). */
  leftoverPackets: number
}

export type CloseExceptionKind = 'pending_cheque' | 'credit_balance' | 'leftover_stock' | 'unbalanced'

/** One thing the accountant should eyeball before/after a close (software.md §3.13 exceptions list). */
export interface CloseException {
  kind: CloseExceptionKind
  accountId?: number
  accountName?: string
  amountPaise?: number
  /** pending_cheque only — cheque number and direction, for the localized detail line. */
  chequeNo?: string
  chequeDirection?: ChequeDirection
  /** leftover_stock only — how many packets remain. */
  packets?: number
}

/** A dry-run of the close — what it WOULD do, computed without posting anything. */
export interface ClosePreview {
  summary: CloseSummary
  exceptions: CloseException[]
  /** True if this year already has an active (not rolled-back) close — must roll back to re-close. */
  alreadyClosed: boolean
}

export interface CloseResult {
  closeId: number
  summary: CloseSummary
  exceptions: CloseException[]
}

/** The active close record for a year (null when the year is still open). */
export interface YearCloseInfo {
  id: number
  yearId: number
  year: number
  nextYearId: number
  nextYear: number
  status: CloseStatus
  closedAt: number
  closedByUserId: number | null
  summary: CloseSummary
}

// ============================ PRINTING / PDF (Phase 6) ============================

/** What a document a print request produced. `path` is null when the user cancelled the save dialog. */
export interface PrintResult {
  path: string | null
}

// ============================ BACKUPS ============================

/** Why a backup copy was taken — part of its file name, shown as a tag on the Backup page. */
export type BackupReason = 'setup' | 'open' | 'quit' | 'pre-close' | 'manual'

/** Backup configuration for the renderer: null `backupDir` means first-run setup hasn't run. */
export interface BackupSettings {
  backupDir: string | null
  /** Suggested folder (Documents/Paritosh Cold Backups) prefilled on the setup screen. */
  defaultDir: string
}

/** One timestamped copy in the backup folder, for the Backup page's table. */
export interface BackupFileRow {
  fileName: string
  reason: BackupReason
  sizeBytes: number
  /** Epoch milliseconds. */
  modifiedAt: number
}

// ============================ AUDIT TRAIL ============================

export type AuditAction = 'create' | 'update' | 'void' | 'delete'

/**
 * One row of the audit trail — who changed what, when (architecture.md §8). `accountantName` is
 * the human credited (entered at sign-in); `username` is the shared login account it ran under.
 */
export interface AuditLogRow {
  id: number
  /** Epoch milliseconds — a real timestamp, includes the time of day. */
  ts: number
  /** The accountant credited for the change; null for actions taken before anyone signed in. */
  accountantName: string | null
  /** The shared login user the session ran under. */
  username: string | null
  action: AuditAction
  /** What kind of record changed: 'voucher' | 'account' | 'loan' | … */
  entity: string
  entityId: number | null
  /** Parsed before/after snapshots (when recorded). */
  before: unknown
  after: unknown
}

/** Stackable audit filters — every present field is ANDed. Rows come back newest-first. */
export interface AuditFilter {
  accountantName?: string
  entity?: string
  action?: AuditAction
  /** Cap on rows returned (newest first); defaults to 500. */
  limit?: number
}

/** Distinct values seen in the log, to populate the filter dropdowns. */
export interface AuditFacets {
  accountants: string[]
  entities: string[]
}
