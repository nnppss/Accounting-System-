import { contextBridge, ipcRenderer } from 'electron'
import type { BardanaDirection, ChequeStatus, DrCr, VoucherType } from '../shared/enums'
import type {
  AamadDetail,
  AamadInput,
  AamadListResult,
  AamadListRow,
  AamadSearchFilter,
  MapType,
  AccountDetail,
  AccountIdentityInput,
  AccountInput,
  AccountListFilter,
  AccountListRow,
  AccountOverview,
  AccrueAllResult,
  RentReport,
  AuditFacets,
  AuditFilter,
  AuditLogRow,
  BackupFileRow,
  BackupSettings,
  BardanaAccount,
  BardanaInput,
  BardanaRow,
  Bill,
  BillSubject,
  CashBankAccount,
  ChequeInput,
  ChequeRow,
  ClosePreview,
  CloseResult,
  ContraArg,
  CreateBardanaResult,
  CreateLoanResult,
  CreateNikasiResult,
  DayBook,
  EditVoucherInput,
  ExpensePaymentInput,
  ExpenseRow,
  JournalArg,
  KisanStockLocation,
  LedgerLine,
  LotRemaining,
  LoadingContractorYearInput,
  LoadingContractorYearRow,
  LoanComposition,
  LoanDetail,
  LoanInput,
  AccountInterestRow,
  InterestFixResult,
  PartyInterestFixResult,
  PartyLoanEventRow,
  LoanPaymentResult,
  LoanRow,
  MoneyBookDetailRow,
  MoneyBookSummary,
  NikasiDetail,
  NikasiInput,
  NikasiListFilter,
  NikasiListRow,
  OverviewSection,
  PartyCriteria,
  PartyResult,
  PartyRow,
  PayExpenseResult,
  PersonInput,
  PersonRow,
  PostResult,
  PrintResult,
  XlsxCell,
  RackKisanStock,
  RecordChequeResult,
  ReceiptArg,
  SaudaInput,
  SaudaListRow,
  SettleSaudaResult,
  SavedFilterRow,
  Session,
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
    session: (): Promise<Session | null> => ipcRenderer.invoke('auth:session'),
    changePassword: (currentPassword: string, newPassword: string): Promise<void> =>
      ipcRenderer.invoke('auth:changePassword', currentPassword, newPassword)
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
    overview: (accountId: number): Promise<AccountOverview> =>
      ipcRenderer.invoke('accounts:overview', accountId),
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
    fieldValues: (field: 'villageCity' | 'state' | 'sonOf'): Promise<string[]> =>
      ipcRenderer.invoke('persons:fieldValues', field),
    delete: (personId: number): Promise<void> => ipcRenderer.invoke('persons:delete', personId)
  },
  vouchers: {
    receipt: (arg: ReceiptArg): Promise<PostResult> => ipcRenderer.invoke('vouchers:receipt', arg),
    payment: (arg: ReceiptArg): Promise<PostResult> => ipcRenderer.invoke('vouchers:payment', arg),
    contra: (arg: ContraArg): Promise<PostResult> => ipcRenderer.invoke('vouchers:contra', arg),
    journal: (arg: JournalArg): Promise<PostResult> => ipcRenderer.invoke('vouchers:journal', arg),
    list: (type?: VoucherType): Promise<VoucherListRow[]> => ipcRenderer.invoke('vouchers:list', type),
    get: (voucherId: number): Promise<VoucherDetail | null> =>
      ipcRenderer.invoke('vouchers:get', voucherId),
    update: (voucherId: number, input: EditVoucherInput): Promise<PostResult> =>
      ipcRenderer.invoke('vouchers:update', voucherId, input),
    void: (voucherId: number, reason: string): Promise<void> =>
      ipcRenderer.invoke('vouchers:void', voucherId, reason),
    updateNarration: (voucherId: number, narration: string): Promise<void> =>
      ipcRenderer.invoke('vouchers:updateNarration', voucherId, narration)
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
  daybook: {
    get: (date: string): Promise<DayBook> => ipcRenderer.invoke('daybook:get', date)
  },
  store: {
    get: (): Promise<StoreConfig> => ipcRenderer.invoke('store:get'),
    set: (cfg: StoreConfig): Promise<void> => ipcRenderer.invoke('store:set', cfg)
  },
  aamad: {
    create: (input: AamadInput): Promise<number> => ipcRenderer.invoke('aamad:create', input),
    update: (id: number, input: AamadInput): Promise<void> =>
      ipcRenderer.invoke('aamad:update', id, input),
    list: (filter?: AamadSearchFilter): Promise<AamadListResult> =>
      ipcRenderer.invoke('aamad:list', filter),
    get: (id: number): Promise<AamadDetail | null> => ipcRenderer.invoke('aamad:get', id),
    delete: (id: number): Promise<void> => ipcRenderer.invoke('aamad:delete', id)
  },
  sauda: {
    create: (input: SaudaInput): Promise<number> => ipcRenderer.invoke('sauda:create', input),
    list: (): Promise<SaudaListRow[]> => ipcRenderer.invoke('sauda:list'),
    delete: (id: number): Promise<void> => ipcRenderer.invoke('sauda:delete', id),
    rateForLifting: (vyapariAccountId: number, kisanAccountId: number): Promise<number | null> =>
      ipcRenderer.invoke('sauda:rateForLifting', vyapariAccountId, kisanAccountId),
    settle: (id: number, input: { date: string; amountPaise: number }): Promise<SettleSaudaResult> =>
      ipcRenderer.invoke('sauda:settle', id, input),
    unsettle: (id: number): Promise<void> => ipcRenderer.invoke('sauda:unsettle', id)
  },
  nikasi: {
    create: (input: NikasiInput): Promise<CreateNikasiResult> =>
      ipcRenderer.invoke('nikasi:create', input),
    list: (filter?: NikasiListFilter): Promise<NikasiListRow[]> =>
      ipcRenderer.invoke('nikasi:list', filter),
    get: (id: number): Promise<NikasiDetail | null> => ipcRenderer.invoke('nikasi:get', id),
    lots: (kisanAccountId?: number): Promise<LotRemaining[]> =>
      ipcRenderer.invoke('nikasi:lots', kisanAccountId),
    delete: (id: number): Promise<void> => ipcRenderer.invoke('nikasi:delete', id)
  },
  maps: {
    get: (type: MapType): Promise<StockMap> => ipcRenderer.invoke('maps:get', type),
    racks: (room: number, floor: number, type: MapType): Promise<RackKisanStock[]> =>
      ipcRenderer.invoke('maps:racks', room, floor, type),
    kisanStock: (kisanAccountId: number): Promise<KisanStockLocation[]> =>
      ipcRenderer.invoke('maps:kisanStock', kisanAccountId)
  },
  bhada: {
    accrueAll: (date: string): Promise<AccrueAllResult> =>
      ipcRenderer.invoke('bhada:accrueAll', date),
    setRate: (ratePaise: number, date: string): Promise<AccrueAllResult> =>
      ipcRenderer.invoke('bhada:setRate', ratePaise, date),
    report: (): Promise<RentReport> => ipcRenderer.invoke('bhada:report')
  },
  loans: {
    create: (input: LoanInput): Promise<CreateLoanResult> => ipcRenderer.invoke('loans:create', input),
    list: (asOf?: string): Promise<LoanRow[]> => ipcRenderer.invoke('loans:list', asOf),
    get: (loanId: number, asOf?: string): Promise<LoanDetail | null> =>
      ipcRenderer.invoke('loans:get', loanId, asOf),
    composition: (loanId: number): Promise<LoanComposition | null> =>
      ipcRenderer.invoke('loans:composition', loanId),
    partyEvents: (accountId: number): Promise<PartyLoanEventRow[]> =>
      ipcRenderer.invoke('loans:partyEvents', accountId),
    pay: (
      loanId: number,
      amountPaise: number,
      date: string,
      mode: 'cash' | 'bank' | 'cheque',
      bankAccountId?: number,
      chequeNo?: string,
      chequeBank?: string
    ): Promise<LoanPaymentResult> =>
      ipcRenderer.invoke('loans:pay', loanId, amountPaise, date, mode, bankAccountId, chequeNo, chequeBank),
    undoPayment: (eventId: number): Promise<void> => ipcRenderer.invoke('loans:undoPayment', eventId),
    accountInterest: (accountId: number, asOf?: string): Promise<AccountInterestRow[]> =>
      ipcRenderer.invoke('loans:accountInterest', accountId, asOf),
    fixInterest: (loanId: number, atDate: string, interestPaise: number): Promise<InterestFixResult> =>
      ipcRenderer.invoke('loans:fixInterest', loanId, atDate, interestPaise),
    fixPartyInterest: (
      accountId: number,
      atDate: string,
      totalInterestPaise: number
    ): Promise<PartyInterestFixResult> =>
      ipcRenderer.invoke('loans:fixPartyInterest', accountId, atDate, totalInterestPaise)
  },
  cheques: {
    record: (input: ChequeInput): Promise<RecordChequeResult> =>
      ipcRenderer.invoke('cheques:record', input),
    list: (status?: ChequeStatus): Promise<ChequeRow[]> => ipcRenderer.invoke('cheques:list', status),
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
    delete: (id: number): Promise<void> => ipcRenderer.invoke('bardana:delete', id),
    deliver: (id: number): Promise<void> => ipcRenderer.invoke('bardana:deliver', id)
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
  backup: {
    settings: (): Promise<BackupSettings> => ipcRenderer.invoke('backup:settings'),
    // Native folder picker; resolves null if the user cancels.
    chooseDir: (): Promise<string | null> => ipcRenderer.invoke('backup:chooseDir'),
    setDir: (dir: string): Promise<string> => ipcRenderer.invoke('backup:setDir', dir),
    now: (): Promise<string | null> => ipcRenderer.invoke('backup:now'),
    list: (): Promise<BackupFileRow[]> => ipcRenderer.invoke('backup:list'),
    openFolder: (): Promise<void> => ipcRenderer.invoke('backup:openFolder')
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
    overview: (accountId: number, section?: OverviewSection): Promise<PrintResult> =>
      ipcRenderer.invoke('print:overview', accountId, section),
    trialBalance: (): Promise<PrintResult> => ipcRenderer.invoke('print:trialBalance'),
    moneyBookSummary: (accountId: number): Promise<PrintResult> =>
      ipcRenderer.invoke('print:moneyBookSummary', accountId),
    moneyBookDetail: (accountId: number, month: number): Promise<PrintResult> =>
      ipcRenderer.invoke('print:moneyBookDetail', accountId, month),
    dayBook: (date: string): Promise<PrintResult> => ipcRenderer.invoke('print:dayBook', date),
    financials: (): Promise<PrintResult> => ipcRenderer.invoke('print:financials'),
    aamadReceipt: (aamadId: number): Promise<PrintResult> => ipcRenderer.invoke('print:aamadReceipt', aamadId),
    loanStatement: (loanId: number): Promise<PrintResult> => ipcRenderer.invoke('print:loanStatement', loanId),
    aamadRegister: (subtitle: string, rows: AamadListRow[]): Promise<PrintResult> =>
      ipcRenderer.invoke('print:aamadRegister', subtitle, rows),
    saudaRegister: (rows: SaudaListRow[]): Promise<PrintResult> =>
      ipcRenderer.invoke('print:saudaRegister', rows),
    nikasiRegister: (subtitle: string, rows: NikasiListRow[]): Promise<PrintResult> =>
      ipcRenderer.invoke('print:nikasiRegister', subtitle, rows),
    expenseRegister: (
      subtitle: string,
      rows: Array<ExpenseRow & { kind: 'salary' | 'loading' }>
    ): Promise<PrintResult> => ipcRenderer.invoke('print:expenseRegister', subtitle, rows),
    bardana: (subtitle: string, rows: BardanaRow[]): Promise<PrintResult> =>
      ipcRenderer.invoke('print:bardana', subtitle, rows),
    loanRegister: (rows: LoanRow[]): Promise<PrintResult> => ipcRenderer.invoke('print:loanRegister', rows),
    party: (subtitle: string, rows: PartyRow[]): Promise<PrintResult> =>
      ipcRenderer.invoke('print:party', subtitle, rows)
  },
  exportXlsx: (
    fileName: string,
    sheetName: string,
    columns: string[],
    rows: XlsxCell[][],
    moneyColumns: number[] = []
  ): Promise<PrintResult> =>
    ipcRenderer.invoke('export:xlsx', fileName, sheetName, columns, rows, moneyColumns)
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
