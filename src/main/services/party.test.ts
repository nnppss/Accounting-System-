import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { closeDb, db } from '../data/db'
import { account } from '../data/schema'
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
    // ₹12,000 opening Dr + auto-accrued rent (400 packets × ₹10/packet = ₹4,000) = ₹16,000.
    expect(res.rows[0].balancePaise).toBe(1600000)
  })

  it('numeric ops: between (balance) and eq (packets) AND with type', () => {
    // Balances include auto-accrued rent (₹10/packet): A ₹12k+₹4k=₹16k, B ₹20k+₹8k=₹28k,
    // C ₹5k+₹2k=₹7k. Window ₹4,000–₹20,000 → Kisan A + Kisan C; B (₹28k) excluded.
    const between = searchParty(yearId, {
      type: 'kisan',
      balance: { op: 'between', value: 400000, value2: 2000000 }
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

  it('"We owe" (Cr balance) matches on magnitude, not signed value', () => {
    // A vyapari we owe ₹40,000 (opening Cr) — balance is negative.
    const owed = makeAccount('Owed V', 'vyapari', 'Sundry Debtors')
    setOpeningBalance(owed, yearId, 4000000, 'cr', '2026-01-01')

    // ≥ ₹30,000 on the "we owe" side must include it (was excluded when comparing the -₹40k signed).
    const gte = searchParty(yearId, { owes: 'them', balance: { op: 'gte', value: 3000000 } })
    expect(gte.rows.map((r) => r.accountId)).toEqual([owed])

    // ≤ ₹30,000 must exclude it (was wrongly included when -₹40k ≤ ₹30k).
    const lte = searchParty(yearId, { owes: 'them', balance: { op: 'lte', value: 3000000 } })
    expect(lte.rows.map((r) => r.accountId)).not.toContain(owed)
  })

  it('sanity: identity/categorical/set filters each isolate the right parties', () => {
    // A kisan with an attached person (village + phone), a defaulter, and a party we owe.
    const pid = createPerson({ name: 'Ram', villageCity: 'Testville', phone: '9998887776' })
    const kv = createAccount({ name: 'Kisan V', type: 'kisan', subgroupId: groupId('Farmer'), personId: pid })
    const def = makeAccount('Def K', 'kisan', 'Farmer')
    db().update(account).set({ isDefaulter: true }).where(eq(account.id, def)).run()
    const owed = makeAccount('Owed V', 'vyapari', 'Sundry Debtors')
    setOpeningBalance(owed, yearId, 4000000, 'cr', '2026-01-01') // Cr = we owe ₹40,000

    // type
    expect(searchParty(yearId, { type: 'vyapari' }).rows.map((r) => r.name).sort()).toEqual([
      'Owed V',
      'Vyapari V'
    ])
    // name — case-insensitive substring
    expect(searchParty(yearId, { name: 'kisan v' }).rows.map((r) => r.accountId)).toEqual([kv])
    // village — case-insensitive substring
    expect(searchParty(yearId, { village: 'testv' }).rows.map((r) => r.accountId)).toEqual([kv])
    // phone — substring
    expect(searchParty(yearId, { phone: '888' }).rows.map((r) => r.accountId)).toEqual([kv])
    // defaulter yes / no
    expect(searchParty(yearId, { defaulter: true }).rows.map((r) => r.accountId)).toEqual([def])
    expect(searchParty(yearId, { defaulter: false }).rows.some((r) => r.accountId === def)).toBe(false)
    // owes: them (Cr) is only the party we owe; us (Dr) never includes it
    expect(searchParty(yearId, { owes: 'them' }).rows.map((r) => r.accountId)).toEqual([owed])
    expect(searchParty(yearId, { owes: 'us' }).rows.map((r) => r.accountId)).not.toContain(owed)
    // hasActivity — a freshly-created account with no postings is excluded
    expect(searchParty(yearId, { hasActivity: true }).rows.map((r) => r.accountId)).not.toContain(kv)
  })

  it('sanity: numeric metrics + combinations narrow correctly', () => {
    // Standing bhada (₹10/packet): A ₹4k, B ₹8k, C ₹2k.
    expect(
      searchParty(yearId, { standingBhada: { op: 'gte', value: 300000 } }).rows.map((r) => r.accountId).sort()
    ).toEqual([kisanA, kisanB].sort())
    // Current stock (no nikasi yet = packets brought): C=200 is the only one in 100–300.
    expect(
      searchParty(yearId, { currentStock: { op: 'between', value: 100, value2: 300 } }).rows.map((r) => r.accountId)
    ).toEqual([kisanC])
    // No sales recorded → packetsSold ≥ 1 finds nobody.
    expect(searchParty(yearId, { packetsSold: { op: 'gte', value: 1 } }).rows).toEqual([])
    // Combo: kisan AND we're-owed AND |balance| ≥ ₹20k → B (₹28k); A ₹16k & C ₹7k excluded.
    expect(
      searchParty(yearId, { type: 'kisan', owes: 'us', balance: { op: 'gte', value: 2000000 } }).rows.map(
        (r) => r.accountId
      )
    ).toEqual([kisanB])
    // Combo: kisan AND ≤500 brought AND bhada ≥ ₹3k → A only (B too many packets, C too little bhada).
    expect(
      searchParty(yearId, {
        type: 'kisan',
        packetsBrought: { op: 'lte', value: 500 },
        standingBhada: { op: 'gte', value: 300000 }
      }).rows.map((r) => r.accountId)
    ).toEqual([kisanA])
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
