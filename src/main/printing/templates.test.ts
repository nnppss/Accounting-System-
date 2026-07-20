import { describe, expect, it } from 'vitest'
import type {
  AamadDetail,
  AamadListRow,
  AccountOverview,
  BardanaAccount,
  BardanaRow,
  Bill,
  DayBook,
  ExpenseRow,
  LedgerLine,
  LoanDetail,
  LoanRow,
  MoneyBookDetailRow,
  MoneyBookSummary,
  NikasiDetail,
  NikasiListRow,
  PartyRow,
  SaudaListRow,
  TrialBalance,
  VoucherDetail
} from '../../shared/contracts'
import { deriveFinancials } from '../../shared/financials'
import {
  aamadReceiptHtml,
  aamadRegisterHtml,
  bardanaHtml,
  billHtml,
  dayBookHtml,
  expenseRegisterHtml,
  financialsHtml,
  gatePassHtml,
  ledgerHtml,
  loanRegisterHtml,
  loanStatementHtml,
  moneyBookDetailHtml,
  moneyBookSummaryHtml,
  nikasiRegisterHtml,
  overviewAamadHtml,
  overviewHtml,
  overviewNikasiHtml,
  partyHtml,
  saudaRegisterHtml,
  trialBalanceHtml,
  voucherHtml
} from './templates'
import type { OverviewAamadLot, OverviewGatePass } from './templates'

/**
 * The print templates are pure (DTO → HTML string), so they're tested directly — no DB, no
 * Electron. We assert the key figures land, that names are HTML-escaped, and that the bilingual
 * (English / हिन्दी) labels are present.
 */
describe('print templates', () => {
  it('renders a gate pass with its lines and totals (bilingual)', () => {
    const n: NikasiDetail = {
      id: 1,
      billNo: 42,
      date: '2026-04-15',
      vehicleNo: 'UP25 1234',
      deliveredToType: 'vyapari',
      deliveredToAccountId: 9,
      deliveredToName: 'Gopal',
      receivedBy: 'Ramu',
      bhadaRecoveredPaise: 50000,
      remark: null,
      voucherNo: 7,
      weighments: [
        {
          fromKisanAccountId: 3,
          fromKisanName: 'Ramesh',
          ratePaise: 40000,
          weightKg: 4000,
          packets: 80,
          amountPaise: 3200000,
          lots: [{ aamadId: 11, lotNo: '7/345', packets: 80 }]
        }
      ],
      totalWeightKg: 4000
    }
    const html = gatePassHtml(n)
    expect(html).toContain('Gate Pass / गेट पास')
    expect(html).toContain('#42')
    expect(html).toContain('Gopal')
    expect(html).toContain('7/345')
    expect(html).toContain('₹32,000.00') // line amount = total
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true)
  })

  it('gate pass: prints the remark, and drops rate/amount when a kisan takes his own stock', () => {
    const base: NikasiDetail = {
      id: 2,
      billNo: 43,
      date: '2026-04-16',
      vehicleNo: null,
      deliveredToType: 'kisan',
      deliveredToAccountId: 3,
      deliveredToName: 'Ramesh',
      receivedBy: null,
      bhadaRecoveredPaise: 0,
      remark: '15 packets spoilt — only 100 weighed',
      voucherNo: null,
      weighments: [
        {
          fromKisanAccountId: 3,
          fromKisanName: 'Ramesh',
          ratePaise: 0,
          weightKg: 2000,
          packets: 100,
          amountPaise: 0,
          lots: [{ aamadId: 11, lotNo: '7/345', packets: 100 }]
        }
      ],
      totalWeightKg: 2000
    }
    const html = gatePassHtml(base)
    expect(html).toContain('15 packets spoilt')
    expect(html).toContain('By kisan / किसान अनुसार')
    // He bought nothing, so the sale columns are absent — as on screen.
    expect(html).not.toContain('Rate /105kg')
    expect(html).not.toContain('Goods value')
    // The vyapari sale still gets them.
    expect(gatePassHtml({ ...base, deliveredToType: 'vyapari' })).toContain('Rate /105kg')
  })

  it('renders a person-wise bill with a section per role and the combined net', () => {
    const bill: Bill = {
      subjectKey: 'person:1',
      personId: 1,
      name: 'Hari',
      sonOf: 'Shyam',
      villageCity: 'Kasganj',
      phone: '70001',
      asOf: '2026-07-01',
      combinedNetPaise: -820000,
      sections: [
        {
          accountId: 3,
          accountName: 'Hari (K)',
          role: 'kisan',
          subgroupName: 'Farmer',
          ledgerLines: [
            {
              voucherId: 1,
              voucherNo: 1,
              type: 'journal',
              sourceModule: 'bhada',
              date: '2026-06-30',
              narration: 'Bhada',
              tag: 'rent',
              drPaise: 200000,
              crPaise: 0,
              balancePaise: 200000,
              mode: '',
              counterparty: ''
            }
          ],
          postedBalancePaise: 200000,
          standingBhadaPaise: 200000,
          loans: [],
          unpostedInterestPaise: 0,
          bardanaRows: [],
          expenseRows: [],
          netPaise: 200000
        }
      ]
    }
    const html = billHtml(bill)
    expect(html).toContain('Bill / बिल')
    expect(html).toContain('Hari')
    expect(html).toContain('kisan')
    expect(html).toContain('₹2,000.00') // standing bhada / balance
    expect(html).toContain('Combined net / कुल शेष')
    expect(html).toContain('₹8,200.00 Cr') // combined net is a credit
  })

  it('escapes HTML in user-supplied text', () => {
    const v: VoucherDetail = {
      id: 1,
      no: 5,
      type: 'receipt',
      date: '2026-03-01',
      narration: '<script>alert(1)</script>',
      entries: [
        { accountId: 1, accountName: 'Cash & Co <b>', drPaise: 100000, crPaise: 0, tag: 'general' },
        { accountId: 2, accountName: 'Ramesh', drPaise: 0, crPaise: 100000, tag: 'general' }
      ]
    }
    const html = voucherHtml(v)
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('Cash &amp; Co &lt;b&gt;')
    expect(html).toContain('₹1,000.00')
  })

  it('renders a ledger statement with a closing balance', () => {
    const lines: LedgerLine[] = [
      {
        voucherId: 1,
        voucherNo: 1,
        type: 'payment',
        sourceModule: 'loan',
        date: '2026-01-01',
        narration: 'Loan given',
        tag: 'loan',
        drPaise: 10000000,
        crPaise: 0,
        balancePaise: 10000000,
        mode: 'Cash',
        counterparty: 'Cash'
      }
    ]
    const html = ledgerHtml('Suresh Vyapari', lines)
    expect(html).toContain('Ledger Statement / खाता विवरण')
    expect(html).toContain('Suresh Vyapari')
    expect(html).toContain('Closing balance / अंतिम शेष')
    expect(html).toContain('₹1,00,000.00 Dr')
    // The screen's columns: the document that made the voucher, how the money moved, and with whom.
    expect(html).toContain('Loan / ऋण')
    expect(html).toContain('Paid / भुगतान')
    expect(html).toContain('Cash')
    // No loans on this party → no interest restatement, same as the Ledger tab.
    expect(html).not.toContain('Balance + interest')
  })

  it('ledger statement restates the balance with interest the ledger has not been charged yet', () => {
    const lines: LedgerLine[] = [
      {
        voucherId: 1,
        voucherNo: 1,
        type: 'payment',
        sourceModule: 'loan',
        date: '2026-01-01',
        narration: 'Loan given',
        tag: 'loan',
        drPaise: 10000000,
        crPaise: 0,
        balancePaise: 10000000,
        mode: 'Cash',
        counterparty: 'Cash'
      }
    ]
    const html = ledgerHtml('Suresh Vyapari', lines, null, 150000)
    expect(html).toContain('Standing interest (to date) / अब तक का ब्याज')
    expect(html).toContain('₹1,500.00')
    expect(html).toContain('₹1,01,500.00 Dr') // balance + interest
  })

  it('renders the account overview snapshot, dropping the tiles that are zero', () => {
    const o: AccountOverview = {
      accountId: 3,
      stock: {
        aamadPackets: 500,
        aamadCount: 2,
        nikasiOutPackets: 300,
        nikasiOutWeightKg: 15000,
        balancePackets: 200,
        purchasedPackets: 0,
        purchasedWeightKg: 0
      },
      money: {
        openingPaise: 0,
        rentPaise: 250000,
        loanPaise: 10000000,
        interestPaise: 150000,
        tradePaise: 0,
        otherPaise: 0,
        balancePaise: 10250000,
        newBalancePaise: 10400000
      },
      rentRatePaise: 5000
    }
    const html = overviewHtml('Ramesh', o)
    expect(html).toContain('Account Overview / खाता अवलोकन')
    expect(html).toContain('Ramesh')
    expect(html).toContain('500') // aamad in
    expect(html).toContain('2 aamad / आमद')
    expect(html).toContain('15,000 kg / किग्रा')
    expect(html).toContain('Rent / किराया')
    expect(html).toContain('₹1,04,000.00 Dr') // balance + interest
    // Nothing was purchased and there is no opening — those tiles are absent, as on screen.
    expect(html).not.toContain('Purchased')
    expect(html).not.toContain('Opening')
  })

  it('overview aamad drill: a row per lot with its racks, what went out, and the rent it carries', () => {
    const lots: OverviewAamadLot[] = [
      {
        id: 11, no: '2026-18', date: '2026-03-02', kisanAccountId: 3, kisanName: 'Ramesh',
        kisanSonOf: 'Mohan Lal', totalPackets: 215, assignedPackets: 215, outPackets: 120,
        locations: [{ id: 1, room: 1, floor: 2, rack: 3, packets: 115 }, { id: 2, room: 1, floor: 2, rack: 4, packets: 100 }]
      },
      {
        id: 13, no: '2026-19', date: '2026-03-11', kisanAccountId: 3, kisanName: 'Ramesh',
        kisanSonOf: 'Mohan Lal', totalPackets: 85, assignedPackets: 0, outPackets: 0, locations: []
      }
    ]
    const html = overviewAamadHtml('Ramesh', lots, 5000) // ₹50/packet
    expect(html).toContain('Aamad — packets brought in / आमद — लाए गए पैकेट')
    expect(html).toContain('18/215') // lot label
    expect(html).toContain('R1/F2/3')
    expect(html).toContain('Not placed / स्थान नहीं') // a lot with no rack assigned yet
    expect(html).toContain('₹15,000.00') // 300 packets × ₹50 = total rent
    expect(html).toContain('₹10,750.00') // lot 18's own rent: 215 × ₹50
  })

  it('overview nikasi drill: a block per gate pass with its weighing register', () => {
    const passes: OverviewGatePass[] = [
      {
        id: 2, billNo: 43, date: '2026-04-16', deliveredToType: 'vyapari', deliveredToAccountId: 9,
        deliveredToName: 'Gopal', deliveredToSonOf: 'Hari Om', vehicleNo: 'UP25 1234',
        totalPackets: 200, totalWeightKg: 21040, totalAmountPaise: 18034200, isPosted: true,
        weighments: [
          {
            fromKisanAccountId: 3, fromKisanName: 'Ramesh', ratePaise: 90000, weightKg: 21040,
            packets: 200, amountPaise: 18034200,
            lots: [{ aamadId: 11, lotNo: '18/215', packets: 120 }, { aamadId: 12, lotNo: '17/200', packets: 80 }]
          }
        ]
      }
    ]
    const html = overviewNikasiHtml('Nikasi / निकासी', 'Ramesh', passes, 5000)
    expect(html).toContain('Gate pass / गेट पास #43')
    expect(html).toContain('Gopal <span class="muted">s/o Hari Om</span>')
    expect(html).toContain('18/215')
    expect(html).toContain('21,040') // weight, Indian grouping
    expect(html).toContain('105.20') // avg kg per packet
    expect(html).toContain('₹10,000.00') // rent: 200 × ₹50
    expect(html).toContain('₹1,80,342.00')
  })

  it('renders a trial balance with totals and a balanced flag', () => {
    const tb: TrialBalance = {
      rows: [
        { accountId: 1, accountName: 'Ramesh', subgroupName: 'Farmer', nature: 'asset', drPaise: 200000, crPaise: 0 },
        {
          accountId: 2,
          accountName: 'Rent Income',
          subgroupName: 'Revenue Account',
          nature: 'income',
          drPaise: 0,
          crPaise: 200000
        }
      ],
      totalDr: 200000,
      totalCr: 200000,
      balanced: true
    }
    const html = trialBalanceHtml(2026, tb)
    expect(html).toContain('Trial Balance / तलपट')
    expect(html).toContain('Balanced / संतुलित')
    expect(html).toContain('Ramesh')
    expect(html).toContain('₹2,000.00')
  })
})

/** Smoke coverage for the register/report documents: each key figure lands and the header renders. */
describe('register & report templates', () => {
  it('money book summary + month detail', () => {
    const s: MoneyBookSummary = {
      months: [{ month: 1, openingPaise: 0, receiptsPaise: 100000, paymentsPaise: 0, closingPaise: 100000 }],
      openingPaise: 0,
      closingPaise: 100000
    }
    const sum = moneyBookSummaryHtml('Cash', 2026, s)
    expect(sum).toContain('Money Book / रोकड़ बही')
    expect(sum).toContain('Jan')
    expect(sum).toContain('₹1,000.00')

    const rows: MoneyBookDetailRow[] = [
      { voucherId: 1, voucherNo: 3, type: 'receipt', date: '2026-01-05', narration: 'x', counterparties: [{ id: 2, name: 'Ramesh' }], receiptPaise: 100000, paymentPaise: 0, balancePaise: 100000 }
    ]
    const det = moneyBookDetailHtml('Cash', 2026, 1, rows)
    expect(det).toContain('Jan 2026')
    expect(det).toContain('Ramesh')
    expect(det).toContain('₹1,000.00')
  })

  it('day book', () => {
    const db: DayBook = {
      date: '2026-01-05',
      sections: [
        {
          accountId: 1,
          accountName: 'Cash',
          openingPaise: 0,
          closingPaise: 100000,
          rows: [
            {
              voucherId: 1,
              voucherNo: 3,
              type: 'receipt',
              date: '2026-01-05',
              narration: 'x',
              counterparties: [{ id: 2, name: 'Ramesh' }],
              receiptPaise: 100000,
              paymentPaise: 0,
              balancePaise: 100000
            }
          ]
        }
      ],
      totalReceiptPaise: 100000,
      totalPaymentPaise: 0
    }
    const html = dayBookHtml(db)
    expect(html).toContain('Day Book / दैनिक बही')
    expect(html).toContain('Cash')
    expect(html).toContain('Ramesh')
    expect(html).toContain('₹1,000.00')
  })

  it('aamad register + receipt', () => {
    const rows: AamadListRow[] = [
      { id: 1, no: 'A-7', date: '2026-01-01', kisanAccountId: 3, kisanName: 'Ramesh', kisanSonOf: null, totalPackets: 80, assignedPackets: 80, outPackets: 0 }
    ]
    const reg = aamadRegisterHtml('Ramesh', rows)
    expect(reg).toContain('Aamad Register / आमद रजिस्टर')
    expect(reg).toContain('A-7')
    expect(reg).toContain('Ramesh')

    const a: AamadDetail = {
      id: 1,
      no: 'A-7',
      date: '2026-01-01',
      kisanAccountId: 3,
      kisanName: 'Ramesh',
      kisanSonOf: null,
      totalPackets: 80,
      assignedPackets: 80,
      locations: [{ id: 1, room: 1, floor: 2, rack: 3, packets: 80 }]
    }
    const rec = aamadReceiptHtml(a)
    expect(rec).toContain('Aamad Receipt / आमद रसीद')
    expect(rec).toContain('A-7')
  })

  it('sauda + nikasi registers', () => {
    const sauda: SaudaListRow[] = [
      { id: 1, date: '2026-01-01', vyapariAccountId: 9, vyapariName: 'Gopal', vyapariSonOf: null, kisanAccountId: 3, kisanName: 'Ramesh', kisanSonOf: null, aamadId: 11, lotNo: '7/345', packets: 50, ratePaise: 40000, liftedPackets: 50, shortfallPackets: 0, suggestedShortfallPaise: null, settlementVoucherId: null, settlementPaise: null }
    ]
    const sHtml = saudaRegisterHtml(sauda)
    expect(sHtml).toContain('Sauda Register / सौदा रजिस्टर')
    expect(sHtml).toContain('Gopal')
    expect(sHtml).toContain('₹400.00')

    const nik: NikasiListRow[] = [
      { id: 1, billNo: 42, date: '2026-01-01', deliveredToType: 'vyapari', deliveredToAccountId: 9, deliveredToName: 'Gopal', deliveredToSonOf: null, vehicleNo: 'UP25', totalPackets: 80, totalWeightKg: 4000, totalAmountPaise: 3200000, isPosted: true }
    ]
    const nHtml = nikasiRegisterHtml('Gopal', nik)
    expect(nHtml).toContain('Nikasi Register / निकासी रजिस्टर')
    expect(nHtml).toContain('#42')
    expect(nHtml).toContain('₹32,000.00')
  })

  it('financial statements', () => {
    const tb: TrialBalance = {
      rows: [
        { accountId: 1, accountName: 'Ramesh', subgroupName: 'Farmer', nature: 'asset', drPaise: 200000, crPaise: 0 },
        { accountId: 2, accountName: 'Rent Income', subgroupName: 'Revenue Account', nature: 'income', drPaise: 0, crPaise: 200000 }
      ],
      totalDr: 200000,
      totalCr: 200000,
      balanced: true
    }
    const html = financialsHtml(2026, deriveFinancials(tb))
    expect(html).toContain('Financial Statements / वित्तीय विवरण')
    expect(html).toContain('Income Statement / आय विवरण')
    expect(html).toContain('Balance Sheet / तुलन पत्र')
    expect(html).toContain('Ramesh')
  })

  it('expense register (combined salary + loading)', () => {
    const rows: Array<ExpenseRow & { kind: 'salary' | 'loading' }> = [
      { voucherId: 1, voucherNo: 3, date: '2026-01-01', partyAccountId: 5, partyName: 'Staff A', partySonOf: null, amountPaise: 500000, narration: 'salary', kind: 'salary' }
    ]
    const html = expenseRegisterHtml('', rows)
    expect(html).toContain('Expense Register / व्यय रजिस्टर')
    expect(html).toContain('Staff A')
    expect(html).toContain('₹5,000.00')
  })

  it('bardana account', () => {
    const acct: BardanaAccount = {
      purchases: [],
      issues: [],
      totalPurchasesPaise: 100000,
      totalSalesPaise: 150000,
      stockCount: 10,
      reservedQty: 0,
      profitPaise: 50000
    }
    const rows: BardanaRow[] = [
      { id: 1, direction: 'purchase', date: '2026-01-01', partyAccountId: 5, partyName: 'Supplier', partySonOf: null, ratePaise: 1000, qty: 100, amountPaise: 100000, paidPaise: 100000, mode: 'cash', bankAccountId: null, bankName: null, prebooked: false }
    ]
    const html = bardanaHtml('', acct, rows)
    expect(html).toContain('Bardana Account / बारदाना खाता')
    expect(html).toContain('Supplier')
    expect(html).toContain('₹1,000.00')
    expect(html).toContain('Outstanding / बकाया')
    expect(html).toContain('Settled') // amount fully paid → settled
  })

  it('bardana shows credit + due for an unpaid deal', () => {
    const acct: BardanaAccount = { purchases: [], issues: [], totalPurchasesPaise: 0, totalSalesPaise: 100000, stockCount: 0, reservedQty: 0, profitPaise: 100000 }
    const credit: BardanaRow = { id: 2, direction: 'issue', date: '2026-02-01', partyAccountId: 6, partyName: 'Buyer', partySonOf: null, ratePaise: 1000, qty: 100, amountPaise: 100000, paidPaise: 0, mode: 'cash', bankAccountId: null, bankName: null, prebooked: false }
    const html = bardanaHtml('', acct, [credit])
    expect(html).toContain('Credit') // fully unpaid
  })

  it('loan register + statement', () => {
    const base: LoanRow = {
      id: 1,
      category: 'kisan',
      accountId: 3,
      accountName: 'Ramesh',
      sonOf: 'Shyam',
      date: '2026-01-01',
      principalPaise: 1000000,
      mobile: null,
      mode: 'cash',
      bankAccountId: null,
      nature: 'direct',
      monthlyRateBps: 150,
      interestStartDate: '2026-01-01',
      remark: null,
      outstandingPaise: 1050000
    }
    const reg = loanRegisterHtml([base])
    expect(reg).toContain('Loan Register / ऋण रजिस्टर')
    expect(reg).toContain('Ramesh')
    expect(reg).toContain('1.5%/mo')
    expect(reg).toContain('₹10,000.00')
    expect(reg).toContain('Interest / ब्याज')
    expect(reg).toContain('+₹500.00') // outstanding − principal = interest accrued

    const d: LoanDetail = {
      ...base,
      events: [{ id: 1, loanId: 1, date: '2026-01-01', type: 'disbursement', amountPaise: 1000000, voucherId: 7 }],
      breakdown: { loanId: 1, principalPaise: 1000000, accruedInterestPaise: 50000, outstandingPaise: 1050000, asOf: '2026-07-01' }
    }
    const stmt = loanStatementHtml(d, null)
    expect(stmt).toContain('Loan Statement / ऋण विवरण')
    expect(stmt).toContain('Ramesh')
    expect(stmt).toContain('₹10,500.00')
  })

  it('party report', () => {
    const rows: PartyRow[] = [
      { accountId: 3, personId: 1, name: 'Ramesh', sonOf: 'Shyam', villageCity: 'Kasganj', phone: '70001', type: 'kisan', subgroupName: 'Farmer', isDefaulter: false, balancePaise: 200000, packetsBrought: 80, aamadCount: 1, currentStock: 0, packetsSold: 80, standingBhadaPaise: 0, loanOutstandingPaise: 0, bardanaQty: 0 }
    ]
    const html = partyHtml('', rows)
    expect(html).toContain('Party Report / पक्ष रिपोर्ट')
    expect(html).toContain('Ramesh')
    expect(html).toContain('Kasganj')
    expect(html).toContain('Brought / आमद') // packets brought column (matches the screen)
  })
})
