import { readFileSync } from 'fs'
import { join } from 'path'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, db, rawSqlite } from '../data/db'
import { cheque } from '../data/schema'
import { getSystemAccountId, SYSTEM_ACCOUNTS } from '../data/seed'
import { makeAccount, makeYear, setupDb } from '../test-utils'
import { getAccountBalance, getAccountLedger, getTrialBalance } from '../services/ledger'
import { getSummary } from '../services/moneybook'
import { listCheques } from '../services/cheques'
import { createLoan, getLoan, listLoans, recordPayment } from '../services/loans'
import { bounceCheque, clearCheque, recordCheque } from './cheque-clearing'

let yearId: number
let vyapari: number
let bank: number
let clearing: number

const SUM = 5000000 // ₹50,000

beforeEach(() => {
  setupDb()
  yearId = makeYear(2026)
  vyapari = makeAccount('Mohan Vyapari', 'vyapari', 'Sundry Debtors')
  bank = makeAccount('HDFC Bank', 'bank', 'Cash and Bank')
  clearing = getSystemAccountId(SYSTEM_ACCOUNTS.CHEQUES_IN_CLEARING)
})
afterEach(() => closeDb())

describe('Cheque-clearing engine', () => {
  it('a received cheque sits in clearing (not the bank) until its clearance date', () => {
    const { chequeId } = recordCheque(yearId, {
      direction: 'received',
      partyAccountId: vyapari,
      bankAccountId: bank,
      amountPaise: SUM,
      no: 'C-1'
    })
    // Pending: the party's debt is settled, the money is in clearing, the bank is untouched.
    expect(getAccountBalance(vyapari, yearId)).toBe(-SUM) // Cr — no longer owes
    expect(getAccountBalance(clearing, yearId)).toBe(SUM) // Dr — held in clearing
    expect(getSummary(bank, yearId).closingPaise).toBe(0) // NOT in the bank book
    expect(getTrialBalance(yearId).balanced).toBe(true)

    // Clear: now it moves into the bank (and the Money Book), clearing nets to zero.
    clearCheque(chequeId, '2026-02-10')
    expect(getSummary(bank, yearId).closingPaise).toBe(SUM)
    expect(getAccountBalance(clearing, yearId)).toBe(0)
    expect(listCheques(yearId, 'cleared')).toHaveLength(1)
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })

  it('drops the "(in clearing)" note from the entry narration once cleared', () => {
    const { chequeId } = recordCheque(yearId, {
      direction: 'given',
      partyAccountId: vyapari,
      bankAccountId: bank,
      amountPaise: SUM,
      no: 'C-9'
    })
    expect(getAccountLedger(vyapari, yearId)[0].narration).toBe('Cheque C-9 given (in clearing)')
    clearCheque(chequeId, '2026-02-10')
    expect(getAccountLedger(vyapari, yearId)[0].narration).toBe('Cheque C-9 given')
  })

  it('a bounce reverses cleanly — the party owes again and no bank money moved', () => {
    const { chequeId } = recordCheque(yearId, {
      direction: 'received',
      partyAccountId: vyapari,
      bankAccountId: bank,
      amountPaise: SUM,
      no: 'C-2'
    })
    bounceCheque(chequeId, '2026-02-15')
    expect(getAccountBalance(vyapari, yearId)).toBe(0) // back to owing what he did before
    expect(getAccountBalance(clearing, yearId)).toBe(0) // clearing emptied
    expect(getSummary(bank, yearId).closingPaise).toBe(0) // bank never moved
    expect(listCheques(yearId, 'bounced')).toHaveLength(1)
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })

  it('a given cheque hits the bank only on clearance (money out)', () => {
    const { chequeId } = recordCheque(yearId, {
      direction: 'given',
      partyAccountId: vyapari,
      bankAccountId: bank,
      amountPaise: 3000000,
      no: 'G-1'
    })
    expect(getSummary(bank, yearId).closingPaise).toBe(0) // pending — bank untouched
    clearCheque(chequeId, '2026-03-01')
    expect(getSummary(bank, yearId).closingPaise).toBe(-3000000) // ₹30,000 paid out of the bank
    expect(getAccountBalance(clearing, yearId)).toBe(0)
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })

  it('refuses a bank account that is not one of the cold\'s own money accounts', () => {
    expect(() =>
      recordCheque(yearId, {
        direction: 'received',
        partyAccountId: vyapari,
        bankAccountId: vyapari, // a party, not a Cash-and-Bank account
        amountPaise: SUM,
        no: 'C-X'
      })
    ).toThrow(/Cash and Bank/)
  })

  it('refuses to clear or bounce a cheque that is not pending', () => {
    const { chequeId } = recordCheque(yearId, {
      direction: 'received',
      partyAccountId: vyapari,
      bankAccountId: bank,
      amountPaise: SUM,
      no: 'C-3'
    })
    clearCheque(chequeId, '2026-02-10')
    expect(() => clearCheque(chequeId, '2026-02-11')).toThrow()
    expect(() => bounceCheque(chequeId, '2026-02-11')).toThrow()
  })
})

describe('Loans disbursed/repaid by cheque', () => {
  const chequeLoan = (): { loanId: number; chequeId: number } => {
    const r = createLoan(yearId, {
      category: 'vyapari',
      accountId: vyapari,
      date: '2026-02-01',
      amountPaise: SUM,
      mode: 'cheque',
      bankAccountId: bank,
      chequeNo: 'L-1',
      nature: 'direct'
    })
    return { loanId: r.loanId, chequeId: r.chequeId! }
  }

  it('a cheque loan registers a pending given cheque and stays out of the bank book', () => {
    chequeLoan()
    const pending = listCheques(yearId, 'pending')
    expect(pending).toHaveLength(1)
    expect(pending[0].direction).toBe('given')
    expect(getAccountBalance(vyapari, yearId)).toBe(SUM) // party owes the loan
    expect(getAccountBalance(clearing, yearId)).toBe(-SUM) // committed, not yet out of the bank
    expect(getSummary(bank, yearId).closingPaise).toBe(0)
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })

  it('clearing moves the money out of the bank and starts interest from the clearance date', () => {
    const { loanId, chequeId } = chequeLoan()
    clearCheque(chequeId, '2026-03-01')
    expect(getSummary(bank, yearId).closingPaise).toBe(-SUM)
    expect(getAccountBalance(clearing, yearId)).toBe(0)
    const d = getLoan(loanId)!
    expect(d.interestStartDate).toBe('2026-03-01')
    // No interest before clearance; a month later exactly 1.5% has accrued.
    expect(getLoan(loanId, '2026-03-01')!.outstandingPaise).toBe(SUM)
    expect(getLoan(loanId, '2026-04-01')!.outstandingPaise).toBe(SUM + SUM * 0.015)
  })

  it('a bounced disbursement cheque undoes the loan entirely', () => {
    const { chequeId } = chequeLoan()
    bounceCheque(chequeId, '2026-02-15')
    expect(listLoans(yearId)).toHaveLength(0) // the loan never happened
    expect(getAccountBalance(vyapari, yearId)).toBe(0)
    expect(getAccountBalance(clearing, yearId)).toBe(0)
    expect(getSummary(bank, yearId).closingPaise).toBe(0)
    expect(listCheques(yearId, 'bounced')).toHaveLength(1)
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })

  it('a repayment by cheque is a pending received cheque; bouncing it restores the debt', () => {
    const { loanId } = createLoan(yearId, {
      category: 'vyapari',
      accountId: vyapari,
      date: '2026-02-01',
      amountPaise: SUM,
      mode: 'cash',
      nature: 'direct'
    })
    recordPayment(loanId, SUM, '2026-02-01', 'cheque', bank, undefined, { no: 'R-1' })
    expect(listCheques(yearId, 'pending')).toHaveLength(1)
    expect(getLoan(loanId, '2026-02-01')!.outstandingPaise).toBe(0) // settled, pending clearance
    expect(getAccountBalance(vyapari, yearId)).toBe(0)

    const rc = listCheques(yearId, 'pending')[0]
    bounceCheque(rc.id, '2026-02-10')
    expect(getLoan(loanId, '2026-02-01')!.outstandingPaise).toBe(SUM) // owes again
    expect(getAccountBalance(vyapari, yearId)).toBe(SUM)
    expect(getAccountBalance(clearing, yearId)).toBe(0)
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })
})

describe('0018 backfill migration', () => {
  it('strips "(in clearing)" from cheques that were cleared before the fix', () => {
    // Simulate a pre-fix cleared cheque: record it (stale "(in clearing)" narration), then flip
    // status to cleared *without* clearCheque so the narration stays stale.
    const { chequeId } = recordCheque(yearId, {
      direction: 'given',
      partyAccountId: vyapari,
      bankAccountId: bank,
      amountPaise: SUM,
      no: 'OLD-1'
    })
    db().update(cheque).set({ status: 'cleared' }).where(eq(cheque.id, chequeId)).run()
    expect(getAccountLedger(vyapari, yearId)[0].narration).toBe('Cheque OLD-1 given (in clearing)')

    rawSqlite().exec(readFileSync(join(process.cwd(), 'drizzle/0018_backfill_cheque_clearing_narration.sql'), 'utf8'))
    expect(getAccountLedger(vyapari, yearId)[0].narration).toBe('Cheque OLD-1 given')
  })
})
