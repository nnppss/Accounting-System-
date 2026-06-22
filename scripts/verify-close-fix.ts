/**
 * Verify the close-year fix on the REAL 2025 data: roll back the buggy close (if any), then
 * re-close with the fixed engine and assert banks are NOT loaned/flagged and cash carries forward.
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/verify-close-fix.cjs
 */
import { homedir } from 'os'
import { join } from 'path'
import { eq, and, inArray } from 'drizzle-orm'
import { openDb, db, closeDb } from '../src/main/data/db'
import { financialYear, account, loan, openingBalance } from '../src/main/data/schema'
import { setSession } from '../src/main/session'
import { closeYear, rollbackClose, getCloseStatus } from '../src/main/engines/close-year'
import { getTrialBalance } from '../src/main/services/ledger'

const DB_PATH = join(homedir(), 'Library', 'Application Support', 'paritosh-cold', 'paritosh.db')
const rs = (p: number): string => '₹' + (p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })
let pass = 0, fail = 0
const check = (label: string, cond: boolean): void => { if (cond) { pass++; console.log('  ✓ ' + label) } else { fail++; console.log('  ✗ FAIL: ' + label) } }

openDb(DB_PATH)
const y2025 = db().select().from(financialYear).where(eq(financialYear.year, 2025)).get()!
const y2026 = db().select().from(financialYear).where(eq(financialYear.year, 2026)).get()!
const Y = y2025.id, NY = y2026.id
setSession({ userId: 1, username: 'admin', accountantName: 'Nikhil (Close Fix Verify)', role: 'accountant', yearId: Y, year: 2025 })
const U = 1
const id = (code: string): number => db().select({ id: account.id }).from(account).where(eq(account.code, code)).get()!.id
const idByName = (name: string): number => db().select({ id: account.id }).from(account).where(eq(account.name, name)).get()!.id

console.log('=== 1) Roll back the previous (buggy) close if present ===')
if (getCloseStatus(Y)) { rollbackClose(Y, U); console.log('  rolled back; 2025 reopened') } else console.log('  no active close')

console.log('\n=== 2) Re-close 2025 with the fixed engine ===')
const res = closeYear(Y, U)
console.log(`  closeId=${res.closeId}; indirectLoans=${res.summary.indirectLoans}; newDefaulters=${res.summary.newDefaulters}; accountsCarried=${res.summary.accountsCarried}`)
console.log(`  dues=${rs(res.summary.totalDuesPaise)} credits=${rs(res.summary.totalCreditsPaise)} capInterest=${rs(res.summary.interestCapitalisedPaise)}`)

console.log('\n=== 3) Assertions ===')
const SBI = idByName('SBI Current A/c'), HDFC = idByName('HDFC Bank A/c'), CASH = idByName('Cash')
const RAMLAL = idByName('Ramlal (Private)')
const MANOJ = id('V-25-0002'), KRISHNA = id('V-25-0004'), DHARAM = id('V-25-0005'), SP = id('K-25-0007')

const loans2026 = db().select({ accountId: loan.accountId }).from(loan).where(eq(loan.yearId, NY)).all()
const loanAccts = new Set(loans2026.map((l) => l.accountId))
const defaulters = new Set(db().select({ id: account.id }).from(account).where(eq(account.isDefaulter, true)).all().map((r) => r.id))
const opens = db().select({ accountId: openingBalance.accountId, amt: openingBalance.amountPaise, drcr: openingBalance.drCr }).from(openingBalance).where(eq(openingBalance.yearId, NY)).all()
const openOf = (a: number): { amt: number; drcr: string } | undefined => { const r = opens.find((o) => o.accountId === a); return r ? { amt: r.amt, drcr: r.drcr } : undefined }

// Bug 2 fixed: banks NOT loaned, NOT defaulters
check('SBI has NO indirect loan', !loanAccts.has(SBI))
check('HDFC has NO indirect loan', !loanAccts.has(HDFC))
check('SBI NOT flagged defaulter', !defaulters.has(SBI))
check('HDFC NOT flagged defaulter', !defaulters.has(HDFC))
// Bug 1 fixed: cash & banks carry forward
check('Cash carried forward', openOf(CASH) !== undefined)
check(`SBI carried forward as Dr (${openOf(SBI) ? rs(openOf(SBI)!.amt) : 'missing'})`, openOf(SBI)?.drcr === 'dr')
check(`HDFC carried forward as Dr (${openOf(HDFC) ? rs(openOf(HDFC)!.amt) : 'missing'})`, openOf(HDFC)?.drcr === 'dr')
// Real parties STILL loaned + flagged
check('Manoj has indirect loan', loanAccts.has(MANOJ))
check('Ramlal (real debtor) has indirect loan', loanAccts.has(RAMLAL))
check('SP flagged defaulter', defaulters.has(SP))
check('Krishna flagged defaulter', defaulters.has(KRISHNA))
// Counts: 5 real owing parties (Manoj, Krishna, Dharamveer, SP, Ramlal); no banks
check('exactly 5 indirect loans (no banks)', loans2026.length === 5)
check('2026 trial balance balanced', getTrialBalance(NY).balanced)
check('2025 trial balance still balanced', getTrialBalance(Y).balanced)

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`)
closeDb()
if (fail > 0) process.exit(1)
