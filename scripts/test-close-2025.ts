/**
 * Test the Year-end Close for FY 2025: preview → close → rollback → re-close.
 * Exercises capitalisation, carry-forward, indirect loans, defaulter flags, and reversibility.
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/test-close-2025.cjs
 */
import { homedir } from 'os'
import { join } from 'path'
import { eq } from 'drizzle-orm'
import { openDb, db, closeDb } from '../src/main/data/db'
import { financialYear } from '../src/main/data/schema'
import { setSession } from '../src/main/session'
import { previewClose, closeYear, rollbackClose, getCloseStatus } from '../src/main/engines/close-year'
import { getTrialBalance } from '../src/main/services/ledger'
import type { CloseSummary, CloseException } from '../src/shared/contracts'

const DB_PATH = join(homedir(), 'Library', 'Application Support', 'paritosh-cold', 'paritosh.db')
const rs = (p: number): string => '₹' + (p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })
const log = (...a: unknown[]): void => console.log(...a)

openDb(DB_PATH)
const yr = db().select().from(financialYear).where(eq(financialYear.year, 2025)).get()
if (!yr) throw new Error('FY 2025 missing')
const Y = yr.id
setSession({ userId: 1, username: 'admin', accountantName: 'Nikhil (Close Test)', role: 'accountant', yearId: Y, year: 2025 })
const U = 1

function printSummary(s: CloseSummary): void {
  log(`  year ${s.year} → ${s.nextYear}`)
  log(`  accounts carried forward : ${s.accountsCarried}`)
  log(`  total dues (Dr) carried  : ${rs(s.totalDuesPaise)}`)
  log(`  total credits (Cr) carried: ${rs(s.totalCreditsPaise)}`)
  log(`  loans capitalised        : ${s.loansCapitalised}  (interest ${rs(s.interestCapitalisedPaise)})`)
  log(`  indirect loans created   : ${s.indirectLoans}  (total ${rs(s.indirectLoanTotalPaise)})`)
  log(`  new defaulters flagged   : ${s.newDefaulters}`)
  log(`  leftover packets         : ${s.leftoverPackets}`)
}
function printExceptions(ex: CloseException[]): void {
  if (!ex.length) { log('  (none)'); return }
  for (const e of ex) log(`  • [${e.kind}] ${e.accountName ?? ''} ${e.amountPaise ? rs(e.amountPaise) : ''} — ${e.detail}`)
}

log('================ STEP 1: PREVIEW (dry run, posts nothing) ================')
const pre = previewClose(Y)
printSummary(pre.summary)
log('  exceptions:'); printExceptions(pre.exceptions)
log(`  already closed? ${pre.alreadyClosed}`)
log(`  2025 trial balance balanced (pre-close)? ${getTrialBalance(Y).balanced}`)

log('\n================ STEP 2: CLOSE THE YEAR ================')
const res = closeYear(Y, U)
log(`closeId=${res.closeId}`)
printSummary(res.summary)
log('  exceptions recorded:'); printExceptions(res.exceptions)
const next = db().select().from(financialYear).where(eq(financialYear.year, 2026)).get()!
log(`  2025 status now: ${db().select().from(financialYear).where(eq(financialYear.id, Y)).get()!.status}`)
log(`  2026 trial balance balanced? ${getTrialBalance(next.id).balanced}`)

log('\n================ STEP 3: ROLLBACK (undo) ================')
const rb = rollbackClose(Y, U)
log(`  close status after rollback: ${rb.status}`)
log(`  2025 status now: ${db().select().from(financialYear).where(eq(financialYear.id, Y)).get()!.status}`)
log(`  getCloseStatus(2025) active? ${getCloseStatus(Y) !== null}`)

log('\n================ STEP 4: RE-CLOSE (final state = closed) ================')
const res2 = closeYear(Y, U)
log(`closeId=${res2.closeId}`)
printSummary(res2.summary)
log(`  2025 status now: ${db().select().from(financialYear).where(eq(financialYear.id, Y)).get()!.status}`)
log(`  2026 trial balance balanced? ${getTrialBalance(next.id).balanced}`)

log('\n=== DONE ===')
closeDb()
