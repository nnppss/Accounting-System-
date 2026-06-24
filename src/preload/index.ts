import { contextBridge, ipcRenderer } from 'electron'
import type { BardanaDirection, ChequeStatus, DrCr, VoucherType } from '../shared/enums'
import type {
  AamadDetail,
  AamadInput,
  AamadListResult,
  AamadSearchFilter,
  MapType,
  AccountDetail,
  AccountIdentityInput,
  AccountInput,
  AccountListFilter,
  AccountListRow,
  AccrueAllResult,
  AccrueResult,
  AuditFacets,
  AuditFilter,
  AuditLogRow,
  BardanaAccount,
  BardanaInput,
  BardanaRow,
  Bill,
  BillSubject,
  CapitaliseAllResult,
  CapitaliseResult,
  CashBankAccount,
  ChequeInput,
  ChequeRow,
  ClosePreview,
  CloseResult,
  ContraArg,
  CreateBardanaResult,
  CreateLoanResult,
  CreateNikasiResult,
  ExpensePaymentInput,
  ExpenseRow,
  JournalArg,
  LedgerLine,
  LoadingContractorYearInput,
  LoadingContractorYearRow,
  LoanComposition,
  LoanDetail,
  LoanInput,
  LoanPaymentResult,
  LoanRow,
  MoneyBookDetailRow,
  MoneyBookSummary,
  NikasiDetail,
  NikasiInput,
  NikasiListRow,
  PartyCriteria,
  PartyResult,
  PayExpenseResult,
  PersonInput,
  PersonRow,
  PostResult,
  PrintResult,
  RackKisanStock,
  RecordChequeResult,
  ReceiptArg,
  SaudaInput,
  SaudaListRow,
  SavedFilterRow,
  Session,
  StandingBhada,
  StandingLoan,
  StockMap,
  StoreConfig,
  SubgroupRow,
  TrialBalance,
  VoucherDetail,
  VoucherListRow,
  YearCloseInfo,
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
    login: (
      year: number,
      username: string,
      password: string,
      accountantName?: string
    ): Promise<Session> =>
      ipcRenderer.invoke('auth:login', year, username, password, accountantName),
    logout: (): Promise<void> => ipcRenderer.invoke('auth:logout'),
    session: (): Promise<Session | null> => ipcRenderer.invoke('auth:session')
  },
  accounts: {
    subgroups: (): Promise<SubgroupRow[]> => ipcRenderer.invoke('accounts:subgroups'),
    list: (filter?: AccountListFilter): Promise<AccountListRow[]> =>
      ipcRenderer.invoke('accounts:list', filter),
    create: (input: AccountInput): Promise<number> => ipcRenderer.invoke('accounts:create', input),
    detail: (accountId: number): Promise<AccountDetail | null> =>
      ipcRenderer.invoke('accounts:detail', accountId),
    updateIdentity: (accountId: number, input: AccountIdentityInput): Promise<void> =>
      ipcRenderer.invoke('accounts:updateIdentity', accountId, input),
    ledger: (accountId: number): Promise<LedgerLine[]> =>
      ipcRenderer.invoke('accounts:ledger', accountId),
    setOpening: (accountId: number, amountPaise: number, drCr: DrCr, date: string): Promise<void> =>
      ipcRenderer.invoke('accounts:setOpening', accountId, amountPaise, drCr, date),
    setDefaulter: (accountId: number, isDefaulter: boolean): Promise<void> =>
      ipcRenderer.invoke('accounts:setDefaulter', accountId, isDefaulter),
    delete: (accountId: number, password: string): Promise<void> =>
      ipcRenderer.invoke('accounts:delete', accountId, password)
  },
  persons: {
    create: (input: PersonInput): Promise<number> => ipcRenderer.invoke('persons:create', input),
    list: (search?: string): Promise<PersonRow[]> => ipcRenderer.invoke('persons:list', search),
    delete: (personId: number): Promise<void> => ipcRenderer.invoke('persons:delete', personId)
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
    get: (id: number): Promise<AamadDetail | null> => ipcRenderer.invoke('aamad:get', id),
    delete: (id: number): Promise<void> => ipcRenderer.invoke('aamad:delete', id)
  },
  sauda: {
    create: (input: SaudaInput): Promise<number> => ipcRenderer.invoke('sauda:create', input),
    list: (): Promise<SaudaListRow[]> => ipcRenderer.invoke('sauda:list'),
    delete: (id: number): Promise<void> => ipcRenderer.invoke('sauda:delete', id),
    latestRate: (vyapariAccountId: number, kisanAccountId: number): Promise<number | null> =>
      ipcRenderer.invoke('sauda:latestRate', vyapariAccountId, kisanAccountId)
  },
  nikasi: {
    create: (input: NikasiInput): Promise<CreateNikasiResult> =>
      ipcRenderer.invoke('nikasi:create', input),
    list: (): Promise<NikasiListRow[]> => ipcRenderer.invoke('nikasi:list'),
    get: (id: number): Promise<NikasiDetail | null> => ipcRenderer.invoke('nikasi:get', id),
    delete: (id: number): Promise<void> => ipcRenderer.invoke('nikasi:delete', id)
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
    composition: (loanId: number): Promise<LoanComposition | null> =>
      ipcRenderer.invoke('loans:composition', loanId),
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
  },
  bardana: {
    create: (input: BardanaInput): Promise<CreateBardanaResult> =>
      ipcRenderer.invoke('bardana:create', input),
    list: (direction?: BardanaDirection): Promise<BardanaRow[]> =>
      ipcRenderer.invoke('bardana:list', direction),
    account: (): Promise<BardanaAccount> => ipcRenderer.invoke('bardana:account'),
    delete: (id: number): Promise<void> => ipcRenderer.invoke('bardana:delete', id)
  },
  expenses: {
    paySalary: (input: ExpensePaymentInput): Promise<PayExpenseResult> =>
      ipcRenderer.invoke('expenses:paySalary', input),
    salaryRegister: (): Promise<ExpenseRow[]> => ipcRenderer.invoke('expenses:salaryRegister'),
    payLoading: (input: ExpensePaymentInput): Promise<PayExpenseResult> =>
      ipcRenderer.invoke('expenses:payLoading', input),
    loadingRegister: (): Promise<ExpenseRow[]> => ipcRenderer.invoke('expenses:loadingRegister'),
    loadingYears: (): Promise<LoadingContractorYearRow[]> =>
      ipcRenderer.invoke('expenses:loadingYears'),
    loadingYear: (accountId: number): Promise<LoadingContractorYearRow> =>
      ipcRenderer.invoke('expenses:loadingYear', accountId),
    setLoadingYear: (input: LoadingContractorYearInput): Promise<void> =>
      ipcRenderer.invoke('expenses:setLoadingYear', input)
  },
  bills: {
    subjects: (asOf?: string): Promise<BillSubject[]> => ipcRenderer.invoke('bills:subjects', asOf),
    get: (accountId: number, asOf?: string): Promise<Bill | null> =>
      ipcRenderer.invoke('bills:get', accountId, asOf)
  },
  party: {
    search: (criteria?: PartyCriteria, asOf?: string): Promise<PartyResult> =>
      ipcRenderer.invoke('party:search', criteria, asOf),
    savedFilters: (): Promise<SavedFilterRow[]> => ipcRenderer.invoke('party:savedFilters'),
    saveFilter: (name: string, criteria: PartyCriteria): Promise<number> =>
      ipcRenderer.invoke('party:saveFilter', name, criteria),
    deleteFilter: (id: number): Promise<void> => ipcRenderer.invoke('party:deleteFilter', id)
  },
  audit: {
    list: (filter?: AuditFilter): Promise<AuditLogRow[]> => ipcRenderer.invoke('audit:list', filter),
    facets: (): Promise<AuditFacets> => ipcRenderer.invoke('audit:facets')
  },
  close: {
    preview: (): Promise<ClosePreview> => ipcRenderer.invoke('close:preview'),
    status: (): Promise<YearCloseInfo | null> => ipcRenderer.invoke('close:status'),
    run: (password: string): Promise<CloseResult> => ipcRenderer.invoke('close:run', password),
    rollback: (password: string): Promise<YearCloseInfo> => ipcRenderer.invoke('close:rollback', password)
  },
  print: {
    gatePass: (nikasiId: number): Promise<PrintResult> => ipcRenderer.invoke('print:gatePass', nikasiId),
    bill: (accountId: number, asOf?: string): Promise<PrintResult> =>
      ipcRenderer.invoke('print:bill', accountId, asOf),
    voucher: (voucherId: number): Promise<PrintResult> => ipcRenderer.invoke('print:voucher', voucherId),
    ledger: (accountId: number): Promise<PrintResult> => ipcRenderer.invoke('print:ledger', accountId),
    trialBalance: (): Promise<PrintResult> => ipcRenderer.invoke('print:trialBalance')
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
