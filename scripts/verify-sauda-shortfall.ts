/**
 * Drive the sauda-shortfall feature end-to-end against a COPY of the real DB (never the original).
 * Applies the new migration to real data, then plays out the cold's actual scenario: a vyapari who
 * agreed to 100 packets, lifted 78, and gets charged for the 22 he left behind.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/verify-sauda-shortfall.cjs
 */
import { homedir } from 'os'
import { join } from 'path'
import { copyFileSync, existsSync, rmSync } from 'fs'
import { eq, and } from 'drizzle-orm'
import { openDb, db, closeDb, migrate } from '../src/main/data/db'
import { financialYear, account, aamad as aamadT } from '../src/main/data/schema'
import { setSession } from '../src/main/session'
import { createAamad } from '../src/main/services/aamad'
import { createNikasi } from '../src/main/services/nikasi'
import { createSauda, listSauda, settleSauda, unsettleSauda } from '../src/main/services/sauda'
import { getAccountBalance, getTrialBalance } from '../src/main/services/ledger'
import { previewClose } from '../src/main/engines/close-year'

const REAL = join(homedir(), 'Library', 'Application Support', 'paritosh-cold', 'paritosh.db')
const COPY = join(process.env.SCRATCH ?? '/tmp', 'shortfall-verify.db')
const rs = (p: number): string => '₹' + (p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })
let pass = 0
let fail = 0
const check = (label: string, cond: boolean): void => {
  if (cond) { pass++; console.log('  ✓ ' + label) } else { fail++; console.log('  ✗ FAIL: ' + label) }
}

for (const f of [COPY, COPY + '-wal', COPY + '-shm']) if (existsSync(f)) rmSync(f)
copyFileSync(REAL, COPY)
openDb(COPY)

console.log('=== 1) The new migration applies to the real schema ===')
migrate(join(__dirname, '..', 'drizzle'))
const cols = db().all<{ name: string }>("PRAGMA table_info('nikasi')" as never) as Array<{ name: string }>
check('nikasi.remark column exists after migrate', cols.some((c) => c.name === 'remark'))

const yr = db().select().from(financialYear).where(eq(financialYear.status, 'open')).get()!
setSession({ userId: 1, username: 'admin', accountantName: 'Shortfall Verify', role: 'accountant', yearId: yr.id, year: yr.year })
const Y = yr.id
const U = 1
console.log(`  open year: ${yr.year} (id=${Y})`)

console.log('\n=== 2) Real deals read back with their delivery state ===')
const real = listSauda(Y)
console.log(`  ${real.length} deals; ${real.filter((s) => s.shortfallPackets > 0).length} with a shortfall`)
check('every real deal reports lifted+shortfall = promised', real.every((s) => s.liftedPackets + s.shortfallPackets === s.packets))
check('no real deal is settled yet', real.every((s) => s.settlementVoucherId === null))
for (const s of real.slice(0, 3)) {
  console.log(`  #${s.id} ${s.vyapariName} ← ${s.kisanName}: ${s.liftedPackets}/${s.packets} pkt @ ${rs(s.ratePaise)}`)
}

console.log('\n=== 3) The scenario: promised 100, lifted 78 ===')
const kisan = db().select().from(account).where(eq(account.type, 'kisan')).get()!
const vyapari = db().select().from(account).where(eq(account.type, 'vyapari')).get()!
const lot = createAamad(Y, {
  date: `${yr.year}-02-10`,
  kisanAccountId: kisan.id,
  totalPackets: 100,
  locations: [{ room: 1, floor: 1, rack: 40, packets: 100 }]
}, U)
createSauda(Y, { date: `${yr.year}-04-01`, vyapariAccountId: vyapari.id, kisanAccountId: kisan.id, aamadId: lot, packets: 100, ratePaise: 90000 }, U)

// He lifts 78 of them: 3,900 kg @ ₹900 per 105 kg.
createNikasi(Y, {
  date: `${yr.year}-05-01`,
  deliveredToType: 'vyapari',
  deliveredToAccountId: vyapari.id,
  remark: 'verify: partial lifting',
  lines: [{ aamadId: lot, packets: 78, weightKg: 3900, ratePaise: 90000 }]
}, U)

const deal = listSauda(Y).find((s) => s.aamadId === lot)!
console.log(`  ${vyapari.name} ← ${kisan.name}: lifted ${deal.liftedPackets}/${deal.packets}, short ${deal.shortfallPackets}`)
console.log(`  suggested for the 22: ${rs(deal.suggestedShortfallPaise!)} (the 78 earned ${rs(3342857)})`)
check('shortfall is 22 packets', deal.shortfallPackets === 22)
check('suggestion is priced off the 78 he took', deal.suggestedShortfallPaise === Math.round((3342857 / 78) * 22))

console.log('\n=== 4) Close-year warns about it, and posts nothing itself ===')
const ex = previewClose(Y).exceptions.filter((e) => e.kind === 'unsettled_sauda')
check('the unsettled deal shows as a close exception', ex.some((e) => e.saudaId === deal.id))
check('the exception names the vyapari and the kisan', ex.some((e) => e.accountName === vyapari.name && e.counterpartyName === kisan.name))

console.log('\n=== 5) Settling charges him and pays the kisan ===')
const before = { v: getAccountBalance(vyapari.id, Y), k: getAccountBalance(kisan.id, Y) }
const amount = deal.suggestedShortfallPaise!
const res = settleSauda(Y, deal.id, { date: `${yr.year}-12-31`, amountPaise: amount }, U)
console.log(`  voucher #${res.voucherNo} for ${rs(res.amountPaise)}`)
check('vyapari now owes the 22 packets (Dr)', getAccountBalance(vyapari.id, Y) === before.v + amount)
check('kisan is credited the same (Cr)', getAccountBalance(kisan.id, Y) === before.k - amount)
check('trial balance still nets to zero', getTrialBalance(Y).balanced)
check('the deal reads back settled', listSauda(Y).find((s) => s.id === deal.id)!.settlementVoucherId !== null)
check('close-year no longer warns about it', !previewClose(Y).exceptions.some((e) => e.kind === 'unsettled_sauda' && e.saudaId === deal.id))

console.log('\n=== 6) The kisan still carries the 22 packets\' rent (unchanged) ===')
const stillStored = db().select().from(aamadT).where(and(eq(aamadT.id, lot), eq(aamadT.yearId, Y))).get()!
check('the lot is untouched — no stock moved', stillStored.totalPackets === 100)

console.log('\n=== 7) Undo puts both balances back ===')
unsettleSauda(Y, deal.id, U)
check('vyapari back to where he was', getAccountBalance(vyapari.id, Y) === before.v)
check('kisan back to where he was', getAccountBalance(kisan.id, Y) === before.k)
check('trial balance still nets to zero', getTrialBalance(Y).balanced)

closeDb()
console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
