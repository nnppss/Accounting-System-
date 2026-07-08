import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb } from '../data/db'
import { groupId, makeAccount, makeYear, setupDb } from '../test-utils'
import { createAccount, createPerson, setOpeningBalance } from './accounts'
import { createAamad } from './aamad'
import { createLoan } from './loans'
import {
  deleteSavedFilter,
  listSavedFilters,
  saveFilter,
  searchParty
} from './party'

let yearId: number
let kisanA: number
let kisanB: number
let kisanC: number
let vyapari: number

beforeEach(() => {
  setupDb()
  yearId = makeYear(2026, 1000)

  // Three kisans: (packets brought, balance they owe us via an opening Dr).
  kisanA = makeAccount('Kisan A', 'kisan', 'Farmer')
  kisanB = makeAccount('Kisan B', 'kisan', 'Farmer')
  kisanC = makeAccount('Kisan C', 'kisan', 'Farmer')
  vyapari = makeAccount('Vyapari V', 'vyapari', 'Sundry Debtors')

  bring(kisanA, 400)
  bring(kisanB, 800)
  bring(kisanC, 200)
  owe(kisanA, 1200000) // ₹12,000
  owe(kisanB, 2000000) // ₹20,000
  owe(kisanC, 500000) // ₹5,000

  // A direct loan to the vyapari (₹50,000 on 1 Jun) — live interest accrues.
  createLoan(yearId, {
    category: 'vyapari',
    accountId: vyapari,
    date: '2026-06-01',
    amountPaise: 5000000,
    mode: 'cash',
    nature: 'direct'
  })
})
afterEach(() => closeDb())

let aamadSeq = 0
function bring(kisanAccountId: number, packets: number): void {
  aamadSeq++
  createAamad(yearId, {
    date: '2026-01-15',
    kisanAccountId,
    totalPackets: packets,
    locations: [{ room: 1, floor: 1, rack: aamadSeq, packets }]
  })
}
function owe(accountId: number, amountPaise: number): void {
  setOpeningBalance(accountId, yearId, amountPaise, 'dr', '2026-01-01')
}

describe('Party search (software.md §3.12)', () => {
  it('the example: kisans who brought ≤ 500 packets and still owe > ₹10,000', () => {
    const res = searchParty(
      yearId,
      {
        type: 'kisan',
        packetsBrought: { op: 'lte', value: 500 },
        owes: 'us',
        balance: { op: 'gte', value: 1000001 }
      },
      '2026-07-01'
    )
    expect(res.rows.map((r) => r.accountId)).toEqual([kisanA])
    expect(res.count).toBe(1)
    expect(res.rows[0].packetsBrought).toBe(400)
    expect(res.rows[0].balancePaise).toBe(1200000)
  })

  it('numeric ops: between (balance) and eq (packets) AND with type', () => {
    // Balance between ₹4,000 and ₹15,000 → Kisan A (₹12k) + Kisan C (₹5k); B (₹20k) excluded.
    const between = searchParty(yearId, {
      type: 'kisan',
      balance: { op: 'between', value: 400000, value2: 1500000 }
    })
    expect(between.rows.map((r) => r.accountId).sort()).toEqual([kisanA, kisanC].sort())

    // Exactly 800 packets → Kisan B.
    const eq = searchParty(yearId, { packetsBrought: { op: 'eq', value: 800 } })
    expect(eq.rows.map((r) => r.accountId)).toEqual([kisanB])
  })

  it('loan filters: hasLoan, category, outstanding (live engine figure)', () => {
    const has = searchParty(yearId, { hasLoan: true }, '2026-07-01')
    expect(has.rows.map((r) => r.accountId)).toEqual([vyapari])
    // ₹50,000 + 1 month simple interest (₹750) = ₹50,750 live.
    expect(has.rows[0].loanOutstandingPaise).toBe(5075000)

    const byCat = searchParty(yearId, { loanCategory: 'vyapari' }, '2026-07-01')
    expect(byCat.rows.map((r) => r.accountId)).toEqual([vyapari])

    const byAmount = searchParty(yearId, { loanOutstanding: { op: 'gte', value: 5000000 } }, '2026-07-01')
    expect(byAmount.rows.map((r) => r.accountId)).toEqual([vyapari])
  })

  it('multi-role finds people who hold more than one role-account', () => {
    const personId = createPerson({ name: 'Shyam' })
    const k = createAccount({ name: 'Shyam K', type: 'kisan', subgroupId: groupId('Farmer'), personId })
    createAccount({ name: 'Shyam V', type: 'vyapari', subgroupId: groupId('Sundry Debtors'), personId })
    const res = searchParty(yearId, { multiRole: true })
    expect(res.rows.every((r) => r.personId === personId)).toBe(true)
    expect(res.rows.some((r) => r.accountId === k)).toBe(true)
    expect(res.count).toBe(2)
  })

  it('saved presets persist, list, and delete', () => {
    const criteria = { type: 'kisan' as const, packetsBrought: { op: 'lte' as const, value: 500 } }
    const id = saveFilter('party', 'Small kisans', criteria)
    const list = listSavedFilters('party')
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('Small kisans')
    expect(list[0].criteria).toEqual(criteria)
    deleteSavedFilter(id)
    expect(listSavedFilters('party')).toHaveLength(0)
  })
})
