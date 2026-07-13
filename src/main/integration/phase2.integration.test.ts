import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb } from '../data/db'
import { getSystemAccountId, SYSTEM_ACCOUNTS } from '../data/seed'
import { makeAccount, makeYear, setupDb } from '../test-utils'
import { createAamad } from '../services/aamad'
import { createSauda, latestRate } from '../services/sauda'
import { createNikasi } from '../services/nikasi'
import { accrueRent, getStandingBhada } from '../engines/bhada'
import { createPayment, createReceipt } from '../services/vouchers'
import { getAccountBalance, getTrialBalance } from '../services/ledger'
import { getMap } from '../services/maps'
import { getSummary } from '../services/moneybook'

/**
 * Phase 2 capstone — the worked settlement example end-to-end:
 *   kisan stores → deal (sauda) → full-year rent → nikasi sale → cash settlement.
 * Confirms the three maps, the ledger entries, standing bhada, and the money book all agree.
 */
describe('Phase 2 done/verify — worked settlement', () => {
  beforeEach(() => setupDb())
  afterEach(() => closeDb())

  it('runs intake → deal → rent → nikasi → settlement and ties everything', () => {
    const RENT = 1500 // ₹15.00 / packet / year
    const RATE = 50000 // ₹500.00 / packet sale rate
    const yearId = makeYear(2026, RENT)
    const kisan = makeAccount('Ramesh Kisan', 'kisan', 'Farmer')
    const vyapari = makeAccount('Mohan Vyapari', 'vyapari', 'Sundry Debtors')
    const cash = getSystemAccountId(SYSTEM_ACCOUNTS.CASH)

    // 1) Kisan stores 200 packets across two racks.
    const lot = createAamad(yearId, {
      date: '2026-02-10',
      kisanAccountId: kisan,
      totalPackets: 200,
      locations: [
        { room: 1, floor: 1, rack: 1, packets: 120 },
        { room: 1, floor: 1, rack: 2, packets: 80 }
      ]
    })

    // 2) Deal: vyapari agrees ₹500/packet with the kisan; the rate flows to the nikasi.
    createSauda(yearId, { date: '2026-04-01', vyapariAccountId: vyapari, kisanAccountId: kisan, packets: 150, ratePaise: RATE })
    expect(latestRate(yearId, vyapari, kisan)).toBe(RATE)

    // 3) Full-year rent accrued: 200 × ₹15 = ₹3,000 Dr Kisan / Cr Rent Income.
    accrueRent(kisan, yearId, '2026-12-31')
    expect(getAccountBalance(kisan, yearId)).toBe(200 * RENT) // ₹3,000 Dr so far
    expect(getStandingBhada(kisan, yearId).standingPaise).toBe(200 * RENT)

    // 4) Nikasi sale: vyapari buys 150 packets from the lot (drained rack1 120 + rack2 30).
    const proceeds = 150 * RATE // ₹75,000
    const res = createNikasi(yearId, {
      date: '2026-05-15',
      deliveredToType: 'vyapari',
      deliveredToAccountId: vyapari,
      vehicleNo: 'UP14 AB 1234',
      receivedBy: 'Mohan',
      // Rate is per 105 kg; 150 × 105 kg keeps proceeds = 150 × RATE.
      lines: [{ aamadId: lot, packets: 150, weightKg: 150 * 105, ratePaise: RATE }]
    })
    expect(res.voucherId).not.toBeNull()

    // Maps: current = aamad − nikasi = 200 − 150 = 50.
    expect(getMap(yearId, 'aamad').totalPackets).toBe(200)
    expect(getMap(yearId, 'nikasi').totalPackets).toBe(150)
    expect(getMap(yearId, 'current').totalPackets).toBe(50)

    // Ledger after the sale: vyapari owes ₹75,000; kisan net = rent − proceeds (rent recovered).
    expect(getAccountBalance(vyapari, yearId)).toBe(proceeds)
    expect(getAccountBalance(kisan, yearId)).toBe(200 * RENT - proceeds) // ₹3,000 − ₹75,000 = −₹72,000
    expect(getTrialBalance(yearId).balanced).toBe(true)

    // 5) Settlement: vyapari pays the cold ₹75,000 cash; the cold pays the kisan his net ₹72,000.
    createReceipt({ yearId, date: '2026-05-20', partyAccountId: vyapari, cashBankAccountId: cash, amountPaise: proceeds })
    createPayment({ yearId, date: '2026-05-21', partyAccountId: kisan, cashBankAccountId: cash, amountPaise: proceeds - 200 * RENT })

    // Both parties settle to zero; the cold keeps the ₹3,000 rent as cash.
    expect(getAccountBalance(vyapari, yearId)).toBe(0)
    expect(getAccountBalance(kisan, yearId)).toBe(0)
    expect(getSummary(cash, yearId).closingPaise).toBe(200 * RENT) // ₹3,000 retained = rent earned
    expect(getTrialBalance(yearId).balanced).toBe(true)
  })
})
