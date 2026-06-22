/**
 * RIGOROUS TEST — full-year 2025 simulation of a potato cold storage.
 *
 * Drives the REAL services/engines (number-series, double-entry posting, stock checks, cheque
 * lifecycle, interest, bhada, audit) so it behaves exactly like live industry use:
 *   • Filling season (aamad)  ~mid-Feb → mid-Mar
 *   • Nikasi season (stock-out / sales) ~Apr → early-Nov
 *   • Salaries monthly, loans + repayments, bardana, loading, cheques, contras, opening balances,
 *     bhada accrual, defaulter flag, manual vouchers — plus negative/edge cases that must REJECT.
 *
 * Run with Electron's node (ABI matches the native sqlite binding), app CLOSED:
 *   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/seed-2025-fullyear.cjs
 */
import { homedir } from 'os'
import { join } from 'path'
import { eq, and } from 'drizzle-orm'
import { openDb, db, closeDb } from '../src/main/data/db'
import { account, subgroup, financialYear } from '../src/main/data/schema'
import { setSession } from '../src/main/session'
import { createAccount, setOpeningBalance, setDefaulter } from '../src/main/services/accounts'
import { createAamad } from '../src/main/services/aamad'
import { createSauda } from '../src/main/services/sauda'
import { createNikasi } from '../src/main/services/nikasi'
import { paySalary, payLoadingContractor, setLoadingContractorYear } from '../src/main/services/expenses'
import { createLoan, recordPayment, getLoan } from '../src/main/services/loans'
import { createBardana } from '../src/main/services/bardana'
import { recordCheque, clearCheque, bounceCheque } from '../src/main/engines/cheque-clearing'
import { accrueAllRent } from '../src/main/engines/bhada'
import { createReceipt, createPayment, createContra, createJournal } from '../src/main/services/vouchers'

const DB_PATH = join(homedir(), 'Library', 'Application Support', 'paritosh-cold', 'paritosh.db')
const R = (rupees: number): number => Math.round(rupees * 100)
const log = (...a: unknown[]): void => console.log(...a)
let ok = 0
const did = (msg: string): void => { ok++; log('  ✓ ' + msg) }

openDb(DB_PATH)
const yr = db().select().from(financialYear).where(eq(financialYear.year, 2025)).get()
if (!yr) throw new Error('FY 2025 missing')
const Y = yr.id
setSession({ userId: 1, username: 'admin', accountantName: 'Nikhil (Full-Year Test)', role: 'accountant', yearId: Y, year: 2025 })
const U = 1

function acc(code: string): number {
  const r = db().select({ id: account.id }).from(account).where(eq(account.code, code)).get()
  if (!r) throw new Error(`No account ${code}`)
  return r.id
}
function grp(name: string): number {
  const r = db().select({ id: subgroup.id }).from(subgroup).where(eq(subgroup.name, name)).get()
  if (!r) throw new Error(`No subgroup ${name}`)
  return r.id
}
function ensure(name: string, type: 'other' | 'loading_contractor', sg: string): number {
  const e = db().select({ id: account.id }).from(account).where(and(eq(account.name, name), eq(account.type, type))).get()
  return e ? e.id : createAccount({ name, type, subgroupId: grp(sg) }, 2025)
}
function expectReject(label: string, fn: () => void): void {
  try { fn(); log(`  ✗ FAILED TO REJECT: ${label}`) }
  catch (e) { did(`rejected: ${label} (${(e as Error).message.slice(0, 60)})`) }
}

// Parties (kept across the wipe)
const SAHIL = acc('K-25-0002'), ABHISHEK = acc('K-25-0003'), MOHIT = acc('K-25-0004')
const SAURABH = acc('K-25-0005'), NANU = acc('K-25-0006'), SP = acc('K-25-0007')
const MANOJ = acc('V-25-0002'), SATYAPAL = acc('V-25-0003'), KRISHNA = acc('V-25-0004')
const DHARAMVEER = acc('V-25-0005'), NEERU = acc('V-25-0006')
const GM = acc('S-25-0002'), DAMBOLI = acc('S-25-0003'), GUPTAJI = acc('S-25-0004')
const MANVENDRA = acc('S-25-0006'), BIRO = acc('S-25-0007')
function sys(name: string): number {
  const r = db().select({ id: account.id }).from(account).where(and(eq(account.name, name), eq(account.isSystem, true))).get()
  if (!r) throw new Error(`No system account ${name}`)
  return r.id
}
const CASH_ID = sys('Cash')

// Accounts needed for "every scenario"
const SBI = ensure('SBI Current A/c', 'other', 'Cash and Bank')
const HDFC = ensure('HDFC Bank A/c', 'other', 'Cash and Bank')
const RAMLAL = ensure('Ramlal (Private)', 'other', 'Sundry Debtors')
const LOADER = ensure('Ramesh Loading Co.', 'loading_contractor', 'Sundry Creditors')
log(`Accounts: Cash=${CASH_ID} SBI=${SBI} HDFC=${HDFC} Ramlal=${RAMLAL} Loader=${LOADER}`)

// ============================================================
// 0) OPENING BALANCES — carried from 2024 (1 Jan 2025)
// ============================================================
log('\n=== OPENING BALANCES (01-Jan) ===')
setOpeningBalance(CASH_ID, Y, R(200000), 'dr', '2025-01-01', U); did('Cash opening ₹2,00,000 Dr')
setOpeningBalance(SBI, Y, R(500000), 'dr', '2025-01-01', U); did('SBI opening ₹5,00,000 Dr')
setOpeningBalance(HDFC, Y, R(300000), 'dr', '2025-01-01', U); did('HDFC opening ₹3,00,000 Dr')
setOpeningBalance(MANOJ, Y, R(50000), 'dr', '2025-01-01', U); did('Manoj owes ₹50,000 (Dr)')
setOpeningBalance(KRISHNA, Y, R(120000), 'dr', '2025-01-01', U); did('Krishna owes ₹1,20,000 (Dr)')
setOpeningBalance(SAHIL, Y, R(15000), 'cr', '2025-01-01', U); did('Cold owes Sahil ₹15,000 (Cr)')
setOpeningBalance(SP, Y, R(8000), 'dr', '2025-01-01', U); did('SP owes ₹8,000 (Dr)')

// ============================================================
// 1) LOANS — disbursed (Jan/Feb/Mar); repayments happen in-season
// ============================================================
log('\n=== LOANS (disbursement) ===')
const l1 = createLoan(Y, { category: 'kisan', accountId: SAHIL, date: '2025-01-15', amountPaise: R(50000), mobile: '9876543210', mode: 'cash', nature: 'direct', remark: 'Crop advance' }, U); did(`L1 direct/cash/kisan Sahil ₹50,000 (loan ${l1.loanId})`)
const l5 = createLoan(Y, { category: 'kisan', accountId: SAURABH, date: '2025-01-10', amountPaise: R(20000), mode: 'cash', nature: 'direct', remark: 'Short-term advance' }, U); did(`L5 direct/cash/kisan Saurabh ₹20,000 (loan ${l5.loanId})`)
const l2 = createLoan(Y, { category: 'vyapari', accountId: MANOJ, date: '2025-02-01', amountPaise: R(100000), mobile: '9897654321', mode: 'bank', bankAccountId: SBI, nature: 'direct', monthlyRateBps: 200, remark: 'Working capital @2%/mo' }, U); did(`L2 direct/bank/vyapari Manoj ₹1,00,000 @2% (loan ${l2.loanId})`)
const l4 = createLoan(Y, { category: 'other', accountId: RAMLAL, date: '2025-02-10', amountPaise: R(25000), mobile: '9000011111', mode: 'cash', nature: 'direct', remark: 'Personal loan' }, U); did(`L4 direct/cash/other Ramlal ₹25,000 (loan ${l4.loanId})`)
const l3 = createLoan(Y, { category: 'kisan', accountId: NANU, date: '2025-03-01', amountPaise: R(30000), mode: 'cash', nature: 'indirect', remark: 'Reclassified dues (no cash out)' }, U); did(`L3 indirect/kisan Nanu ₹30,000 (loan ${l3.loanId}, voucher=${l3.voucherId ?? 'none'})`)

// ============================================================
// 2) BARDANA — pre-season purchase, in-season issue (bags)
// ============================================================
log('\n=== BARDANA ===')
createBardana(Y, { direction: 'purchase', date: '2025-01-20', partyAccountId: null, ratePaise: R(25), qty: 5000, mode: 'cash' }, U); did('Purchase 5000 pcs @ ₹25 cash')
createBardana(Y, { direction: 'purchase', date: '2025-02-05', partyAccountId: null, ratePaise: R(26), qty: 3000, mode: 'bank', bankAccountId: SBI }, U); did('Purchase 3000 pcs @ ₹26 SBI')
createBardana(Y, { direction: 'issue', date: '2025-02-20', partyAccountId: SAHIL, ratePaise: R(30), qty: 2000, mode: 'cash' }, U); did('Issue 2000 pcs @ ₹30 cash')
createBardana(Y, { direction: 'issue', date: '2025-03-01', partyAccountId: NANU, ratePaise: R(32), qty: 1500, mode: 'cash' }, U); did('Issue 1500 pcs @ ₹32 cash')
createBardana(Y, { direction: 'purchase', date: '2025-08-01', partyAccountId: null, ratePaise: R(27), qty: 1000, mode: 'cash' }, U); did('Purchase 1000 pcs @ ₹27 cash (mid-year top-up)')
createBardana(Y, { direction: 'issue', date: '2025-09-01', partyAccountId: MOHIT, ratePaise: R(28), qty: 1000, mode: 'cash' }, U); did('Issue 1000 pcs @ ₹28 cash')

// ============================================================
// 3) CONTRA — cash↔bank, bank↔bank
// ============================================================
log('\n=== CONTRA ===')
// The cold pays most expenses in cash, so it withdraws from the bank to fund operations,
// with one deposit and one bank-to-bank transfer for direction variety.
createContra({ yearId: Y, date: '2025-03-20', fromAccountId: SBI, toAccountId: CASH_ID, amountPaise: R(200000), narration: 'Withdraw to fund filling-season payments' }); did('SBI → Cash ₹2,00,000')
createContra({ yearId: Y, date: '2025-05-15', fromAccountId: CASH_ID, toAccountId: SBI, amountPaise: R(50000), narration: 'Surplus cash deposited' }); did('Cash → SBI ₹50,000')
createContra({ yearId: Y, date: '2025-06-30', fromAccountId: SBI, toAccountId: CASH_ID, amountPaise: R(150000), narration: 'Withdraw for mid-season expenses' }); did('SBI → Cash ₹1,50,000')
createContra({ yearId: Y, date: '2025-09-30', fromAccountId: SBI, toAccountId: CASH_ID, amountPaise: R(100000), narration: 'Withdraw for late-season expenses' }); did('SBI → Cash ₹1,00,000')
createContra({ yearId: Y, date: '2025-10-31', fromAccountId: HDFC, toAccountId: SBI, amountPaise: R(100000), narration: 'Bank-to-bank transfer' }); did('HDFC → SBI ₹1,00,000')

// ============================================================
// 4) AAMAD — FILLING SEASON (mid-Feb → mid-Mar)
// ============================================================
log('\n=== AAMAD (filling season) ===')
const A = (no: string, date: string, k: number, total: number, locs: Array<{ room: number; floor: number; rack: number; packets: number }>): void => {
  createAamad(Y, { no, date, kisanAccountId: k, totalPackets: total, locations: locs }, U); did(`${no} ${date} ${total} pkts (${locs.length} loc)`)
}
A('A-2025-001', '2025-02-15', SAHIL, 600, [{ room: 1, floor: 1, rack: 1, packets: 300 }, { room: 1, floor: 1, rack: 2, packets: 300 }])
A('A-2025-002', '2025-02-16', SP, 700, [{ room: 4, floor: 1, rack: 40, packets: 400 }, { room: 4, floor: 2, rack: 40, packets: 300 }])
A('A-2025-003', '2025-02-18', ABHISHEK, 900, [{ room: 2, floor: 1, rack: 10, packets: 300 }, { room: 2, floor: 2, rack: 10, packets: 300 }, { room: 2, floor: 3, rack: 10, packets: 300 }])
A('A-2025-004', '2025-02-20', MOHIT, 500, [{ room: 3, floor: 1, rack: 5, packets: 250 }, { room: 3, floor: 2, rack: 5, packets: 250 }])
A('A-2025-005', '2025-02-22', SAURABH, 800, [{ room: 5, floor: 6, rack: 160, packets: 400 }, { room: 5, floor: 6, rack: 159, packets: 400 }]) // max room/floor/rack
A('A-2025-006', '2025-02-25', NANU, 1500, [{ room: 1, floor: 3, rack: 20, packets: 500 }, { room: 1, floor: 4, rack: 20, packets: 500 }, { room: 1, floor: 5, rack: 20, packets: 500 }])
A('A-2025-007', '2025-03-05', MOHIT, 400, [{ room: 3, floor: 3, rack: 5, packets: 400 }]) // second aamad, same kisan
A('A-2025-008', '2025-03-10', NANU, 1, [{ room: 2, floor: 6, rack: 1, packets: 1 }]) // smallest possible
A('A-2025-009', '2025-03-12', SP, 300, [{ room: 4, floor: 3, rack: 40, packets: 300 }]) // late filling near boundary

// ============================================================
// 5) SAUDA — deals (rates) struck before sales
// ============================================================
log('\n=== SAUDA (deals) ===')
const S = (date: string, v: number, k: number, pkts: number, rate: number, note: string): void => {
  createSauda(Y, { date, vyapariAccountId: v, kisanAccountId: k, packets: pkts, ratePaise: R(rate) }, U); did(`${date} ${note} @ ₹${rate}`)
}
S('2025-03-25', MANOJ, SAHIL, 200, 450, 'Manoj–Sahil')
S('2025-04-15', MANOJ, SAHIL, 150, 455, 'Manoj–Sahil re-deal (new rate)')
S('2025-04-10', MANOJ, ABHISHEK, 200, 460, 'Manoj–Abhishek')
S('2025-10-20', MANOJ, NANU, 500, 410, 'Manoj–Nanu')
S('2025-05-01', SATYAPAL, MOHIT, 250, 500, 'Satyapal–Mohit')
S('2025-05-01', SATYAPAL, NANU, 300, 400, 'Satyapal–Nanu')
S('2025-10-05', SATYAPAL, SP, 300, 520, 'Satyapal–SP')
S('2025-10-05', SATYAPAL, ABHISHEK, 150, 465, 'Satyapal–Abhishek')
S('2025-06-01', KRISHNA, MOHIT, 300, 520, 'Krishna–Mohit')
S('2025-07-01', NEERU, SAURABH, 400, 600, 'Neeru–Saurabh')
S('2025-09-01', NEERU, SAURABH, 200, 610, 'Neeru–Saurabh re-deal')
S('2025-08-01', DHARAMVEER, NANU, 250, 400, 'Dharamveer–Nanu')

// ============================================================
// 6) NIKASI — STOCK-OUT SEASON (Apr → early Nov). vyapari=sale(posts); kisan=self(physical)
// ============================================================
log('\n=== NIKASI (stock-out season) ===')
const sale = (date: string, v: number, lines: Array<{ k: number; room: number; floor: number; rack: number; pkts: number; rate: number; wt?: number }>, extra: { vehicle?: string; recv?: string; bhada?: number } = {}): void => {
  const r = createNikasi(Y, {
    date, deliveredToType: 'vyapari', deliveredToAccountId: v,
    vehicleNo: extra.vehicle, receivedBy: extra.recv, bhadaRecoveredPaise: extra.bhada ? R(extra.bhada) : undefined,
    lines: lines.map((l) => ({ fromKisanAccountId: l.k, room: l.room, floor: l.floor, rack: l.rack, packets: l.pkts, weightKg: l.wt, ratePaise: R(l.rate) }))
  }, U)
  did(`SALE ${date} bill#${r.billNo} → vch ${r.voucherId} (${lines.length} line)`)
}
sale('2025-04-05', MANOJ, [{ k: SAHIL, room: 1, floor: 1, rack: 1, pkts: 200, rate: 450, wt: 10000 }], { vehicle: 'UP80-AB-1234', recv: 'Ramesh', bhada: 20000 })
sale('2025-04-20', MANOJ, [ // multi-kisan single gate pass
  { k: SAHIL, room: 1, floor: 1, rack: 2, pkts: 150, rate: 455, wt: 7500 },
  { k: ABHISHEK, room: 2, floor: 1, rack: 10, pkts: 200, rate: 460, wt: 10000 }
], { vehicle: 'UP80-CD-5678', recv: 'Suresh' })
sale('2025-05-10', SATYAPAL, [
  { k: MOHIT, room: 3, floor: 1, rack: 5, pkts: 250, rate: 500 }, // full rack → 0
  { k: NANU, room: 1, floor: 3, rack: 20, pkts: 300, rate: 400 }
], { vehicle: 'UP80-EF-9012', recv: 'Mahesh', bhada: 30000 })
sale('2025-06-15', KRISHNA, [
  { k: MOHIT, room: 3, floor: 2, rack: 5, pkts: 100, rate: 520 }, // partial
  { k: MOHIT, room: 3, floor: 3, rack: 5, pkts: 200, rate: 520 }
], { vehicle: 'UP80-GH-3456' })
sale('2025-07-08', NEERU, [{ k: SAURABH, room: 5, floor: 6, rack: 160, pkts: 400, rate: 600, wt: 20000 }], { vehicle: 'UP80-IJ-7788', recv: 'Naresh', bhada: 40000 })
sale('2025-08-12', DHARAMVEER, [{ k: NANU, room: 1, floor: 4, rack: 20, pkts: 250, rate: 400 }], { vehicle: 'UP80-KL-9900' })
sale('2025-09-05', NEERU, [{ k: SAURABH, room: 5, floor: 6, rack: 159, pkts: 200, rate: 610, wt: 10000 }], { vehicle: 'UP80-MN-2211' })
sale('2025-10-15', SATYAPAL, [
  { k: SP, room: 4, floor: 1, rack: 40, pkts: 300, rate: 520 },
  { k: ABHISHEK, room: 2, floor: 2, rack: 10, pkts: 150, rate: 465 }
], { vehicle: 'UP80-OP-4433', recv: 'Mahesh' })
sale('2025-10-28', MANOJ, [{ k: NANU, room: 1, floor: 5, rack: 20, pkts: 500, rate: 410 }], { vehicle: 'UP80-QR-5544', recv: 'Suresh', bhada: 50000 })

// Self-withdrawals (kisan takes own stock — physical only, no posting)
const self = (date: string, k: number, room: number, floor: number, rack: number, pkts: number): void => {
  const r = createNikasi(Y, { date, deliveredToType: 'kisan', deliveredToAccountId: k, receivedBy: 'Self', lines: [{ fromKisanAccountId: k, room, floor, rack, packets: pkts, ratePaise: 0 }] }, U)
  did(`SELF-WITHDRAW ${date} bill#${r.billNo} (physical, voucher=${r.voucherId ?? 'none'})`)
}
self('2025-05-20', SP, 4, 2, 40, 100)
self('2025-09-20', NANU, 2, 6, 1, 1) // exact-zero withdrawal of the single packet

// ============================================================
// 7) RECEIPTS from vyaparis (cash + cheque lifecycle: clear / bounce / pending)
// ============================================================
log('\n=== RECEIPTS / CHEQUES (money in) ===')
createReceipt({ yearId: Y, date: '2025-04-25', partyAccountId: MANOJ, cashBankAccountId: CASH_ID, amountPaise: R(100000), narration: 'Manoj part payment (cash)', tag: 'trade' }); did('Manoj ₹1,00,000 cash')
const ch1 = recordCheque(Y, { direction: 'received', partyAccountId: MANOJ, bankAccountId: SBI, amountPaise: R(200000), no: 'CHQ-1001', bank: 'PNB', issueDate: '2025-05-05', date: '2025-05-05' }, U)
clearCheque(ch1.chequeId, '2025-05-12', U); did('Manoj cheque ₹2,00,000 received → CLEARED')
const ch2 = recordCheque(Y, { direction: 'received', partyAccountId: SATYAPAL, bankAccountId: SBI, amountPaise: R(245000), no: 'CHQ-2002', bank: 'SBI', issueDate: '2025-05-20', date: '2025-05-20' }, U)
bounceCheque(ch2.chequeId, '2025-05-30', U); did('Satyapal cheque ₹2,45,000 received → BOUNCED')
createReceipt({ yearId: Y, date: '2025-06-02', partyAccountId: SATYAPAL, cashBankAccountId: CASH_ID, amountPaise: R(245000), narration: 'Satyapal re-paid in cash after bounce', tag: 'trade' }); did('Satyapal ₹2,45,000 cash (after bounce)')
createReceipt({ yearId: Y, date: '2025-06-25', partyAccountId: KRISHNA, cashBankAccountId: CASH_ID, amountPaise: R(150000), narration: 'Krishna part payment', tag: 'trade' }); did('Krishna ₹1,50,000 cash')
const ch3 = recordCheque(Y, { direction: 'received', partyAccountId: NEERU, bankAccountId: SBI, amountPaise: R(240000), no: 'CHQ-3003', bank: 'HDFC', issueDate: '2025-07-15', date: '2025-07-15' }, U)
clearCheque(ch3.chequeId, '2025-07-22', U); did('Neeru cheque ₹2,40,000 → CLEARED')
createReceipt({ yearId: Y, date: '2025-08-20', partyAccountId: DHARAMVEER, cashBankAccountId: CASH_ID, amountPaise: R(40000), narration: 'Dharamveer part payment (rest unpaid)', tag: 'trade' }); did('Dharamveer ₹40,000 cash (partial)')
const ch4 = recordCheque(Y, { direction: 'received', partyAccountId: NEERU, bankAccountId: SBI, amountPaise: R(122000), no: 'CHQ-4004', bank: 'HDFC', issueDate: '2025-09-15', date: '2025-09-15' }, U)
clearCheque(ch4.chequeId, '2025-09-25', U); did('Neeru cheque ₹1,22,000 → CLEARED')
const ch5 = recordCheque(Y, { direction: 'received', partyAccountId: SATYAPAL, bankAccountId: SBI, amountPaise: R(225750), no: 'CHQ-5005', bank: 'SBI', issueDate: '2025-10-25', date: '2025-10-25' }, U)
did(`Satyapal cheque ₹2,25,750 → PENDING at year-end (cheque ${ch5.chequeId})`)

// ============================================================
// 8) PAYMENTS to kisans (settle proceeds) — cash/bank + a GIVEN cheque that bounces
// ============================================================
log('\n=== PAYMENTS to kisans (money out) ===')
createPayment({ yearId: Y, date: '2025-06-20', partyAccountId: SAHIL, cashBankAccountId: CASH_ID, amountPaise: R(50000), narration: 'Part settlement to Sahil', tag: 'trade' }); did('Pay Sahil ₹50,000 cash')
const gch1 = recordCheque(Y, { direction: 'given', partyAccountId: ABHISHEK, bankAccountId: SBI, amountPaise: R(70000), no: 'CHQ-OUT-7001', bank: 'SBI', issueDate: '2025-07-10', date: '2025-07-10' }, U)
clearCheque(gch1.chequeId, '2025-07-18', U); did('Pay Abhishek ₹70,000 by cheque → CLEARED')
createPayment({ yearId: Y, date: '2025-07-20', partyAccountId: MOHIT, cashBankAccountId: CASH_ID, amountPaise: R(150000), narration: 'Part settlement to Mohit', tag: 'trade' }); did('Pay Mohit ₹1,50,000 cash')
createPayment({ yearId: Y, date: '2025-08-05', partyAccountId: SAURABH, cashBankAccountId: SBI, amountPaise: R(200000), narration: 'Settlement to Saurabh (bank)', tag: 'trade' }); did('Pay Saurabh ₹2,00,000 SBI')
createPayment({ yearId: Y, date: '2025-09-10', partyAccountId: NANU, cashBankAccountId: CASH_ID, amountPaise: R(100000), narration: 'Part settlement to Nanu', tag: 'trade' }); did('Pay Nanu ₹1,00,000 cash')
// given cheque to Nanu that BOUNCES, then re-paid cash
const gch2 = recordCheque(Y, { direction: 'given', partyAccountId: NANU, bankAccountId: SBI, amountPaise: R(30000), no: 'CHQ-OUT-7002', bank: 'SBI', issueDate: '2025-09-12', date: '2025-09-12' }, U)
bounceCheque(gch2.chequeId, '2025-09-20', U); did('Pay Nanu ₹30,000 cheque → BOUNCED')
createPayment({ yearId: Y, date: '2025-09-22', partyAccountId: NANU, cashBankAccountId: CASH_ID, amountPaise: R(30000), narration: 'Nanu re-paid cash after our cheque bounced', tag: 'trade' }); did('Pay Nanu ₹30,000 cash (after bounce)')
createPayment({ yearId: Y, date: '2025-11-15', partyAccountId: SP, cashBankAccountId: CASH_ID, amountPaise: R(50000), narration: 'Part settlement to SP', tag: 'trade' }); did('Pay SP ₹50,000 cash')

// ============================================================
// 9) LOAN REPAYMENTS (interest posts automatically)
// ============================================================
log('\n=== LOAN REPAYMENTS ===')
const p1 = recordPayment(l1.loanId, R(20000), '2025-06-15', 'cash', undefined, U); did(`Sahil repay ₹20,000 → interest ₹${(p1.interestPaise / 100).toFixed(2)}`)
const due5 = getLoan(l5.loanId, '2025-04-10')!.breakdown.outstandingPaise
const p5 = recordPayment(l5.loanId, due5, '2025-04-10', 'cash', undefined, U); did(`Saurabh FULL repay ₹${(due5 / 100).toFixed(2)} → interest ₹${(p5.interestPaise / 100).toFixed(2)}`)
const p2 = recordPayment(l2.loanId, R(50000), '2025-08-10', 'bank', SBI, U); did(`Manoj repay ₹50,000 (bank) → interest ₹${(p2.interestPaise / 100).toFixed(2)}`)

// ============================================================
// 10) SALARIES — monthly. Permanent staff Jan–Dec; seasonal Feb–Nov.
// ============================================================
log('\n=== SALARIES (monthly) ===')
const MONTH_END = ['2025-01-31','2025-02-28','2025-03-31','2025-04-30','2025-05-31','2025-06-30','2025-07-31','2025-08-31','2025-09-30','2025-10-31','2025-11-30','2025-12-31']
const payStaff = (party: number, amt: number, date: string, mode: 'cash' | 'bank'): void => {
  paySalary(Y, { partyAccountId: party, amountPaise: R(amt), date, mode, bankAccountId: mode === 'bank' ? SBI : undefined, narration: 'Monthly salary' }, U)
}
let salCount = 0
MONTH_END.forEach((d, i) => {
  payStaff(GM, 15000, d, i % 3 === 0 ? 'bank' : 'cash'); salCount++       // GM, mixed mode
  payStaff(DAMBOLI, 8000, d, 'cash'); salCount++                          // permanent
  payStaff(GUPTAJI, 12000, d, i % 2 === 0 ? 'bank' : 'cash'); salCount++  // munim, mixed
  if (i >= 1 && i <= 10) { payStaff(MANVENDRA, 7000, d, 'cash'); salCount++; payStaff(BIRO, 6000, d, 'cash'); salCount++ } // seasonal Feb–Nov
})
did(`${salCount} salary payments across the year`)

// ============================================================
// 11) LOADING CONTRACTOR — per-year charges + unloading/loading payments
// ============================================================
log('\n=== LOADING CONTRACTOR ===')
setLoadingContractorYear(Y, { accountId: LOADER, loadingChargePaise: R(8), unloadingChargePaise: R(7), labourersLoading: 12, labourersUnloading: 15 }, U); did('Set Ramesh per-year charges/labourers')
payLoadingContractor(Y, { partyAccountId: LOADER, amountPaise: R(40000), date: '2025-02-28', mode: 'cash', narration: 'Unloading labour (filling)' }, U); did('Unloading ₹40,000 cash')
payLoadingContractor(Y, { partyAccountId: LOADER, amountPaise: R(35000), date: '2025-03-15', mode: 'cash', narration: 'Unloading labour (filling)' }, U); did('Unloading ₹35,000 cash')
payLoadingContractor(Y, { partyAccountId: LOADER, amountPaise: R(30000), date: '2025-05-15', mode: 'cash', narration: 'Loading labour (nikasi)' }, U); did('Loading ₹30,000 cash')
payLoadingContractor(Y, { partyAccountId: LOADER, amountPaise: R(45000), date: '2025-08-15', mode: 'bank', bankAccountId: SBI, narration: 'Loading labour (nikasi)' }, U); did('Loading ₹45,000 SBI')
payLoadingContractor(Y, { partyAccountId: LOADER, amountPaise: R(50000), date: '2025-10-30', mode: 'cash', narration: 'Loading labour (season end)' }, U); did('Loading ₹50,000 cash')

// ============================================================
// 12) BHADA (rent) — accrued at season end on stored packets
// ============================================================
log('\n=== BHADA (rent accrual) ===')
const bh = accrueAllRent(Y, '2025-11-10', U); did(`Accrued rent for ${bh.kisans} kisans, total ₹${(bh.totalPaise / 100).toFixed(2)}`)

// ============================================================
// 13) MANUAL JOURNALS (free-form adjustments)
// ============================================================
log('\n=== MANUAL JOURNALS ===')
createJournal({ yearId: Y, date: '2025-12-15', narration: 'Manual rent adjustment for SP (extra month)', entries: [ { accountId: SP, drPaise: R(2000), crPaise: 0, tag: 'rent' }, { accountId: sys('Rent/Bhada Income'), drPaise: 0, crPaise: R(2000), tag: 'rent' } ] }); did('Journal: SP rent adjustment ₹2,000')
createJournal({ yearId: Y, date: '2025-12-20', narration: 'Diesel/electricity expense provision', entries: [ { accountId: sys('Loading Expense'), drPaise: R(12000), crPaise: 0, tag: 'general' }, { accountId: CASH_ID, drPaise: 0, crPaise: R(12000), tag: 'general' } ] }); did('Journal: misc expense ₹12,000')

// ============================================================
// 14) DEFAULTER — vyapari who left a balance unpaid
// ============================================================
log('\n=== DEFAULTER FLAG ===')
setDefaulter(DHARAMVEER, true, U); did('Dharamveer flagged DEFAULTER (₹60,000 unpaid)')

// ============================================================
// 15) NEGATIVE / EDGE CASES — these MUST be rejected
// ============================================================
log('\n=== NEGATIVE / EDGE CASES (must reject) ===')
expectReject('over-stock nikasi (draw > available)', () => createNikasi(Y, { date: '2025-10-30', deliveredToType: 'vyapari', deliveredToAccountId: MANOJ, lines: [{ fromKisanAccountId: SAHIL, room: 1, floor: 1, rack: 1, packets: 9999, ratePaise: R(450) }] }, U))
expectReject('aamad totals mismatch', () => createAamad(Y, { no: 'BAD-1', date: '2025-03-01', kisanAccountId: SAHIL, totalPackets: 100, locations: [{ room: 1, floor: 1, rack: 3, packets: 50 }] }, U))
expectReject('aamad rack out of bounds (rack 9999)', () => createAamad(Y, { no: 'BAD-2', date: '2025-03-01', kisanAccountId: SAHIL, totalPackets: 10, locations: [{ room: 1, floor: 1, rack: 9999, packets: 10 }] }, U))
expectReject('loan amount zero', () => createLoan(Y, { category: 'kisan', accountId: SAHIL, date: '2025-01-01', amountPaise: 0, mode: 'cash', nature: 'direct' }, U))
expectReject('contra same account', () => createContra({ yearId: Y, date: '2025-01-01', fromAccountId: CASH_ID, toAccountId: CASH_ID, amountPaise: R(100) }))
expectReject('repayment exceeds outstanding', () => recordPayment(l4.loanId, R(99999999), '2025-12-31', 'cash', undefined, U))
expectReject('bardana zero qty', () => createBardana(Y, { direction: 'purchase', date: '2025-01-01', partyAccountId: null, ratePaise: R(25), qty: 0, mode: 'cash' }, U))
expectReject('unbalanced journal', () => createJournal({ yearId: Y, date: '2025-12-31', narration: 'bad', entries: [ { accountId: CASH_ID, drPaise: R(100), crPaise: 0 }, { accountId: SP, drPaise: 0, crPaise: R(90) } ] }))

log(`\n=== DONE — ${ok} operations succeeded/handled ===`)
closeDb()
