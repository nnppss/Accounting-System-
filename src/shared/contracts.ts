import type {
  AccountType,
  DeliveryTarget,
  DrCr,
  EntryTag,
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
