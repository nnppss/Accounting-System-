import type {
  AccountType,
  BardanaDirection,
  ChequeDirection,
  ChequeStatus,
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
}

export interface AccountListFilter {
  type?: AccountType
  search?: string
  includeSystem?: boolean
}

export interface AccountListRow {
  id: number
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
  no: string
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
  /** The buyer/supplier ledger account (the "Name"); optional — recorded for the A/C lists. */
  partyAccountId?: number
  ratePaise: number
  qty: number // pieces
  mode: PaymentMode
  bankAccountId?: number // required when mode = 'bank'
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

/** Per-year charges/labourer counts for a loading-contractor account (the `loading_contractor_year` row). */
export interface LoadingContractorYearInput {
  accountId: number
  loadingChargePaise: number
  unloadingChargePaise: number
  labourersLoading: number
  labourersUnloading: number
}

export interface LoadingContractorYearRow extends LoadingContractorYearInput {
  accountName: string
}
