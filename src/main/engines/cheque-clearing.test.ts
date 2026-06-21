import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb } from '../data/db'
import { getSystemAccountId, SYSTEM_ACCOUNTS } from '../data/seed'
import { makeAccount, makeYear, setupDb } from '../test-utils'
import { getAccountBalance, getTrialBalance } from '../services/ledger'
import { getSummary } from '../services/moneybook'
import { listCheques } from '../services/cheques'
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
  bank = makeAccount('HDFC Bank', 'other', 'Cash and Bank')
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
