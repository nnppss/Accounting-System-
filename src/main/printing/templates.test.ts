import { describe, expect, it } from 'vitest'
import type {
  Bill,
  LedgerLine,
  NikasiDetail,
  TrialBalance,
  VoucherDetail
} from '../../shared/contracts'
import { billHtml, gatePassHtml, ledgerHtml, trialBalanceHtml, voucherHtml } from './templates'

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
      voucherNo: 7,
      lines: [
        {
          aamadId: 11,
          lotNo: '7/345',
          fromKisanAccountId: 3,
          fromKisanName: 'Ramesh',
          packets: 80,
          weightKg: 4000,
          ratePaise: 40000,
          amountPaise: 3200000
        }
      ]
    }
    const html = gatePassHtml(n)
    expect(html).toContain('Gate Pass / गेट पास')
    expect(html).toContain('#42')
    expect(html).toContain('Gopal')
    expect(html).toContain('7/345')
    expect(html).toContain('₹32,000.00') // line amount = total
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true)
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
              mode: ''
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
        mode: 'Cash'
      }
    ]
    const html = ledgerHtml('Suresh Vyapari', lines)
    expect(html).toContain('Ledger Statement / खाता विवरण')
    expect(html).toContain('Suresh Vyapari')
    expect(html).toContain('Closing balance / अंतिम शेष')
    expect(html).toContain('₹1,00,000.00 Dr')
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
