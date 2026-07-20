import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb } from '../data/db'
import { makeAccount, makeYear, setupDb } from '../test-utils'
import { createAamad } from './aamad'
import { createNikasi } from './nikasi'
import { createSauda, deleteSauda, listSauda, rateForLifting, settleSauda, unsettleSauda } from './sauda'
import { getAccountBalance, getTrialBalance } from './ledger'

let yearId: number
let kisan: number
let vyapari: number
let lot: number

/** Deliver `packets` of the lot to the vyapari at `ratePaise`, weighing 50 kg a packet. */
function lift(packets: number, ratePaise: number, date = '2026-05-01'): void {
  createNikasi(yearId, {
    date,
    deliveredToType: 'vyapari',
    deliveredToAccountId: vyapari,
    lines: [{ aamadId: lot, packets, weightKg: packets * 50, ratePaise }]
  })
}

beforeEach(() => {
  setupDb()
  yearId = makeYear(2026)
  kisan = makeAccount('Ramesh Kisan', 'kisan', 'Farmer')
  vyapari = makeAccount('Mohan Vyapari', 'vyapari', 'Sundry Debtors')
  lot = createAamad(yearId, {
    date: '2026-02-10',
    kisanAccountId: kisan,
    totalPackets: 200,
    locations: [{ room: 1, floor: 1, rack: 1, packets: 200 }]
  })
})
afterEach(() => closeDb())

describe('Sauda shortfall', () => {
  it('prices the packets he never lifted off the ones he did', () => {
    // Promised 100 @ ₹900 per 105kg, lifted 78 (3900 kg → ₹33,428.57).
    createSauda(yearId, { date: '2026-04-01', vyapariAccountId: vyapari, kisanAccountId: kisan, packets: 100, ratePaise: 90000 })
    lift(78, 90000)

    const [deal] = listSauda(yearId)
    expect(deal.liftedPackets).toBe(78)
    expect(deal.shortfallPackets).toBe(22)
    // 78 pkt earned ₹33,428.57 → ₹428.57/pkt → 22 pkt ≈ ₹9,428.57.
    expect(deal.suggestedShortfallPaise).toBe(Math.round((3342857 / 78) * 22))
    expect(deal.settlementVoucherId).toBeNull()
  })

  it('settling charges the vyapari and pays the kisan, leaving the books balanced', () => {
    createSauda(yearId, { date: '2026-04-01', vyapariAccountId: vyapari, kisanAccountId: kisan, packets: 100, ratePaise: 90000 })
    lift(78, 90000)
    const before = { vyapari: getAccountBalance(vyapari, yearId), kisan: getAccountBalance(kisan, yearId) }

    const { amountPaise } = settleSauda(yearId, listSauda(yearId)[0].id, { date: '2026-12-31', amountPaise: 942857 })
    expect(amountPaise).toBe(942857)

    // The vyapari owes 22 packets more (Dr); the kisan is owed them (Cr) — as if he had lifted all 100.
    expect(getAccountBalance(vyapari, yearId)).toBe(before.vyapari + 942857)
    expect(getAccountBalance(kisan, yearId)).toBe(before.kisan - 942857)
    expect(getTrialBalance(yearId).balanced).toBe(true)

    const [deal] = listSauda(yearId)
    expect(deal.settlementVoucherId).not.toBeNull()
    expect(deal.settlementPaise).toBe(942857)
  })

  it('refuses to settle a deal that was fully lifted, or to settle one twice', () => {
    createSauda(yearId, { date: '2026-04-01', vyapariAccountId: vyapari, kisanAccountId: kisan, packets: 50, ratePaise: 90000 })
    lift(50, 90000)
    const id = listSauda(yearId)[0].id
    expect(() => settleSauda(yearId, id, { date: '2026-12-31', amountPaise: 100 })).toThrow(/lifted every packet/)

    createSauda(yearId, { date: '2026-04-02', vyapariAccountId: vyapari, kisanAccountId: kisan, packets: 40, ratePaise: 80000 })
    const short = listSauda(yearId).find((s) => s.ratePaise === 80000)!
    settleSauda(yearId, short.id, { date: '2026-12-31', amountPaise: 500000 })
    expect(() => settleSauda(yearId, short.id, { date: '2026-12-31', amountPaise: 500000 })).toThrow(/already settled/)
  })

  it('undoing a settlement reverses it out of both balances', () => {
    createSauda(yearId, { date: '2026-04-01', vyapariAccountId: vyapari, kisanAccountId: kisan, packets: 100, ratePaise: 90000 })
    lift(78, 90000)
    const before = getAccountBalance(vyapari, yearId)
    const id = listSauda(yearId)[0].id

    settleSauda(yearId, id, { date: '2026-12-31', amountPaise: 942857 })
    unsettleSauda(yearId, id)

    expect(getAccountBalance(vyapari, yearId)).toBe(before)
    expect(listSauda(yearId)[0].settlementVoucherId).toBeNull()
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })

  it('deleting a settled deal voids its charge', () => {
    createSauda(yearId, { date: '2026-04-01', vyapariAccountId: vyapari, kisanAccountId: kisan, packets: 100, ratePaise: 90000 })
    lift(78, 90000)
    const before = getAccountBalance(vyapari, yearId)
    const id = listSauda(yearId)[0].id
    settleSauda(yearId, id, { date: '2026-12-31', amountPaise: 942857 })

    deleteSauda(yearId, id)
    expect(getAccountBalance(vyapari, yearId)).toBe(before)
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })

  it('fills same-rate deals with one kisan oldest-first', () => {
    createSauda(yearId, { date: '2026-04-01', vyapariAccountId: vyapari, kisanAccountId: kisan, packets: 60, ratePaise: 90000 })
    createSauda(yearId, { date: '2026-04-20', vyapariAccountId: vyapari, kisanAccountId: kisan, packets: 60, ratePaise: 90000 })
    lift(80, 90000)

    const byDate = listSauda(yearId).sort((a, b) => a.date.localeCompare(b.date))
    expect(byDate[0].shortfallPackets).toBe(0) // older deal delivered in full
    expect(byDate[1].liftedPackets).toBe(20)
    expect(byDate[1].shortfallPackets).toBe(40)
  })

  it('keeps two deals at different rates apart', () => {
    createSauda(yearId, { date: '2026-04-01', vyapariAccountId: vyapari, kisanAccountId: kisan, packets: 50, ratePaise: 90000 })
    createSauda(yearId, { date: '2026-04-02', vyapariAccountId: vyapari, kisanAccountId: kisan, packets: 50, ratePaise: 80000 })
    lift(50, 90000) // the ₹900 deal delivered; the ₹800 one untouched
    lift(30, 80000)

    const at900 = listSauda(yearId).find((s) => s.ratePaise === 90000)!
    const at800 = listSauda(yearId).find((s) => s.ratePaise === 80000)!
    expect(at900.shortfallPackets).toBe(0)
    expect(at800.liftedPackets).toBe(30)
    expect(at800.shortfallPackets).toBe(20)
    // Priced off the ₹800 packets he took, not the ₹900 ones.
    expect(at800.suggestedShortfallPaise).toBe(Math.round((Math.round((1500 * 80000) / 105) / 30) * 20))
  })

  it('has no price to suggest when he lifted nothing at all', () => {
    createSauda(yearId, { date: '2026-04-01', vyapariAccountId: vyapari, kisanAccountId: kisan, packets: 100, ratePaise: 90000 })
    const [deal] = listSauda(yearId)
    expect(deal.shortfallPackets).toBe(100)
    expect(deal.suggestedShortfallPaise).toBeNull()
    // The accountant can still settle it at an agreed number.
    expect(settleSauda(yearId, deal.id, { date: '2026-12-31', amountPaise: 4000000 }).amountPaise).toBe(4000000)
  })

  it('prefills the rate of the deal the packets will settle against, not the newest', () => {
    // March deal at ₹900 still open; May deal at ₹950 already lifted in full. The next truck is
    // filling the March deal, so it must bill at ₹900 — ₹950 would strand both deals short.
    createSauda(yearId, { date: '2026-03-01', vyapariAccountId: vyapari, kisanAccountId: kisan, packets: 60, ratePaise: 90000 })
    createSauda(yearId, { date: '2026-05-01', vyapariAccountId: vyapari, kisanAccountId: kisan, packets: 40, ratePaise: 95000 })
    lift(40, 95000)

    expect(rateForLifting(yearId, vyapari, kisan)).toBe(90000)

    // Bill at it and the March deal fills; neither deal is left with a phantom shortfall.
    lift(60, 90000)
    expect(listSauda(yearId).every((s) => s.shortfallPackets === 0)).toBe(true)
  })

  it('falls back to the latest rate once every deal of the pair is filled', () => {
    createSauda(yearId, { date: '2026-03-01', vyapariAccountId: vyapari, kisanAccountId: kisan, packets: 20, ratePaise: 90000 })
    createSauda(yearId, { date: '2026-05-01', vyapariAccountId: vyapari, kisanAccountId: kisan, packets: 20, ratePaise: 95000 })
    lift(20, 90000)
    lift(20, 95000)
    expect(rateForLifting(yearId, vyapari, kisan)).toBe(95000)
  })

  it('has no rate to prefill for a pair that never dealt', () => {
    expect(rateForLifting(yearId, vyapari, kisan)).toBeNull()
  })

  it('a self-withdrawal does not count as the vyapari lifting his deal', () => {
    createSauda(yearId, { date: '2026-04-01', vyapariAccountId: vyapari, kisanAccountId: kisan, packets: 100, ratePaise: 90000 })
    createNikasi(yearId, {
      date: '2026-05-01',
      deliveredToType: 'kisan',
      deliveredToAccountId: kisan,
      lines: [{ aamadId: lot, packets: 100, ratePaise: 90000 }]
    })
    expect(listSauda(yearId)[0].shortfallPackets).toBe(100)
  })
})
