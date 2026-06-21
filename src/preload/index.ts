import { contextBridge, ipcRenderer } from 'electron'
import type { ChequeStatus, DrCr, VoucherType } from '../shared/enums'
import type {
  AamadDetail,
  AamadInput,
  AamadListResult,
  AamadSearchFilter,
  MapType,
  AccountInput,
  AccountListFilter,
  AccountListRow,
  AccrueAllResult,
  AccrueResult,
  CapitaliseAllResult,
  CapitaliseResult,
  CashBankAccount,
  ChequeInput,
  ChequeRow,
  ContraArg,
  CreateLoanResult,
  CreateNikasiResult,
  JournalArg,
  LedgerLine,
  LoanDetail,
  LoanInput,
  LoanPaymentResult,
  LoanRow,
  MoneyBookDetailRow,
  MoneyBookSummary,
  NikasiDetail,
  NikasiInput,
  NikasiListRow,
  PersonInput,
  PersonRow,
  PostResult,
  RackKisanStock,
  RecordChequeResult,
  ReceiptArg,
  SaudaInput,
  SaudaListRow,
  Session,
  StandingBhada,
  StandingLoan,
  StockMap,
  StoreConfig,
  SubgroupRow,
  TrialBalance,
  VoucherDetail,
  VoucherListRow,
  YearInfo
} from '../shared/contracts'

/**
 * The single typed bridge the renderer is allowed to use (architecture.md §3). Each method
 * is a thin `ipcRenderer.invoke` to a registered handler; types are shared with the backend
 * so the renderer is fully typed end-to-end. The working year + accountant live in the main
 * process session, so query/post methods don't take them.
 */
const api = {
  auth: {
    listYears: (): Promise<YearInfo[]> => ipcRenderer.invoke('auth:listYears'),
    createYear: (year: number, rentRatePaise: number): Promise<number> =>
      ipcRenderer.invoke('auth:createYear', year, rentRatePaise),
    login: (year: number, username: string, password: string): Promise<Session> =>
      ipcRenderer.invoke('auth:login', year, username, password),
    logout: (): Promise<void> => ipcRenderer.invoke('auth:logout'),
    session: (): Promise<Session | null> => ipcRenderer.invoke('auth:session')
  },
  accounts: {
    subgroups: (): Promise<SubgroupRow[]> => ipcRenderer.invoke('accounts:subgroups'),
    list: (filter?: AccountListFilter): Promise<AccountListRow[]> =>
      ipcRenderer.invoke('accounts:list', filter),
    create: (input: AccountInput): Promise<number> => ipcRenderer.invoke('accounts:create', input),
    ledger: (accountId: number): Promise<LedgerLine[]> =>
      ipcRenderer.invoke('accounts:ledger', accountId),
    setOpening: (accountId: number, amountPaise: number, drCr: DrCr, date: string): Promise<void> =>
      ipcRenderer.invoke('accounts:setOpening', accountId, amountPaise, drCr, date),
    setDefaulter: (accountId: number, isDefaulter: boolean): Promise<void> =>
      ipcRenderer.invoke('accounts:setDefaulter', accountId, isDefaulter)
  },
  persons: {
    create: (input: PersonInput): Promise<number> => ipcRenderer.invoke('persons:create', input),
    list: (search?: string): Promise<PersonRow[]> => ipcRenderer.invoke('persons:list', search)
  },
  vouchers: {
    receipt: (arg: ReceiptArg): Promise<PostResult> => ipcRenderer.invoke('vouchers:receipt', arg),
    payment: (arg: ReceiptArg): Promise<PostResult> => ipcRenderer.invoke('vouchers:payment', arg),
    contra: (arg: ContraArg): Promise<PostResult> => ipcRenderer.invoke('vouchers:contra', arg),
    journal: (arg: JournalArg): Promise<PostResult> => ipcRenderer.invoke('vouchers:journal', arg),
    list: (type?: VoucherType): Promise<VoucherListRow[]> => ipcRenderer.invoke('vouchers:list', type),
    get: (id: number): Promise<VoucherDetail | null> => ipcRenderer.invoke('vouchers:get', id)
  },
  ledger: {
    trialBalance: (): Promise<TrialBalance> => ipcRenderer.invoke('ledger:trialBalance')
  },
  moneybook: {
    accounts: (): Promise<CashBankAccount[]> => ipcRenderer.invoke('moneybook:accounts'),
    summary: (accountId: number): Promise<MoneyBookSummary> =>
      ipcRenderer.invoke('moneybook:summary', accountId),
    detail: (accountId: number, month: number): Promise<MoneyBookDetailRow[]> =>
      ipcRenderer.invoke('moneybook:detail', accountId, month)
  },
  store: {
    get: (): Promise<StoreConfig> => ipcRenderer.invoke('store:get'),
    set: (cfg: StoreConfig): Promise<void> => ipcRenderer.invoke('store:set', cfg)
  },
  aamad: {
    create: (input: AamadInput): Promise<number> => ipcRenderer.invoke('aamad:create', input),
    list: (filter?: AamadSearchFilter): Promise<AamadListResult> =>
      ipcRenderer.invoke('aamad:list', filter),
    get: (id: number): Promise<AamadDetail | null> => ipcRenderer.invoke('aamad:get', id)
  },
  sauda: {
    create: (input: SaudaInput): Promise<number> => ipcRenderer.invoke('sauda:create', input),
    list: (): Promise<SaudaListRow[]> => ipcRenderer.invoke('sauda:list'),
    latestRate: (vyapariAccountId: number, kisanAccountId: number): Promise<number | null> =>
      ipcRenderer.invoke('sauda:latestRate', vyapariAccountId, kisanAccountId)
  },
  nikasi: {
    create: (input: NikasiInput): Promise<CreateNikasiResult> =>
      ipcRenderer.invoke('nikasi:create', input),
    list: (): Promise<NikasiListRow[]> => ipcRenderer.invoke('nikasi:list'),
    get: (id: number): Promise<NikasiDetail | null> => ipcRenderer.invoke('nikasi:get', id)
  },
  maps: {
    get: (type: MapType): Promise<StockMap> => ipcRenderer.invoke('maps:get', type),
    racks: (room: number, floor: number, type: MapType): Promise<RackKisanStock[]> =>
      ipcRenderer.invoke('maps:racks', room, floor, type)
  },
  bhada: {
    accrue: (kisanAccountId: number, date: string): Promise<AccrueResult | null> =>
      ipcRenderer.invoke('bhada:accrue', kisanAccountId, date),
    accrueAll: (date: string): Promise<AccrueAllResult> =>
      ipcRenderer.invoke('bhada:accrueAll', date),
    standing: (kisanAccountId: number): Promise<StandingBhada> =>
      ipcRenderer.invoke('bhada:standing', kisanAccountId)
  },
  loans: {
    create: (input: LoanInput): Promise<CreateLoanResult> => ipcRenderer.invoke('loans:create', input),
    list: (asOf?: string): Promise<LoanRow[]> => ipcRenderer.invoke('loans:list', asOf),
    get: (loanId: number, asOf?: string): Promise<LoanDetail | null> =>
      ipcRenderer.invoke('loans:get', loanId, asOf),
    pay: (
      loanId: number,
      amountPaise: number,
      date: string,
      mode: 'cash' | 'bank',
      bankAccountId?: number
    ): Promise<LoanPaymentResult> =>
      ipcRenderer.invoke('loans:pay', loanId, amountPaise, date, mode, bankAccountId),
    capitalise: (loanId: number, onDate: string): Promise<CapitaliseResult | null> =>
      ipcRenderer.invoke('loans:capitalise', loanId, onDate),
    capitaliseAll: (onDate: string): Promise<CapitaliseAllResult> =>
      ipcRenderer.invoke('loans:capitaliseAll', onDate),
    standing: (accountId: number): Promise<StandingLoan> =>
      ipcRenderer.invoke('loans:standing', accountId)
  },
  cheques: {
    record: (input: ChequeInput): Promise<RecordChequeResult> =>
      ipcRenderer.invoke('cheques:record', input),
    list: (status?: ChequeStatus): Promise<ChequeRow[]> => ipcRenderer.invoke('cheques:list', status),
    pendingTotals: (): Promise<{ receivedPaise: number; givenPaise: number }> =>
      ipcRenderer.invoke('cheques:pendingTotals'),
    clear: (chequeId: number, clearanceDate: string): Promise<number> =>
      ipcRenderer.invoke('cheques:clear', chequeId, clearanceDate),
    bounce: (chequeId: number, date: string): Promise<number> =>
      ipcRenderer.invoke('cheques:bounce', chequeId, date)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
