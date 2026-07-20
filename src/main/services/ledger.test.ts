import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb } from '../data/db'
import { makeAccount, makeYear, setupDb } from '../test-utils'
import { post } from './posting'
import { getAccountBalance, getAccountLedger, getTrialBalance } from './ledger'

let yearId: number
let kisan: number
let cash: number
let rent: number

beforeEach(() => {
  setupDb()
  yearId = makeYear(2026)
  kisan = makeAccount('Ramesh Kisan', 'kisan', 'Farmer')
  cash = makeAccount('Cash Drawer', 'bank', 'Cash and Bank')
  rent = makeAccount('Rent Income', 'other', 'Revenue Account')
})
afterEach(() => closeDb())

describe('Trial Balance', () => {
  it('ties (Σdr = Σcr) after balanced posts', () => {
    // bhada charged: Dr Kisan / Cr Rent Income
    post({
      yearId,
      type: 'journal',
      date: '2026-01-15',
      entries: [
        { accountId: kisan, drPaise: 50000, crPaise: 0, tag: 'rent' },
        { accountId: rent, drPaise: 0, crPaise: 50000, tag: 'rent' }
      ]
    })
    // kisan pays 30000 cash: Dr Cash / Cr Kisan
    post({
      yearId,
      type: 'receipt',
      date: '2026-02-01',
      entries: [
        { accountId: cash, drPaise: 30000, crPaise: 0 },
        { accountId: kisan, drPaise: 0, crPaise: 30000 }
      ]
    })

    const tb = getTrialBalance(yearId)
    expect(tb.balanced).toBe(true)
    expect(tb.totalDr).toBe(tb.totalCr)
    expect(tb.totalDr).toBe(50000) // Cash 30000 Dr + Kisan 20000 Dr = 50000; Rent 50000 Cr
  })

  it('omits accounts that net to zero', () => {
    post({
      yearId,
      type: 'journal',
      date: '2026-01-15',
      entries: [
        { accountId: kisan, drPaise: 10000, crPaise: 0 },
        { accountId: rent, drPaise: 0, crPaise: 10000 }
      ]
    })
    post({
      yearId,
      type: 'receipt',
      date: '2026-01-16',
      entries: [
        { accountId: cash, drPaise: 10000, crPaise: 0 },
        { accountId: kisan, drPaise: 0, crPaise: 10000 } // kisan now nets to zero
      ]
    })
    const tb = getTrialBalance(yearId)
    expect(tb.rows.find((r) => r.accountId === kisan)).toBeUndefined()
    expect(tb.balanced).toBe(true)
  })
})

describe('account ledger', () => {
  it('keeps a correct running balance, newest first', () => {
    post({
      yearId,
      type: 'journal',
      date: '2026-01-15',
      entries: [
        { accountId: kisan, drPaise: 50000, crPaise: 0, tag: 'rent' },
        { accountId: rent, drPaise: 0, crPaise: 50000, tag: 'rent' }
      ]
    })
    post({
      yearId,
      type: 'receipt',
      date: '2026-02-01',
      entries: [
        { accountId: cash, drPaise: 30000, crPaise: 0 },
        { accountId: kisan, drPaise: 0, crPaise: 30000 }
      ]
    })
    const lines = getAccountLedger(kisan, yearId)
    expect(lines).toHaveLength(2)
    // Newest-first: the Feb receipt row (balance 20000) leads, the Jan rent row (50000) follows.
    expect(lines[0].balancePaise).toBe(20000)
    expect(lines[1].balancePaise).toBe(50000)
    expect(getAccountBalance(kisan, yearId)).toBe(20000)
  })
})
