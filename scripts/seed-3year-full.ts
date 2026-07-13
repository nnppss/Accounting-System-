/**
 * FULL RESET + 3-YEAR SIMULATION (2024, 2025, 2026-to-date) of Paritosh Cold.
 *
 * Wipes the real DB (after a timestamped backup), re-migrates, then drives the REAL
 * services/engines through three seasons of industry-realistic use:
 *   • 10 kisans, 10 vyaparis, 10 staff, 10 "other" parties, 2 partner firms, 2 loading
 *     contractors, 2 banks (Canara Bank = main, Zila Sahkari = small secondary so
 *     bank↔bank contra is covered).
 *   • Canara construction term loan (2 tranches, interest-only moratorium, then EMIs).
 *   • Assets (building/plant/WIP→capitalisation/vehicle), other income, misc expenses,
 *     depreciation, Duties & Taxes provision, partner (related-party) UTR transactions.
 *   • Bardana purchase/issue (cash/credit/partial/prebooked), loans (direct/indirect/
 *     cheque/zero-rate), cheque lifecycle (clear/bounce/pending), bhada accrual,
 *     year-end closes 2024→2025→2026, defaulters flagged + redeemed.
 *   • A battery of must-reject edge cases, then a verification report.
 *
 * Run with the app CLOSED, under Electron's node ABI:
 *   ./node_modules/vite/node_modules/.bin/esbuild scripts/seed-3year-full.ts --bundle \
 *     --platform=node --format=cjs --target=node18 --external:better-sqlite3 \
 *     --external:bcryptjs --outfile=scripts/seed-3year-full.cjs
 *   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/seed-3year-full.cjs
 */
import { homedir } from 'os'
import { join } from 'path'
import { copyFileSync, existsSync, rmSync } from 'fs'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { openDb, db, closeDb, migrate } from '../src/main/data/db'
import { seedReferenceData } from '../src/main/data/seed'
import {
  aamad as aamadT,
  account,
  bardana as bardanaT,
  cheque as chequeT,
  loan as loanT,
  nikasi as nikasiT,
  sauda as saudaT,
  subgroup,
  voucher as voucherT
} from '../src/main/data/schema'
import { createUser, createYear, login } from '../src/main/auth/auth'
import { setSession } from '../src/main/session'
import {
  createAccount,
  createPerson,
  deleteAccount,
  deletePerson,
  setDefaulter,
  setOpeningBalance
} from '../src/main/services/accounts'
import { createAamad } from '../src/main/services/aamad'
import { createSauda } from '../src/main/services/sauda'
import { createNikasi } from '../src/main/services/nikasi'
import { paySalary, payLoadingContractor, setLoadingContractorYear } from '../src/main/services/expenses'
import { createLoan, getLoan, recordPayment } from '../src/main/services/loans'
import { createBardana, deliverBardana, getBardanaAccount } from '../src/main/services/bardana'
import { bounceCheque, clearCheque, recordCheque } from '../src/main/engines/cheque-clearing'
import { accrueAllRent } from '../src/main/engines/bhada'
import { createContra, createJournal, createPayment, createReceipt } from '../src/main/services/vouchers'
import { closeYear } from '../src/main/engines/close-year'
import { getAccountBalance, getTrialBalance } from '../src/main/services/ledger'
import { getMap } from '../src/main/services/maps'
import { setStoreConfig } from '../src/main/services/store'
import { voidVoucher } from '../src/main/services/posting'

// ============================================================
// 0) RESET — backup, wipe, migrate, bootstrap
// ============================================================
const DIR = join(homedir(), 'Library', 'Application Support', 'paritosh-cold')
const DB_PATH = join(DIR, 'paritosh.db')
const REPO = join(__dirname, '..')

const stamp = new Date().toISOString().slice(0, 19).replace(/[:T-]/g, '')
if (existsSync(DB_PATH)) {
  copyFileSync(DB_PATH, `${DB_PATH}.pre-reset-${stamp}`)
  console.log(`Backed up existing DB → paritosh.db.pre-reset-${stamp}`)
}
for (const f of [DB_PATH, `${DB_PATH}-shm`, `${DB_PATH}-wal`]) rmSync(f, { force: true })

openDb(DB_PATH)
migrate(join(REPO, 'drizzle'))
seedReferenceData()
createUser('admin', 'admin123', 'Administrator', 'admin')
const Y24 = createYear(2024, 110 * 100) // rent ₹110/packet
const Y25 = createYear(2025, 120 * 100) // rent ₹120/packet
const Y26 = createYear(2026, 130 * 100) // rent ₹130/packet
const U = 1
console.log(`Fresh DB migrated. Years: 2024=#${Y24} 2025=#${Y25} 2026=#${Y26}`)

// ============================================================
// helpers
// ============================================================
const R = (rupees: number): number => Math.round(rupees * 100)
let ok = 0
const failures: string[] = []
const log = (...a: unknown[]): void => console.log(...a)
const did = (msg: string): void => { ok++; log('  ✓ ' + msg) }
const inr = (paise: number): string => (paise / 100).toLocaleString('en-IN')
const check = (cond: boolean, msg: string): void => {
  if (cond) did(`CHECK ${msg}`)
  else { failures.push(msg); log(`  ✗ CHECK FAILED: ${msg}`) }
}
function expectReject(label: string, fn: () => void): void {
  try { fn(); failures.push(`should have rejected: ${label}`); log(`  ✗ FAILED TO REJECT: ${label}`) }
  catch (e) { did(`rejected: ${label} (${(e as Error).message.replace(/\n/g, ' ').slice(0, 70)})`) }
}
function grp(name: string): number {
  const r = db().select({ id: subgroup.id }).from(subgroup).where(eq(subgroup.name, name)).get()
  if (!r) throw new Error(`No subgroup ${name}`)
  return r.id
}
function sys(name: string): number {
  const r = db().select({ id: account.id }).from(account).where(and(eq(account.name, name), eq(account.isSystem, true))).get()
  if (!r) throw new Error(`No system account ${name}`)
  return r.id
}
function monthEnd(y: number, m: number): string {
  const d = new Date(y, m, 0).getDate()
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
const bal = (acc: number, Y: number): number => getAccountBalance(acc, Y)

/** Settle a party's ledger for the year down to `leaveDrPaise` (default 0). Default mode: Canara
 * bank — season settlements move by RTGS/IMPS; pass mode 'cash' for the small ones. */
function settle(Y: number, date: string, acc: number, opts: { mode?: 'cash' | 'bank'; bankId?: number; leaveDrPaise?: number; note?: string } = {}): void {
  const diff = bal(acc, Y) - (opts.leaveDrPaise ?? 0)
  if (diff === 0) return
  const cashBank = opts.mode === 'cash' ? CASH : (opts.bankId ?? CANARA)
  if (diff > 0) {
    createReceipt({ yearId: Y, date, partyAccountId: acc, cashBankAccountId: cashBank, amountPaise: diff, narration: opts.note ?? 'Final settlement of account', tag: 'trade' })
  } else {
    createPayment({ yearId: Y, date, partyAccountId: acc, cashBankAccountId: cashBank, amountPaise: -diff, narration: opts.note ?? 'Final settlement of account', tag: 'trade' })
  }
}

// ---- lot tracker (per year; cleared at season start) ----
interface Lot { id: number; remaining: number; kisan: number }
const lots = new Map<string, Lot>()
function fill(Y: number, label: string, date: string, kisan: number, total: number, locs: Array<{ room: number; floor: number; rack: number; packets: number }>): void {
  const id = createAamad(Y, { date, kisanAccountId: kisan, totalPackets: total, locations: locs }, U)
  const placed = locs.reduce((s, l) => s + l.packets, 0)
  lots.set(label, { id, remaining: placed, kisan })
  did(`aamad ${label} ${date}: ${total} pkts (${placed} placed, ${locs.length} loc)`)
}
function take(label: string, pkts: number): number {
  const l = lots.get(label)
  if (!l) throw new Error(`seed: unknown lot ${label}`)
  if (l.remaining < pkts) throw new Error(`seed: lot ${label} has only ${l.remaining}, wanted ${pkts}`)
  l.remaining -= pkts
  return l.id
}
function sale(Y: number, date: string, vyapari: number, items: Array<{ lot: string; pkts: number; rate: number }>, extra: { vehicle?: string; recv?: string; bhada?: number } = {}): void {
  const r = createNikasi(Y, {
    date, deliveredToType: 'vyapari', deliveredToAccountId: vyapari,
    vehicleNo: extra.vehicle, receivedBy: extra.recv,
    bhadaRecoveredPaise: extra.bhada ? R(extra.bhada) : undefined,
    // Rate is per 105 kg; weight = pkts × 105 keeps proceeds = pkts × rate.
    lines: items.map((i) => ({ aamadId: take(i.lot, i.pkts), packets: i.pkts, weightKg: i.pkts * 105, ratePaise: R(i.rate) }))
  }, U)
  did(`SALE ${date} gate pass #${r.billNo} — ${items.reduce((s, i) => s + i.pkts, 0)} pkts, ${items.length} line(s)`)
}
function self(Y: number, date: string, label: string, pkts: number): void {
  const l = lots.get(label)!
  const r = createNikasi(Y, { date, deliveredToType: 'kisan', deliveredToAccountId: l.kisan, receivedBy: 'Self', lines: [{ aamadId: take(label, pkts), packets: pkts, ratePaise: 0 }] }, U)
  did(`SELF-WITHDRAW ${date} ${label} ${pkts} pkts (gate pass #${r.billNo}, physical only)`)
}

// ============================================================
// 1) MASTER DATA — persons, accounts, banks, heads, assets
// ============================================================
log('\n===== MASTER DATA =====')
const FARMER = grp('Farmer'), DEBTORS = grp('Sundry Debtors'), CREDITORS = grp('Sundry Creditors')
const CASHBANK = grp('Cash and Bank'), FIXED = grp('Fixed Assets'), SECURED = grp('Secured Loans')
const DIRECT_EXP = grp('Direct Expense'), INDIRECT_EXP = grp('Indirect Expense')
const OTHER_INC = grp('Income from Other Resource'), DUTIES = grp('Duties & Taxes')
const CASH = sys('Cash')

function party(name: string, type: 'kisan' | 'vyapari' | 'staff' | 'loading_contractor' | 'other', sg: number, year: number, id: { sonOf?: string; village?: string; phone?: string; job?: string; personId?: number } = {}): number {
  const personId = id.personId ?? createPerson({ name, sonOf: id.sonOf, villageCity: id.village, state: 'Uttar Pradesh', phone: id.phone })
  return createAccount({ name, type, subgroupId: sg, personId, job: id.job }, year)
}

// --- 10 kisans (9 from 2024, Kunwar Pal joins 2025) ---
const RAMESH = party('Ramesh Chandra', 'kisan', FARMER, 2024, { sonOf: 'Hori Lal', village: 'Nagla Khurd', phone: '9412001001' })
const SURESH = party('Suresh Yadav', 'kisan', FARMER, 2024, { sonOf: 'Ram Sewak', village: 'Barhan', phone: '9412001002' })
const MAHESH = party('Mahesh Singh', 'kisan', FARMER, 2024, { sonOf: 'Chob Singh', village: 'Khandauli', phone: '9412001003' })
const DINESH = party('Dinesh Kumar', 'kisan', FARMER, 2024, { sonOf: 'Prem Chand', village: 'Etmadpur', phone: '9412001004' })
const RAKESH = party('Rakesh Verma', 'kisan', FARMER, 2024, { sonOf: 'Babu Lal', village: 'Tundla', phone: '9412001005' })
const BRIJESH = party('Brijesh Tiwari', 'kisan', FARMER, 2024, { sonOf: 'Pt. Dev Dutt', village: 'Firozabad Road', phone: '9412001006' })
const ramAvtarPerson = createPerson({ name: 'Ram Avtar', sonOf: 'Khem Chand', villageCity: 'Jarar', state: 'Uttar Pradesh', phone: '9412001007' })
const RAMAVTAR_K = party('Ram Avtar', 'kisan', FARMER, 2024, { personId: ramAvtarPerson })
const GHANSHYAM = party('Ghanshyam', 'kisan', FARMER, 2024, { sonOf: 'Tota Ram', village: 'Nagla Khurd', phone: '9412001008' })
const NETRAPAL = party('Netrapal Singh', 'kisan', FARMER, 2024, { sonOf: 'Amar Singh', village: 'Barhan', phone: '9412001009' })
const CHANDRAPAL = party('Chandrapal', 'kisan', FARMER, 2024, { sonOf: 'Roshan Lal', village: 'Khandauli', phone: '9412001010' })
did('9 kisan accounts (2024) — Kunwar Pal joins in 2025')

// --- 10 vyaparis (9 from 2024, Iqbal joins 2025). Ram Avtar = SAME person as kisan (dual role). ---
const MANOJ = party('Manoj Traders', 'vyapari', DEBTORS, 2024, { sonOf: 'Manoj Kumar', village: 'Sikandra Mandi, Agra', phone: '9837002001' })
const KRISHNA = party('Krishna Trading Co.', 'vyapari', DEBTORS, 2024, { village: 'Achhnera Mandi', phone: '9837002002' })
const DHARAMVEER = party('Dharamveer Singh', 'vyapari', DEBTORS, 2024, { sonOf: 'Chatur Singh', village: 'Shamsabad', phone: '9837002003' })
const NEERAJ = party('Neeraj & Sons', 'vyapari', DEBTORS, 2024, { village: 'Sikandra Mandi, Agra', phone: '9837002004' })
const GOPALV = party('Gopal Sabzi Bhandar', 'vyapari', DEBTORS, 2024, { village: 'Firozabad', phone: '9837002005' })
const ASLAM = party('Aslam Aloo Arhat', 'vyapari', DEBTORS, 2024, { village: 'Agra Mandi', phone: '9837002006' })
const RAMAVTAR_V = party('Ram Avtar (Vyapar)', 'vyapari', DEBTORS, 2024, { personId: ramAvtarPerson })
const VIPIN = party('Vipin Kumar Arhat', 'vyapari', DEBTORS, 2024, { village: 'Tundla', phone: '9837002007' })
const SANJAY = party('Sanjay Foods', 'vyapari', DEBTORS, 2024, { village: 'Hathras', phone: '9837002008' })
did('9 vyapari accounts (2024) — Ram Avtar is the SAME person as kisan Ram Avtar (dual role); Iqbal joins 2025')

// --- 10 staff (9 from 2024, Kallu joins 2025) ---
const GOPAL_MGR = party('Gopal Sharma', 'staff', CREDITORS, 2024, { job: 'Manager', phone: '9719003001' })
const GUPTAJI = party('Guptaji', 'staff', CREDITORS, 2024, { job: 'Munim (Accountant)', phone: '9719003002' })
const RAMSINGH = party('Ram Singh', 'staff', CREDITORS, 2024, { job: 'Chowkidar', phone: '9719003003' })
const SHYAMLAL = party('Shyam Lal', 'staff', CREDITORS, 2024, { job: 'Machine Operator', phone: '9719003004' })
const RAJU = party('Raju', 'staff', CREDITORS, 2024, { job: 'Helper (seasonal)', phone: '9719003005' })
const PINTU = party('Pintu', 'staff', CREDITORS, 2024, { job: 'Helper (seasonal)', phone: '9719003006' })
const SALIM = party('Salim Khan', 'staff', CREDITORS, 2024, { job: 'Electrician', phone: '9719003007' })
const DINESH_DRV = party('Dinesh Babu', 'staff', CREDITORS, 2024, { job: 'Driver', phone: '9719003008' })
const MUNNA = party('Munna Lal', 'staff', CREDITORS, 2024, { job: 'Munshi (Gate)', phone: '9719003009' })
did('9 staff accounts (2024) — Kallu joins 2025')

// --- 10 "other" accounts ---
const RAMLAL = party('Ramlal Pradhan', 'other', DEBTORS, 2024, { sonOf: 'Het Ram', village: 'Jarar', phone: '9719004001' })
const BEEJ = party('Jai Kisan Beej Bhandar', 'other', CREDITORS, 2024, { village: 'Agra', phone: '9719004002' })
const GIRDHARI = party('Girdhari Thekedar (Construction)', 'other', CREDITORS, 2024, { village: 'Agra', phone: '9719004003' })
const VERMA = party('Verma Machinery Works', 'other', CREDITORS, 2024, { village: 'Agra', phone: '9719004004' })
const INSURANCE_CO = party('New India Insurance Co.', 'other', CREDITORS, 2024, { village: 'Agra', phone: '9719004005' })
const UPPCL = party('UPPCL (Bijli Vibhag)', 'other', CREDITORS, 2024, { village: 'Khandauli', phone: '1912' })
const SHARMA_DIESEL = party('Sharma Filling Station', 'other', CREDITORS, 2024, { village: 'NH-19 Khandauli', phone: '9719004006' })
const AGRA_TRANSPORT = party('Agra Transport Co.', 'other', CREDITORS, 2024, { village: 'Agra', phone: '9719004007' })
const TENT = party('Mahadev Tent House', 'other', CREDITORS, 2024, { village: 'Khandauli', phone: '9719004008' })
const CLINIC = party('Dr. Rajeev Clinic', 'other', CREDITORS, 2024, { village: 'Khandauli', phone: '9719004009' })
did('10 other accounts (suppliers, vendors, private parties)')

// --- partner firms (related parties — Sundry Creditors, UTR in narration per policy) ---
const SP_CO = party('SP & Company (Satyapal Singh)', 'other', CREDITORS, 2024, { sonOf: 'Partner: Satyapal Singh', village: 'Agra', phone: '9837005001' })
const BEEPEE = party('Bee Pee Electricals (Sarju Bansal)', 'other', CREDITORS, 2024, { sonOf: 'Partner: Sarju Bansal', village: 'Agra', phone: '9837005002' })
did('2 partner firms — SP & Company (Satyapal Singh), Bee Pee Electricals (Sarju Bansal)')

// --- loading contractors ---
const LOADER1 = party('Ramesh Loading Co.', 'loading_contractor', CREDITORS, 2024, { phone: '9719006001' })
did('loading contractor Ramesh Loading Co. (Bhola Palledar Group joins 2025)')

// --- banks (type 'bank', pinned to Cash and Bank) ---
const CANARA = createAccount({ name: 'Canara Bank A/c', type: 'bank', subgroupId: CASHBANK, bankAccountNumber: '0563201002345', bankIfsc: 'CNRB0000563', bankBranch: 'Khandauli, Agra' }, 2024)
const COOP = createAccount({ name: 'Zila Sahkari Bank A/c', type: 'bank', subgroupId: CASHBANK, bankAccountNumber: '110022003344', bankIfsc: 'ZSBL0000012', bankBranch: 'Etmadpur' }, 2024)
did('banks: Canara Bank (main) + Zila Sahkari Bank (secondary)')

// --- asset heads, liability head, income heads, expense heads (type other) ---
const BUILDING = createAccount({ name: 'Cold Storage Building', type: 'other', subgroupId: FIXED }, 2024)
const PLANT = createAccount({ name: 'Plant & Machinery (Compressors)', type: 'other', subgroupId: FIXED }, 2024)
const WIP = createAccount({ name: 'New Room Construction (WIP)', type: 'other', subgroupId: FIXED }, 2024)
const OFFICE_EQ = createAccount({ name: 'Office Equipment', type: 'other', subgroupId: FIXED }, 2024)
const KANTA_ASSET = createAccount({ name: 'Weighing Kanta (Machine)', type: 'other', subgroupId: FIXED }, 2024)
const VEHICLE = createAccount({ name: 'Tata Ace (UP80-CT-7788)', type: 'other', subgroupId: FIXED }, 2024)
const TERM_LOAN = createAccount({ name: 'Canara Bank Term Loan A/c', type: 'other', subgroupId: SECURED }, 2024)
const GRADING_INC = createAccount({ name: 'Grading & Sorting Income', type: 'other', subgroupId: OTHER_INC }, 2024)
const KANTA_INC = createAccount({ name: 'Weighbridge (Kanta) Income', type: 'other', subgroupId: OTHER_INC }, 2024)
const SCRAP_INC = createAccount({ name: 'Scrap Sale Income', type: 'other', subgroupId: OTHER_INC }, 2024)
const TEMPO_INC = createAccount({ name: 'Tempo Freight Income', type: 'other', subgroupId: OTHER_INC }, 2024)
const ELEC_EXP = createAccount({ name: 'Electricity Expense', type: 'other', subgroupId: DIRECT_EXP }, 2024)
const DIESEL_EXP = createAccount({ name: 'Diesel & Genset Expense', type: 'other', subgroupId: DIRECT_EXP }, 2024)
const REPAIR_EXP = createAccount({ name: 'Repairs & Maintenance', type: 'other', subgroupId: DIRECT_EXP }, 2024)
const INSUR_EXP = createAccount({ name: 'Insurance Expense', type: 'other', subgroupId: INDIRECT_EXP }, 2024)
const MISC_EXP = createAccount({ name: 'Office & Misc Expense', type: 'other', subgroupId: INDIRECT_EXP }, 2024)
const BANKCHG_EXP = createAccount({ name: 'Bank Interest & Charges', type: 'other', subgroupId: INDIRECT_EXP }, 2024)
const WELFARE_EXP = createAccount({ name: 'Staff Welfare Expense', type: 'other', subgroupId: INDIRECT_EXP }, 2024)
const DEPR_EXP = createAccount({ name: 'Depreciation Expense', type: 'other', subgroupId: INDIRECT_EXP }, 2024)
const MANDI_PAYABLE = createAccount({ name: 'Mandi Shulk Payable', type: 'other', subgroupId: DUTIES }, 2024)
did('asset/liability/income/expense heads created')

// ---- Canara term loan machinery (₹40L construction loan @9.5% p.a.) ----
let tlBal = 0
const TL_MONTHLY_RATE = 0.095 / 12
const EMI = R(66000)
function tlDisburse(Y: number, date: string, amtPaise: number, narration: string): void {
  createReceipt({ yearId: Y, date, partyAccountId: TERM_LOAN, cashBankAccountId: CANARA, amountPaise: amtPaise, narration, tag: 'general' })
  tlBal += amtPaise
  did(`TERM LOAN tranche ₹${inr(amtPaise)} → Canara (${date})`)
}
function tlInterestOnly(Y: number, date: string): void {
  const i = Math.round(tlBal * TL_MONTHLY_RATE)
  createJournal({ yearId: Y, date, narration: `Term loan interest (moratorium) — o/s ₹${inr(tlBal)}`, entries: [
    { accountId: BANKCHG_EXP, drPaise: i, crPaise: 0, tag: 'general' },
    { accountId: CANARA, drPaise: 0, crPaise: i, tag: 'general' }
  ] })
}
function tlEmi(Y: number, date: string): void {
  const i = Math.round(tlBal * TL_MONTHLY_RATE)
  const p = Math.min(EMI - i, tlBal)
  createJournal({ yearId: Y, date, narration: `Term loan EMI — principal ₹${inr(p)} + interest ₹${inr(i)}`, entries: [
    { accountId: TERM_LOAN, drPaise: p, crPaise: 0, tag: 'general' },
    { accountId: BANKCHG_EXP, drPaise: i, crPaise: 0, tag: 'general' },
    { accountId: CANARA, drPaise: 0, crPaise: p + i, tag: 'general' }
  ] })
  tlBal -= p
}

// ---- staff payroll table ----
interface Staff { acc: number; pay: number; mode: 'cash' | 'canara' | 'coop'; seasonal?: boolean; from?: number }
const STAFF: Staff[] = [
  { acc: GOPAL_MGR, pay: 18000, mode: 'canara' },
  { acc: GUPTAJI, pay: 15000, mode: 'cash' },
  { acc: RAMSINGH, pay: 9000, mode: 'cash' },
  { acc: SHYAMLAL, pay: 12500, mode: 'coop' },
  { acc: RAJU, pay: 8000, mode: 'cash', seasonal: true },
  { acc: PINTU, pay: 8000, mode: 'cash', seasonal: true },
  { acc: SALIM, pay: 11000, mode: 'cash' },
  { acc: DINESH_DRV, pay: 10500, mode: 'canara' },
  { acc: MUNNA, pay: 9500, mode: 'cash' }
]
function payMonthlySalaries(Y: number, year: number, uptoMonth: number): void {
  let n = 0
  for (let m = 1; m <= uptoMonth; m++) {
    const d = monthEnd(year, m)
    for (const s of STAFF) {
      if (s.from && s.from > year) continue
      if (s.seasonal && (m < 2 || m > 11)) continue
      const mode: 'cash' | 'bank' = s.mode === 'cash' ? 'cash' : 'bank'
      paySalary(Y, { partyAccountId: s.acc, amountPaise: R(s.pay), date: d, mode, bankAccountId: s.mode === 'canara' ? CANARA : s.mode === 'coop' ? COOP : undefined, narration: `Salary ${year}-${String(m).padStart(2, '0')}` }, U)
      n++
    }
  }
  did(`${n} monthly salary payments (${year})`)
}
function payElectricityDirect(Y: number, year: number, amounts: Array<[number, number]>): void {
  for (const [m, amt] of amounts) {
    createPayment({ yearId: Y, date: `${year}-${String(m).padStart(2, '0')}-12`, partyAccountId: ELEC_EXP, cashBankAccountId: CANARA, amountPaise: R(amt), narration: `UPPCL electricity bill ${year}-${String(m).padStart(2, '0')}`, tag: 'general' })
  }
  did(`${amounts.length} electricity payments (${year})`)
}

// ╔══════════════════════════════════════════════════════════╗
// ║                        YEAR 2024                          ║
// ╚══════════════════════════════════════════════════════════╝
log('\n===== YEAR 2024 =====')
setSession({ userId: U, username: 'admin', accountantName: 'Guptaji (Munim)', role: 'accountant', yearId: Y24, year: 2024 })

// --- opening balances (1 Jan 2024) ---
setOpeningBalance(CASH, Y24, R(150000), 'dr', '2024-01-01', U)
setOpeningBalance(CANARA, Y24, R(850000), 'dr', '2024-01-01', U)
setOpeningBalance(COOP, Y24, R(100000), 'dr', '2024-01-01', U)
setOpeningBalance(BUILDING, Y24, R(5500000), 'dr', '2024-01-01', U)
setOpeningBalance(PLANT, Y24, R(2200000), 'dr', '2024-01-01', U)
setOpeningBalance(KANTA_ASSET, Y24, R(80000), 'dr', '2024-01-01', U)
setOpeningBalance(RAMESH, Y24, R(18000), 'dr', '2024-01-01', U)  // old dues
setOpeningBalance(GHANSHYAM, Y24, R(25000), 'dr', '2024-01-01', U) // old dues → reclassified as indirect loan below
setOpeningBalance(KRISHNA, Y24, R(25000), 'cr', '2024-01-01', U) // advance received last season
setOpeningBalance(SP_CO, Y24, R(200000), 'cr', '2024-01-01', U)  // partner funds already in the business
did('opening balances 2024 (cash, banks, assets, parties, partner)')

// --- construction term loan: tranche 1 + partner money in ---
tlDisburse(Y24, '2024-03-15', R(2500000), 'Canara term loan TL/2024/0311 tranche 1 — new room construction')
createReceipt({ yearId: Y24, date: '2024-03-10', partyAccountId: SP_CO, cashBankAccountId: CANARA, amountPaise: R(500000), narration: 'UTR CNRB2403101234 — funds introduced by partner Satyapal Singh (SP & Company) for construction', tag: 'general' })
did('SP & Company introduced ₹5,00,000 (UTR in narration)')

// --- loans (udhaar) 2024 ---
const l24_suresh = createLoan(Y24, { category: 'kisan', accountId: SURESH, date: '2024-01-20', amountPaise: R(60000), mobile: '9412001002', mode: 'cash', nature: 'direct', remark: 'Crop advance' }, U)
const l24_manoj = createLoan(Y24, { category: 'vyapari', accountId: MANOJ, date: '2024-02-10', amountPaise: R(150000), mode: 'bank', bankAccountId: CANARA, nature: 'direct', monthlyRateBps: 200, remark: 'Working capital @2%/mo' }, U)
const l24_mahesh = createLoan(Y24, { category: 'kisan', accountId: MAHESH, date: '2024-02-15', amountPaise: R(40000), mode: 'cheque', bankAccountId: CANARA, nature: 'direct', chequeNo: 'CNR-24-000101', chequeBank: 'Canara Bank', chequeClearanceDate: '2024-02-22', remark: 'Advance by cheque' }, U)
const maheshChq = db().select().from(chequeT).where(eq(chequeT.no, 'CNR-24-000101')).get()!
clearCheque(maheshChq.id, '2024-02-22', U)
const l24_ramlal = createLoan(Y24, { category: 'other', accountId: RAMLAL, date: '2024-05-05', amountPaise: R(35000), mobile: '9719004001', mode: 'cash', nature: 'direct', remark: 'Personal loan' }, U)
createLoan(Y24, { category: 'kisan', accountId: GHANSHYAM, date: '2024-03-01', amountPaise: R(25000), mode: 'cash', nature: 'indirect', remark: 'Old dues reclassified (opening balance)' }, U)
did('5 loans: direct cash/bank@2%/cheque(cleared), other-party, indirect from old dues')

// --- bardana 2024 ---
createBardana(Y24, { direction: 'purchase', date: '2024-01-25', partyAccountId: null, ratePaise: R(24), qty: 8000, mode: 'cash' }, U)
createBardana(Y24, { direction: 'purchase', date: '2024-02-08', partyAccountId: BEEJ, ratePaise: R(25), qty: 4000, paidPaise: R(60000), mode: 'bank', bankAccountId: CANARA, remark: 'Balance on credit' }, U)
createBardana(Y24, { direction: 'issue', date: '2024-02-18', partyAccountId: RAMESH, ratePaise: R(30), qty: 2500, mode: 'cash' }, U)
createBardana(Y24, { direction: 'issue', date: '2024-02-25', partyAccountId: SURESH, ratePaise: R(31), qty: 2000, paidPaise: 0, mode: 'cash', remark: 'Full credit — recover at settlement' }, U)
const preb24 = createBardana(Y24, { direction: 'issue', date: '2024-03-02', partyAccountId: DINESH, ratePaise: R(30), qty: 1500, mode: 'cash', prebooked: true, remark: 'Pre-booked; bags handed over on 10/03' }, U)
deliverBardana(Y24, preb24.bardanaId, U)
createBardana(Y24, { direction: 'issue', date: '2024-02-28', partyAccountId: BRIJESH, ratePaise: R(31), qty: 1000, paidPaise: 0, mode: 'cash', remark: 'Full credit' }, U)
createBardana(Y24, { direction: 'issue', date: '2024-09-10', partyAccountId: MANOJ, ratePaise: R(32), qty: 800, paidPaise: R(10000), mode: 'cash' }, U)
did('bardana 2024: 2 purchases (1 part-credit) + 5 issues (cash/credit/partial/prebooked+delivered)')

// --- filling season 2024 (12 Feb – 20 Mar) ---
lots.clear()
fill(Y24, 'ram24', '2024-02-12', RAMESH, 9000, [{ room: 1, floor: 1, rack: 1, packets: 3000 }, { room: 1, floor: 1, rack: 2, packets: 3000 }, { room: 1, floor: 2, rack: 1, packets: 3000 }])
fill(Y24, 'sur24', '2024-02-14', SURESH, 7000, [{ room: 1, floor: 3, rack: 10, packets: 4000 }, { room: 1, floor: 4, rack: 10, packets: 3000 }])
fill(Y24, 'mah24', '2024-02-16', MAHESH, 12000, [{ room: 2, floor: 1, rack: 20, packets: 4000 }, { room: 2, floor: 2, rack: 20, packets: 4000 }, { room: 2, floor: 3, rack: 20, packets: 4000 }])
fill(Y24, 'din24', '2024-02-20', DINESH, 6000, [{ room: 2, floor: 4, rack: 30, packets: 6000 }])
fill(Y24, 'rak24', '2024-02-24', RAKESH, 5000, [{ room: 3, floor: 1, rack: 40, packets: 5000 }])
fill(Y24, 'bri24', '2024-02-29', BRIJESH, 4000, [{ room: 3, floor: 2, rack: 50, packets: 4000 }]) // leap-day aamad
fill(Y24, 'rav24', '2024-03-04', RAMAVTAR_K, 8000, [{ room: 4, floor: 1, rack: 60, packets: 4000 }, { room: 4, floor: 2, rack: 60, packets: 4000 }])
fill(Y24, 'gha24', '2024-03-08', GHANSHYAM, 6500, [{ room: 4, floor: 3, rack: 70, packets: 6500 }])
fill(Y24, 'net24', '2024-03-12', NETRAPAL, 1, [{ room: 2, floor: 6, rack: 1, packets: 1 }]) // smallest possible lot
fill(Y24, 'cha24', '2024-03-15', CHANDRAPAL, 5490, [{ room: 5, floor: 6, rack: 160, packets: 2490 }, { room: 5, floor: 6, rack: 159, packets: 3000 }]) // max bounds
fill(Y24, 'mah24b', '2024-03-18', MAHESH, 3000, [{ room: 2, floor: 5, rack: 20, packets: 3000 }]) // second lot, same kisan

// --- loading contractor 2024 ---
setLoadingContractorYear(Y24, { accountId: LOADER1, loadingAmountPaise: R(150000), unloadingAmountPaise: R(100000) }, U)
payLoadingContractor(Y24, { partyAccountId: LOADER1, amountPaise: R(50000), date: '2024-03-05', mode: 'cash', narration: 'Unloading labour (filling)' }, U)
payLoadingContractor(Y24, { partyAccountId: LOADER1, amountPaise: R(50000), date: '2024-03-25', mode: 'cash', narration: 'Unloading labour (filling, final)' }, U)
payLoadingContractor(Y24, { partyAccountId: LOADER1, amountPaise: R(60000), date: '2024-06-20', mode: 'bank', bankAccountId: CANARA, narration: 'Loading labour (nikasi)' }, U)
payLoadingContractor(Y24, { partyAccountId: LOADER1, amountPaise: R(90000), date: '2024-10-30', mode: 'cash', narration: 'Loading labour (season end)' }, U)
did('loading contractor 2024: quotes ₹1.5L/₹1L + 4 payments')

// --- saudas 2024 ---
const S = (Y: number, date: string, v: number, k: number, pkts: number, rate: number): void => {
  createSauda(Y, { date, vyapariAccountId: v, kisanAccountId: k, packets: pkts, ratePaise: R(rate) }, U)
}
S(Y24, '2024-04-02', MANOJ, RAMESH, 3000, 450); S(Y24, '2024-04-20', MANOJ, RAMESH, 3000, 450)
S(Y24, '2024-04-20', MANOJ, MAHESH, 4000, 460); S(Y24, '2024-10-08', MANOJ, RAMAVTAR_K, 4000, 455)
S(Y24, '2024-06-05', KRISHNA, DINESH, 3000, 440)
S(Y24, '2024-05-02', NEERAJ, MAHESH, 4000, 470); S(Y24, '2024-08-16', NEERAJ, MAHESH, 3000, 475)
S(Y24, '2024-10-01', NEERAJ, RAMESH, 3000, 455)
S(Y24, '2024-05-12', GOPALV, SURESH, 4000, 430); S(Y24, '2024-07-18', GOPALV, GHANSHYAM, 3000, 445)
S(Y24, '2024-06-22', ASLAM, RAKESH, 5000, 452.5) // paise rate
S(Y24, '2024-07-02', DHARAMVEER, BRIJESH, 3500, 440); S(Y24, '2024-07-02', DHARAMVEER, SURESH, 2500, 440)
S(Y24, '2024-08-30', VIPIN, GHANSHYAM, 3000, 448); S(Y24, '2024-08-30', VIPIN, MAHESH, 4000, 465)
S(Y24, '2024-10-16', VIPIN, CHANDRAPAL, 5000, 435)
S(Y24, '2024-09-10', SANJAY, DINESH, 3000, 460); S(Y24, '2024-10-28', SANJAY, RAMAVTAR_K, 3000, 450)
S(Y24, '2024-11-01', RAMAVTAR_V, SURESH, 500, 432) // dual-role person as buyer
did('19 saudas 2024 (incl. re-deal at new rate, paise rate, dual-role deal)')

// --- nikasi (stock-out) 2024 ---
sale(Y24, '2024-04-08', MANOJ, [{ lot: 'ram24', pkts: 3000, rate: 450 }], { vehicle: 'UP80-AB-1234', recv: 'Ramesh (Manoj Traders)', bhada: 45000 })
sale(Y24, '2024-04-25', MANOJ, [{ lot: 'ram24', pkts: 3000, rate: 450 }, { lot: 'mah24', pkts: 4000, rate: 460 }], { vehicle: 'UP80-CD-5678', recv: 'Suresh Palledar' })
sale(Y24, '2024-05-06', NEERAJ, [{ lot: 'mah24', pkts: 4000, rate: 470 }], { vehicle: 'UP80-EF-9012' })
sale(Y24, '2024-05-15', GOPALV, [{ lot: 'sur24', pkts: 4000, rate: 430 }], { vehicle: 'UP80-GH-3456', bhada: 60000 })
sale(Y24, '2024-06-10', KRISHNA, [{ lot: 'din24', pkts: 3000, rate: 440 }], { vehicle: 'UP80-IJ-7788' })
self(Y24, '2024-06-15', 'rav24', 1000) // kisan takes own stock — physical only
sale(Y24, '2024-06-25', ASLAM, [{ lot: 'rak24', pkts: 5000, rate: 452.5 }], { vehicle: 'UP80-KL-9900', recv: 'Aslam Bhai' })
sale(Y24, '2024-07-05', DHARAMVEER, [{ lot: 'bri24', pkts: 3500, rate: 440 }, { lot: 'sur24', pkts: 2500, rate: 440 }], { vehicle: 'UP80-MN-2211' }) // multi-kisan gate pass
sale(Y24, '2024-07-22', GOPALV, [{ lot: 'gha24', pkts: 3000, rate: 445 }], { vehicle: 'UP80-OP-4433' })
sale(Y24, '2024-08-20', NEERAJ, [{ lot: 'mah24b', pkts: 3000, rate: 475 }], { vehicle: 'UP80-QR-5544' })
sale(Y24, '2024-09-02', VIPIN, [{ lot: 'gha24', pkts: 3000, rate: 448 }, { lot: 'mah24', pkts: 4000, rate: 465 }], { vehicle: 'UP80-ST-6655', bhada: 75000 })
self(Y24, '2024-09-20', 'gha24', 500)
sale(Y24, '2024-09-14', SANJAY, [{ lot: 'din24', pkts: 3000, rate: 460 }], { vehicle: 'UP80-UV-7766' }) // empties din24 exactly
sale(Y24, '2024-10-05', NEERAJ, [{ lot: 'ram24', pkts: 3000, rate: 455 }], { vehicle: 'UP80-WX-8877' }) // empties ram24
sale(Y24, '2024-10-12', MANOJ, [{ lot: 'rav24', pkts: 4000, rate: 455 }], { vehicle: 'UP80-YZ-9988' })
sale(Y24, '2024-10-20', VIPIN, [{ lot: 'cha24', pkts: 5000, rate: 435 }], { vehicle: 'UP80-AB-1122' })
sale(Y24, '2024-10-28', SANJAY, [{ lot: 'rav24', pkts: 3000, rate: 450 }], { vehicle: 'UP80-CD-3344' }) // empties rav24
sale(Y24, '2024-11-04', RAMAVTAR_V, [{ lot: 'sur24', pkts: 500, rate: 432 }]) // dual-role: same person buys as vyapari
self(Y24, '2024-11-08', 'bri24', 500) // empties bri24
did('2024 stock-out complete — leftover: net24 (1 pkt) + cha24 (490 pkts) stay in store at year end')

// --- receipts from vyaparis + cheque lifecycle 2024 ---
createReceipt({ yearId: Y24, date: '2024-05-02', partyAccountId: MANOJ, cashBankAccountId: CASH, amountPaise: R(150000), narration: 'Manoj part payment (cash)', tag: 'trade' })
createReceipt({ yearId: Y24, date: '2024-05-20', partyAccountId: MANOJ, cashBankAccountId: CANARA, amountPaise: R(1200000), narration: 'Manoj part payment (RTGS)', tag: 'trade' })
const c1 = recordCheque(Y24, { direction: 'received', partyAccountId: MANOJ, bankAccountId: CANARA, amountPaise: R(200000), no: 'PNB-778001', bank: 'PNB', date: '2024-06-01', receiveDate: '2024-06-01' }, U)
clearCheque(c1.chequeId, '2024-06-07', U)
const c2 = recordCheque(Y24, { direction: 'received', partyAccountId: GOPALV, bankAccountId: CANARA, amountPaise: R(172000), no: 'SBI-102938', bank: 'SBI', date: '2024-06-10', receiveDate: '2024-06-10' }, U)
bounceCheque(c2.chequeId, '2024-06-18', U)
createReceipt({ yearId: Y24, date: '2024-06-25', partyAccountId: GOPALV, cashBankAccountId: CASH, amountPaise: R(172000), narration: 'Gopal Sabzi re-paid cash after cheque bounce', tag: 'trade' })
const c3 = recordCheque(Y24, { direction: 'received', partyAccountId: NEERAJ, bankAccountId: COOP, amountPaise: R(188000), no: 'HDFC-556677', bank: 'HDFC', date: '2024-07-15', receiveDate: '2024-07-15' }, U)
clearCheque(c3.chequeId, '2024-07-21', U) // cleared into the co-op bank
createReceipt({ yearId: Y24, date: '2024-07-30', partyAccountId: ASLAM, cashBankAccountId: CANARA, amountPaise: R(1500000), narration: 'Aslam part payment (bank transfer)', tag: 'trade' })
createReceipt({ yearId: Y24, date: '2024-08-25', partyAccountId: DHARAMVEER, cashBankAccountId: CASH, amountPaise: R(100000), narration: 'Dharamveer part payment', tag: 'trade' })
createReceipt({ yearId: Y24, date: '2024-08-28', partyAccountId: DHARAMVEER, cashBankAccountId: CANARA, amountPaise: R(1600000), narration: 'Dharamveer part payment (RTGS)', tag: 'trade' })
createReceipt({ yearId: Y24, date: '2024-09-28', partyAccountId: VIPIN, cashBankAccountId: CANARA, amountPaise: R(3000000), narration: 'Vipin part payment (bank)', tag: 'trade' })
createReceipt({ yearId: Y24, date: '2024-10-15', partyAccountId: KRISHNA, cashBankAccountId: CANARA, amountPaise: R(1400000), narration: 'Krishna payment — leaves advance for next season', tag: 'trade' })
createReceipt({ yearId: Y24, date: '2024-11-12', partyAccountId: DHARAMVEER, cashBankAccountId: CASH, amountPaise: R(900000), narration: 'Dharamveer third part payment', tag: 'trade' })
did('vyapari receipts 2024: cash/bank + cheques cleared (Canara & co-op) + bounce→cash re-pay')

// --- construction spend 2024 (through Girdhari Thekedar + Bee Pee Electricals) ---
tlDisburse(Y24, '2024-06-20', R(1500000), 'Canara term loan TL/2024/0311 tranche 2 — new room construction')
createJournal({ yearId: Y24, date: '2024-04-15', narration: 'Girdhari Thekedar — construction RA bill 1 (new room)', entries: [
  { accountId: WIP, drPaise: R(1200000), crPaise: 0, tag: 'general' }, { accountId: GIRDHARI, drPaise: 0, crPaise: R(1200000), tag: 'general' }
] })
createPayment({ yearId: Y24, date: '2024-04-18', partyAccountId: GIRDHARI, cashBankAccountId: CANARA, amountPaise: R(1200000), narration: 'RA bill 1 paid — UTR CNRB2404181111', tag: 'general' })
createJournal({ yearId: Y24, date: '2024-07-10', narration: 'Girdhari Thekedar — construction RA bill 2', entries: [
  { accountId: WIP, drPaise: R(1000000), crPaise: 0, tag: 'general' }, { accountId: GIRDHARI, drPaise: 0, crPaise: R(1000000), tag: 'general' }
] })
createPayment({ yearId: Y24, date: '2024-07-15', partyAccountId: GIRDHARI, cashBankAccountId: CANARA, amountPaise: R(1000000), narration: 'RA bill 2 paid — UTR CNRB2407152222', tag: 'general' })
createJournal({ yearId: Y24, date: '2024-10-20', narration: 'Girdhari Thekedar — construction RA bill 3', entries: [
  { accountId: WIP, drPaise: R(800000), crPaise: 0, tag: 'general' }, { accountId: GIRDHARI, drPaise: 0, crPaise: R(800000), tag: 'general' }
] })
createPayment({ yearId: Y24, date: '2024-10-24', partyAccountId: GIRDHARI, cashBankAccountId: CANARA, amountPaise: R(800000), narration: 'RA bill 3 paid — UTR CNRB2410243333', tag: 'general' })
createJournal({ yearId: Y24, date: '2024-07-18', narration: 'Bee Pee Electricals — panel, wiring & motors for new room (partner firm, on credit)', entries: [
  { accountId: WIP, drPaise: R(320000), crPaise: 0, tag: 'general' }, { accountId: BEEPEE, drPaise: 0, crPaise: R(320000), tag: 'general' }
] })
createPayment({ yearId: Y24, date: '2024-08-05', partyAccountId: BEEPEE, cashBankAccountId: CANARA, amountPaise: R(200000), narration: 'Part payment to Bee Pee Electricals — UTR CNRB2408054444 (partner Sarju Bansal firm)', tag: 'general' })
did('construction 2024: ₹30L Girdhari (billed+paid) + ₹3.2L Bee Pee on credit (₹2L paid, ₹1.2L carried)')

// --- term-loan servicing 2024: interest-only Apr–Sep, EMI Oct–Dec ---
for (let m = 4; m <= 9; m++) tlInterestOnly(Y24, `2024-${String(m).padStart(2, '0')}-07`)
for (let m = 10; m <= 12; m++) tlEmi(Y24, `2024-${String(m).padStart(2, '0')}-07`)
did(`term loan 2024: 6 interest-only + 3 EMIs (o/s ₹${inr(tlBal)})`)

// --- assets & misc 2024 ---
createPayment({ yearId: Y24, date: '2024-04-18', partyAccountId: OFFICE_EQ, cashBankAccountId: CASH, amountPaise: R(52000), narration: 'Computer + printer for office', tag: 'general' })
createPayment({ yearId: Y24, date: '2024-04-01', partyAccountId: INSUR_EXP, cashBankAccountId: CANARA, amountPaise: R(110000), narration: 'New India Insurance — annual cold storage policy 2024-25', tag: 'general' })
payElectricityDirect(Y24, 2024, [[3, 95000], [4, 140000], [5, 165000], [6, 180000], [7, 175000], [8, 168000], [9, 150000], [10, 120000], [11, 90000]])
for (const [d, amt, note] of [['2024-03-20', 22000, 'Genset diesel (filling season)'], ['2024-06-14', 28000, 'Genset diesel (power cuts)'], ['2024-09-08', 18500, 'Genset diesel']] as const) {
  createPayment({ yearId: Y24, date: d, partyAccountId: DIESEL_EXP, cashBankAccountId: CASH, amountPaise: R(amt), narration: `Sharma Filling Station — ${note}`, tag: 'general' })
}
createPayment({ yearId: Y24, date: '2024-05-25', partyAccountId: REPAIR_EXP, cashBankAccountId: CASH, amountPaise: R(34000), narration: 'Verma Machinery — compressor valve service', tag: 'general' })
createPayment({ yearId: Y24, date: '2024-02-10', partyAccountId: MISC_EXP, cashBankAccountId: CASH, amountPaise: R(12000), narration: 'Mahadev Tent House — filling season shamiana', tag: 'general' })
createPayment({ yearId: Y24, date: '2024-10-28', partyAccountId: WELFARE_EXP, cashBankAccountId: CASH, amountPaise: R(31000), narration: 'Diwali staff mithai + bonus sweets', tag: 'general' })
createPayment({ yearId: Y24, date: '2024-08-12', partyAccountId: MISC_EXP, cashBankAccountId: CASH, amountPaise: R(6800), narration: 'Stationery, register books, misc', tag: 'general' })
did('assets & expenses 2024: office equipment, insurance, electricity ×9, diesel ×3, repairs, tent, welfare, misc')

// --- other income 2024 ---
createReceipt({ yearId: Y24, date: '2024-04-30', partyAccountId: GRADING_INC, cashBankAccountId: CASH, amountPaise: R(46500), narration: 'Grading & sorting charges (April)', tag: 'general' })
createReceipt({ yearId: Y24, date: '2024-07-31', partyAccountId: GRADING_INC, cashBankAccountId: CASH, amountPaise: R(34000), narration: 'Grading & sorting charges (Q2)', tag: 'general' })
createReceipt({ yearId: Y24, date: '2024-06-30', partyAccountId: KANTA_INC, cashBankAccountId: CASH, amountPaise: R(31200), narration: 'Kanta tulai income Apr–Jun', tag: 'general' })
createReceipt({ yearId: Y24, date: '2024-10-31', partyAccountId: KANTA_INC, cashBankAccountId: CASH, amountPaise: R(29800), narration: 'Kanta tulai income Jul–Oct', tag: 'general' })
createReceipt({ yearId: Y24, date: '2024-12-10', partyAccountId: SCRAP_INC, cashBankAccountId: CASH, amountPaise: R(22000), narration: 'Old angle-iron & drum scrap sold', tag: 'general' })
did('other income 2024: grading ×2, kanta ×2, scrap ×1')

// --- salaries + contras + bank charges 2024 ---
payMonthlySalaries(Y24, 2024, 12)
createContra({ yearId: Y24, date: '2024-02-05', fromAccountId: CANARA, toAccountId: CASH, amountPaise: R(300000), narration: 'Withdraw for filling-season payments' })
createContra({ yearId: Y24, date: '2024-05-02', fromAccountId: CANARA, toAccountId: COOP, amountPaise: R(200000), narration: 'Bank-to-bank transfer (co-op margin)' })
createContra({ yearId: Y24, date: '2024-06-04', fromAccountId: CANARA, toAccountId: CASH, amountPaise: R(250000), narration: 'Withdraw for mid-season expenses' })
createContra({ yearId: Y24, date: '2024-09-03', fromAccountId: CANARA, toAccountId: CASH, amountPaise: R(250000), narration: 'Withdraw for late-season expenses' })
createContra({ yearId: Y24, date: '2024-11-20', fromAccountId: CASH, toAccountId: CANARA, amountPaise: R(400000), narration: 'Surplus season cash deposited' })
createContra({ yearId: Y24, date: '2024-12-02', fromAccountId: COOP, toAccountId: CASH, amountPaise: R(100000), narration: 'Withdraw from co-op for settlements' })
for (const d of ['2024-03-31', '2024-06-30', '2024-09-30', '2024-12-31']) {
  createJournal({ yearId: Y24, date: d, narration: 'Canara Bank quarterly charges (SMS + ledger folio)', entries: [
    { accountId: BANKCHG_EXP, drPaise: R(590), crPaise: 0, tag: 'general' }, { accountId: CANARA, drPaise: 0, crPaise: R(590), tag: 'general' }
  ] })
}
did('contras ×6 (incl. bank↔bank) + quarterly bank charges 2024')

// --- loan repayments 2024 ---
recordPayment(l24_suresh.loanId, R(30000), '2024-08-10', 'cash', undefined, U)
recordPayment(l24_manoj.loanId, R(80000), '2024-09-15', 'bank', CANARA, U)
const maheshDue = getLoan(l24_mahesh.loanId, '2024-11-30')!.breakdown.outstandingPaise
recordPayment(l24_mahesh.loanId, maheshDue, '2024-11-30', 'cash', undefined, U)
recordPayment(l24_ramlal.loanId, R(10000), '2024-12-05', 'cheque', CANARA, U, { no: 'BOB-334455', bank: 'BOB' })
const ramlalChq = db().select().from(chequeT).where(eq(chequeT.no, 'BOB-334455')).get()!
clearCheque(ramlalChq.id, '2024-12-12', U)
did('loan repayments 2024: part cash, part bank, FULL by cash, part by cheque (cleared)')

// --- bhada accrual + year-end journals 2024 ---
const bh24 = accrueAllRent(Y24, '2024-11-15', U)
did(`bhada accrued 2024: ${bh24.kisans} kisans, ₹${inr(bh24.totalPaise)}`)
createJournal({ yearId: Y24, date: '2024-11-16', narration: 'Rent concession to Netrapal (hail-damaged crop) — 1 packet', entries: [
  { accountId: sys('Rent/Bhada Income'), drPaise: 110 * 100, crPaise: 0, tag: 'rent' }, { accountId: NETRAPAL, drPaise: 0, crPaise: 110 * 100, tag: 'rent' }
] })
createJournal({ yearId: Y24, date: '2024-12-31', narration: 'Mandi shulk & license fee provision FY 2024', entries: [
  { accountId: MISC_EXP, drPaise: R(18000), crPaise: 0, tag: 'general' }, { accountId: MANDI_PAYABLE, drPaise: 0, crPaise: R(18000), tag: 'general' }
] })
createJournal({ yearId: Y24, date: '2024-12-31', narration: 'Depreciation 2024 — building 5%, plant 15%', entries: [
  { accountId: DEPR_EXP, drPaise: R(275000) + R(330000), crPaise: 0, tag: 'general' },
  { accountId: BUILDING, drPaise: 0, crPaise: R(275000), tag: 'general' },
  { accountId: PLANT, drPaise: 0, crPaise: R(330000), tag: 'general' }
] })
did('year-end journals 2024: rent concession, mandi shulk provision, depreciation')

// --- partner return + pending cheque at year end ---
createPayment({ yearId: Y24, date: '2024-11-25', partyAccountId: SP_CO, cashBankAccountId: CANARA, amountPaise: R(150000), narration: 'Part return of partner funds — UTR CNRB2411255555 (Satyapal Singh, SP & Company)', tag: 'general' })
recordCheque(Y24, { direction: 'received', partyAccountId: SANJAY, bankAccountId: CANARA, amountPaise: R(80000), no: 'AXIS-990011', bank: 'Axis', date: '2024-12-26', receiveDate: '2024-12-26' }, U)
did('partner part-return (UTR) + Sanjay cheque ₹80,000 left PENDING at year end (close exception)')

// --- December settlements (Manoj first repays his loan through the loan engine) ---
const manojDue24 = getLoan(l24_manoj.loanId, '2024-12-14')!.breakdown.outstandingPaise
recordPayment(l24_manoj.loanId, manojDue24, '2024-12-14', 'bank', CANARA, U)
settle(Y24, '2024-12-15', MANOJ, { note: 'Manoj Traders — final settlement 2024' })
settle(Y24, '2024-12-15', NEERAJ, { note: 'Neeraj & Sons — final settlement' })
settle(Y24, '2024-12-16', GOPALV, { note: 'Gopal Sabzi — final settlement' })
settle(Y24, '2024-12-16', ASLAM, { note: 'Aslam — final settlement' })
settle(Y24, '2024-12-17', VIPIN, { note: 'Vipin — final settlement' })
settle(Y24, '2024-12-17', RAMAVTAR_V, { mode: 'cash', note: 'Ram Avtar (vyapar) — final settlement' })
// Sanjay: his ₹80,000 pending cheque already credited his ledger; settle the remainder.
settle(Y24, '2024-12-27', SANJAY, { note: 'Sanjay Foods — settled net of pending cheque' })
// kisans: pay out proceeds minus rent/loans/bardana
settle(Y24, '2024-12-18', RAMESH, { note: 'Ramesh — proceeds paid out' })
settle(Y24, '2024-12-18', MAHESH, { note: 'Mahesh — proceeds paid out' })
settle(Y24, '2024-12-19', DINESH, { note: 'Dinesh — proceeds paid out' })
settle(Y24, '2024-12-19', RAKESH, { note: 'Rakesh — proceeds paid out' })
settle(Y24, '2024-12-20', RAMAVTAR_K, { note: 'Ram Avtar (kisan) — proceeds paid out' })
settle(Y24, '2024-12-20', NETRAPAL, { mode: 'cash', note: 'Netrapal — proceeds paid out' })
settle(Y24, '2024-12-21', CHANDRAPAL, { note: 'Chandrapal — proceeds paid out' })
const sureshDue24 = getLoan(l24_suresh.loanId, '2024-12-22')!.breakdown.outstandingPaise
recordPayment(l24_suresh.loanId, sureshDue24, '2024-12-22', 'cash', undefined, U)
settle(Y24, '2024-12-22', SURESH, { note: 'Suresh — proceeds paid out after loan recovery' })
settle(Y24, '2024-12-23', GHANSHYAM, { leaveDrPaise: R(25000), note: 'Ghanshyam — proceeds paid out; ₹25,000 reclassified loan rides' })
did('December 2024 settlements — Dharamveer, Brijesh, Ghanshyam(loan), Ramlal left owing on purpose')

// ============================================================
// CLOSE 2024 → 2025
// ============================================================
log('\n===== CLOSE YEAR 2024 =====')
const close24 = closeYear(Y24, U)
log(`  Summary: carried=${close24.summary.accountsCarried} dues=₹${inr(close24.summary.totalDuesPaise)} credits=₹${inr(close24.summary.totalCreditsPaise)} indirectLoans=${close24.summary.indirectLoans} newDefaulters=${close24.summary.newDefaulters} interestCap=₹${inr(close24.summary.interestCapitalisedPaise)} leftover=${close24.summary.leftoverPackets} pkts`)
log(`  Exceptions: ${close24.exceptions.map((e) => e.kind).join(', ') || 'none'}`)
check(close24.summary.leftoverPackets === 491, '2024 close leftover = 491 packets (1 Netrapal + 490 Chandrapal)')
check(close24.exceptions.some((e) => e.kind === 'pending_cheque'), '2024 close lists the pending Sanjay cheque')
check(getTrialBalance(Y24).balanced, 'trial balance 2024 balanced after close')

// ╔══════════════════════════════════════════════════════════╗
// ║                        YEAR 2025                          ║
// ╚══════════════════════════════════════════════════════════╝
log('\n===== YEAR 2025 =====')
setSession({ userId: U, username: 'admin', accountantName: 'Guptaji (Munim)', role: 'accountant', yearId: Y25, year: 2025 })

// --- new joiners 2025 ---
const KUNWAR = party('Kunwar Pal', 'kisan', FARMER, 2025, { sonOf: 'Bhola Singh', village: 'Etmadpur', phone: '9412001011' })
const IQBAL = party('Iqbal Traders', 'vyapari', DEBTORS, 2025, { village: 'Agra Mandi', phone: '9837002009' })
setOpeningBalance(IQBAL, Y25, R(35000), 'cr', '2025-04-01', U) // joins mid-year with an agreed advance on the books
const KALLU = party('Kallu', 'staff', CREDITORS, 2025, { job: 'Machine Operator (night)', phone: '9719003010' })
STAFF.push({ acc: KALLU, pay: 12000, mode: 'cash', from: 2025 })
const LOADER2 = party('Bhola Palledar Group', 'loading_contractor', CREDITORS, 2025, { phone: '9719006002' })
did('2025 joiners: kisan Kunwar Pal (K-25), vyapari Iqbal Traders (V-25, mid-year opening Cr), staff Kallu, contractor Bhola')

// --- carried liabilities paid ---
createPayment({ yearId: Y25, date: '2025-01-15', partyAccountId: MANDI_PAYABLE, cashBankAccountId: CANARA, amountPaise: R(18000), narration: 'Mandi shulk FY2024 deposited', tag: 'general' })
createPayment({ yearId: Y25, date: '2025-02-06', partyAccountId: BEEPEE, cashBankAccountId: CANARA, amountPaise: R(120000), narration: 'Bee Pee Electricals balance cleared — UTR CNRB2502066666 (partner Sarju Bansal firm)', tag: 'general' })
createPayment({ yearId: Y25, date: '2025-01-20', partyAccountId: BEEJ, cashBankAccountId: CASH, amountPaise: R(40000), narration: 'Jai Kisan Beej Bhandar — bardana credit cleared', tag: 'general' })
did('2025: mandi shulk paid, Bee Pee balance cleared (UTR), bardana supplier cleared')

// --- defaulter redemptions & repayments on carried indirect loans ---
function indirectLoanOf(acc: number, Y: number): number {
  const r = db().select({ id: loanT.id }).from(loanT).where(and(eq(loanT.yearId, Y), eq(loanT.accountId, acc), eq(loanT.nature, 'indirect'))).get()
  if (!r) throw new Error(`seed: no carried indirect loan for account ${acc}`)
  return r.id
}
const ghaLoan25 = indirectLoanOf(GHANSHYAM, Y25)
const ghaDue = getLoan(ghaLoan25, '2025-06-20')!.breakdown.outstandingPaise
recordPayment(ghaLoan25, ghaDue, '2025-06-20', 'cash', undefined, U)
setDefaulter(GHANSHYAM, false, U)
did(`Ghanshyam repaid carried loan in FULL (₹${inr(ghaDue)}, incl. interest) → defaulter flag REMOVED`)
const dhLoan25 = indirectLoanOf(DHARAMVEER, Y25)
const dhPart25 = Math.floor(getLoan(dhLoan25, '2025-07-14')!.breakdown.outstandingPaise / 2)
recordPayment(dhLoan25, dhPart25, '2025-07-14', 'cash', undefined, U)
const rlLoan25 = indirectLoanOf(RAMLAL, Y25)
const rlPart25 = Math.floor(getLoan(rlLoan25, '2025-09-05')!.breakdown.outstandingPaise * 0.4)
recordPayment(rlLoan25, rlPart25, '2025-09-05', 'cash', undefined, U)
did(`Dharamveer ₹${inr(dhPart25)} & Ramlal ₹${inr(rlPart25)} part-paid carried loans — both stay defaulters`)

// --- 2025 loans ---
const l25_rakesh = createLoan(Y25, { category: 'kisan', accountId: RAKESH, date: '2025-02-05', amountPaise: R(75000), mode: 'bank', bankAccountId: CANARA, nature: 'direct', remark: 'Seed + fertiliser advance' }, U)
const l25_staff = createLoan(Y25, { category: 'other', accountId: RAMSINGH, date: '2025-08-01', amountPaise: R(15000), mode: 'cash', nature: 'direct', monthlyRateBps: 0, remark: 'Staff advance — interest-free' }, U)
did('2025 loans: kisan bank loan + interest-free staff advance (0 bps)')

// --- bardana 2025 ---
createBardana(Y25, { direction: 'purchase', date: '2025-01-22', partyAccountId: null, ratePaise: R(26), qty: 6000, mode: 'bank', bankAccountId: CANARA }, U)
createBardana(Y25, { direction: 'purchase', date: '2025-02-10', partyAccountId: BEEJ, ratePaise: R(26.5), qty: 3000, paidPaise: R(50000), mode: 'cash', remark: 'Part credit' }, U)
createBardana(Y25, { direction: 'issue', date: '2025-02-15', partyAccountId: RAMESH, ratePaise: R(32), qty: 2200, mode: 'cash' }, U)
createBardana(Y25, { direction: 'issue', date: '2025-02-20', partyAccountId: KUNWAR, ratePaise: R(32), qty: 1200, paidPaise: 0, mode: 'cash', remark: 'New kisan — credit' }, U)
createBardana(Y25, { direction: 'issue', date: '2025-03-05', partyAccountId: MAHESH, ratePaise: R(33), qty: 2500, paidPaise: R(40000), mode: 'cash' }, U)
did('bardana 2025: purchases (bank + part-credit) & issues (cash/credit/partial)')

// --- filling season 2025 ---
lots.clear()
fill(Y25, 'ram25', '2025-02-10', RAMESH, 10000, [{ room: 1, floor: 1, rack: 1, packets: 5000 }, { room: 1, floor: 1, rack: 2, packets: 5000 }])
fill(Y25, 'sur25', '2025-02-12', SURESH, 8000, [{ room: 1, floor: 2, rack: 10, packets: 8000 }])
fill(Y25, 'mah25', '2025-02-15', MAHESH, 14000, [{ room: 2, floor: 1, rack: 20, packets: 5000 }, { room: 2, floor: 2, rack: 20, packets: 5000 }, { room: 2, floor: 3, rack: 20, packets: 4000 }])
fill(Y25, 'din25', '2025-02-18', DINESH, 5000, [{ room: 2, floor: 4, rack: 30, packets: 4000 }]) // 1000 pkts deliberately UNPLACED (assigned later in real life)
fill(Y25, 'rak25', '2025-02-22', RAKESH, 7000, [{ room: 3, floor: 1, rack: 40, packets: 7000 }])
fill(Y25, 'bri25', '2025-02-26', BRIJESH, 3000, [{ room: 3, floor: 2, rack: 50, packets: 3000 }])
fill(Y25, 'rav25', '2025-03-02', RAMAVTAR_K, 9000, [{ room: 4, floor: 1, rack: 60, packets: 4500 }, { room: 4, floor: 2, rack: 60, packets: 4500 }])
fill(Y25, 'gha25', '2025-03-06', GHANSHYAM, 7500, [{ room: 4, floor: 3, rack: 70, packets: 7500 }])
fill(Y25, 'cha25', '2025-03-10', CHANDRAPAL, 8000, [{ room: 5, floor: 1, rack: 80, packets: 8000 }])
fill(Y25, 'kun25', '2025-03-12', KUNWAR, 6000, [{ room: 5, floor: 2, rack: 90, packets: 6000 }])
fill(Y25, 'net25', '2025-03-14', NETRAPAL, 1, [{ room: 2, floor: 6, rack: 1, packets: 1 }])

// --- loading contractors 2025 (two, split loading/unloading) ---
setLoadingContractorYear(Y25, { accountId: LOADER1, loadingAmountPaise: R(170000), unloadingAmountPaise: null }, U)
setLoadingContractorYear(Y25, { accountId: LOADER2, loadingAmountPaise: null, unloadingAmountPaise: R(120000) }, U)
payLoadingContractor(Y25, { partyAccountId: LOADER2, amountPaise: R(60000), date: '2025-03-08', mode: 'cash', narration: 'Unloading (filling)' }, U)
payLoadingContractor(Y25, { partyAccountId: LOADER2, amountPaise: R(60000), date: '2025-03-28', mode: 'cash', narration: 'Unloading final' }, U)
payLoadingContractor(Y25, { partyAccountId: LOADER1, amountPaise: R(85000), date: '2025-07-10', mode: 'bank', bankAccountId: CANARA, narration: 'Loading (first half)' }, U)
payLoadingContractor(Y25, { partyAccountId: LOADER1, amountPaise: R(85000), date: '2025-11-15', mode: 'cash', narration: 'Loading (final)' }, U)
did('loading contractors 2025: split quotes + 4 payments')

// --- saudas + sales 2025 ---
S(Y25, '2025-04-01', MANOJ, RAMESH, 5000, 520); S(Y25, '2025-04-22', MANOJ, MAHESH, 5000, 525)
S(Y25, '2025-05-05', KRISHNA, DINESH, 4000, 515); S(Y25, '2025-05-20', NEERAJ, MAHESH, 5000, 530)
S(Y25, '2025-06-02', GOPALV, SURESH, 8000, 510); S(Y25, '2025-06-25', ASLAM, RAKESH, 7000, 522.5)
S(Y25, '2025-07-08', DHARAMVEER, BRIJESH, 3000, 505); S(Y25, '2025-07-20', VIPIN, GHANSHYAM, 7500, 518)
S(Y25, '2025-08-04', SANJAY, CHANDRAPAL, 8000, 512); S(Y25, '2025-08-18', IQBAL, KUNWAR, 6000, 528)
S(Y25, '2025-09-01', IQBAL, RAMAVTAR_K, 4000, 520); S(Y25, '2025-09-15', MANOJ, RAMESH, 5000, 526) // re-deal
S(Y25, '2025-09-20', KRISHNA, RAMAVTAR_K, 5000, 515); S(Y25, '2025-10-05', NEERAJ, MAHESH, 4000, 535)
did('14 saudas 2025')
sale(Y25, '2025-04-10', MANOJ, [{ lot: 'ram25', pkts: 5000, rate: 520 }], { vehicle: 'UP80-BA-1001', bhada: 75000 })
sale(Y25, '2025-04-28', MANOJ, [{ lot: 'mah25', pkts: 5000, rate: 525 }], { vehicle: 'UP80-BA-1002' })
sale(Y25, '2025-05-12', KRISHNA, [{ lot: 'din25', pkts: 4000, rate: 515 }], { vehicle: 'UP80-BA-1003' }) // all placed din25 out
sale(Y25, '2025-05-26', NEERAJ, [{ lot: 'mah25', pkts: 5000, rate: 530 }], { vehicle: 'UP80-BA-1004' })
sale(Y25, '2025-06-09', GOPALV, [{ lot: 'sur25', pkts: 8000, rate: 510 }], { vehicle: 'UP80-BA-1005', bhada: 110000 })
sale(Y25, '2025-06-30', ASLAM, [{ lot: 'rak25', pkts: 7000, rate: 522.5 }], { vehicle: 'UP80-BA-1006' })
sale(Y25, '2025-07-15', DHARAMVEER, [{ lot: 'bri25', pkts: 3000, rate: 505 }], { vehicle: 'UP80-BA-1007' })
sale(Y25, '2025-07-28', VIPIN, [{ lot: 'gha25', pkts: 7500, rate: 518 }], { vehicle: 'UP80-BA-1008' })
sale(Y25, '2025-08-11', SANJAY, [{ lot: 'cha25', pkts: 8000, rate: 512 }], { vehicle: 'UP80-BA-1009', bhada: 100000 })
sale(Y25, '2025-08-25', IQBAL, [{ lot: 'kun25', pkts: 6000, rate: 528 }], { vehicle: 'UP80-BA-1010' })
sale(Y25, '2025-09-08', IQBAL, [{ lot: 'rav25', pkts: 4000, rate: 520 }], { vehicle: 'UP80-BA-1011' })
sale(Y25, '2025-09-22', MANOJ, [{ lot: 'ram25', pkts: 5000, rate: 526 }], { vehicle: 'UP80-BA-1012' }) // empties ram25
sale(Y25, '2025-09-29', KRISHNA, [{ lot: 'rav25', pkts: 5000, rate: 515 }], { vehicle: 'UP80-BA-1013' }) // empties rav25
sale(Y25, '2025-10-10', NEERAJ, [{ lot: 'mah25', pkts: 4000, rate: 535 }], { vehicle: 'UP80-BA-1014' }) // empties mah25
self(Y25, '2025-10-20', 'net25', 1) // the 1-packet lot withdrawn exactly — rack empties to zero
did('2025 stock-out complete — store fully drained (clean close, no leftover)')

// --- receipts / cheques 2025 (incl. mistake → void → re-entry) ---
createReceipt({ yearId: Y25, date: '2025-05-06', partyAccountId: MANOJ, cashBankAccountId: CANARA, amountPaise: R(2000000), narration: 'Manoj part payment (bank)', tag: 'trade' })
const wrong = createReceipt({ yearId: Y25, date: '2025-07-02', partyAccountId: MANOJ, cashBankAccountId: CASH, amountPaise: R(15000), narration: 'MIS-ENTRY — meant for Neeraj & Sons', tag: 'trade' })
voidVoucher(wrong.voucherId, 'Entered against wrong party — re-entered for Neeraj & Sons', U)
createReceipt({ yearId: Y25, date: '2025-07-02', partyAccountId: NEERAJ, cashBankAccountId: CASH, amountPaise: R(15000), narration: 'Neeraj part payment (re-entry of voided voucher)', tag: 'trade' })
did('mistake receipt VOIDED and re-entered against the right party (audit trail case)')
const c5 = recordCheque(Y25, { direction: 'received', partyAccountId: GOPALV, bankAccountId: CANARA, amountPaise: R(2500000), no: 'SBI-208877', bank: 'SBI', date: '2025-06-20', receiveDate: '2025-06-20' }, U)
clearCheque(c5.chequeId, '2025-06-27', U)
const c6 = recordCheque(Y25, { direction: 'given', partyAccountId: MAHESH, bankAccountId: CANARA, amountPaise: R(2500000), no: 'CNR-25-000345', bank: 'Canara Bank', date: '2025-10-25', receiveDate: '2025-10-25' }, U)
bounceCheque(c6.chequeId, '2025-10-31', U) // our own cheque bounced (signature mismatch)
const c7 = recordCheque(Y25, { direction: 'given', partyAccountId: MAHESH, bankAccountId: CANARA, amountPaise: R(2500000), no: 'CNR-25-000346', bank: 'Canara Bank', date: '2025-11-02', receiveDate: '2025-11-02' }, U)
clearCheque(c7.chequeId, '2025-11-08', U)
createReceipt({ yearId: Y25, date: '2025-08-30', partyAccountId: SANJAY, cashBankAccountId: CANARA, amountPaise: R(2200000), narration: 'Sanjay part payment (bank)', tag: 'trade' })
createReceipt({ yearId: Y25, date: '2025-09-12', partyAccountId: VIPIN, cashBankAccountId: COOP, amountPaise: R(200000), narration: 'Vipin part payment (into co-op)', tag: 'trade' })
did('cheques 2025: received-cleared, GIVEN-bounced → re-issued cleared; part receipts')

// --- capitalise the new room; buy vehicle & compressor; expenses via UPPCL ledger ---
createJournal({ yearId: Y25, date: '2025-02-28', narration: 'Girdhari Thekedar — final construction bill (finishing)', entries: [
  { accountId: WIP, drPaise: R(480000), crPaise: 0, tag: 'general' }, { accountId: GIRDHARI, drPaise: 0, crPaise: R(480000), tag: 'general' }
] })
createPayment({ yearId: Y25, date: '2025-03-05', partyAccountId: GIRDHARI, cashBankAccountId: CANARA, amountPaise: R(480000), narration: 'Final construction bill — UTR CNRB2503057777', tag: 'general' })
createJournal({ yearId: Y25, date: '2025-06-30', narration: 'New room completed — WIP capitalised into Cold Storage Building', entries: [
  { accountId: BUILDING, drPaise: R(3800000), crPaise: 0, tag: 'general' }, { accountId: WIP, drPaise: 0, crPaise: R(3800000), tag: 'general' }
] })
setStoreConfig({ rooms: 6, floors: 6, racksPerFloor: 160 }, U)
did('new room CAPITALISED (₹38,00,000 WIP → Building); store layout expanded to 6 rooms')
createPayment({ yearId: Y25, date: '2025-05-10', partyAccountId: PLANT, cashBankAccountId: CANARA, amountPaise: R(650000), narration: 'New compressor for room 6 — Verma Machinery', tag: 'general' })
createPayment({ yearId: Y25, date: '2025-08-20', partyAccountId: VEHICLE, cashBankAccountId: CANARA, amountPaise: R(425000), narration: 'Tata Ace purchased for mandi deliveries', tag: 'general' })
createJournal({ yearId: Y25, date: '2025-04-15', narration: 'Verma Machinery — compressor overhaul bill', entries: [
  { accountId: REPAIR_EXP, drPaise: R(85000), crPaise: 0, tag: 'general' }, { accountId: VERMA, drPaise: 0, crPaise: R(85000), tag: 'general' }
] })
createPayment({ yearId: Y25, date: '2025-05-02', partyAccountId: VERMA, cashBankAccountId: CASH, amountPaise: R(85000), narration: 'Verma Machinery bill settled', tag: 'general' })
createJournal({ yearId: Y25, date: '2025-05-18', narration: 'Bee Pee Electricals — compressor spares (partner firm, on credit)', entries: [
  { accountId: REPAIR_EXP, drPaise: R(45000), crPaise: 0, tag: 'general' }, { accountId: BEEPEE, drPaise: 0, crPaise: R(45000), tag: 'general' }
] })
createPayment({ yearId: Y25, date: '2025-06-10', partyAccountId: BEEPEE, cashBankAccountId: CANARA, amountPaise: R(45000), narration: 'Bee Pee spares — UTR CNRB2506108888', tag: 'general' })
did('2025 capex: compressor ₹6.5L, Tata Ace ₹4.25L; repairs via Verma & Bee Pee ledgers')

// electricity 2025 through the UPPCL ledger — December bill left UNPAID (carried creditor)
const elec25: Array<[number, number]> = [[1, 78000], [2, 92000], [3, 132000], [4, 158000], [5, 175000], [6, 190000], [7, 186000], [8, 178000], [9, 160000], [10, 130000], [11, 98000], [12, 84000]]
for (const [m, amt] of elec25) {
  const mm = String(m).padStart(2, '0')
  createJournal({ yearId: Y25, date: `2025-${mm}-05`, narration: `UPPCL bill 2025-${mm}`, entries: [
    { accountId: ELEC_EXP, drPaise: R(amt), crPaise: 0, tag: 'general' }, { accountId: UPPCL, drPaise: 0, crPaise: R(amt), tag: 'general' }
  ] })
  if (m < 12) createPayment({ yearId: Y25, date: `2025-${mm}-18`, partyAccountId: UPPCL, cashBankAccountId: CANARA, amountPaise: R(amt), narration: `UPPCL bill 2025-${mm} paid`, tag: 'general' })
}
did('electricity 2025 billed through UPPCL ledger ×12 — December bill unpaid (creditor carried)')
createPayment({ yearId: Y25, date: '2025-04-05', partyAccountId: INSUR_EXP, cashBankAccountId: CANARA, amountPaise: R(135000), narration: 'New India Insurance — policy 2025-26 (incl. new room)', tag: 'general' })
createPayment({ yearId: Y25, date: '2025-03-22', partyAccountId: DIESEL_EXP, cashBankAccountId: CASH, amountPaise: R(26000), narration: 'Sharma Filling Station — genset diesel', tag: 'general' })
createPayment({ yearId: Y25, date: '2025-07-19', partyAccountId: DIESEL_EXP, cashBankAccountId: CASH, amountPaise: R(31000), narration: 'Genset diesel (power cuts)', tag: 'general' })
createPayment({ yearId: Y25, date: '2025-02-08', partyAccountId: MISC_EXP, cashBankAccountId: CASH, amountPaise: R(13500), narration: 'Mahadev Tent House — filling season', tag: 'general' })
createPayment({ yearId: Y25, date: '2025-09-03', partyAccountId: WELFARE_EXP, cashBankAccountId: CASH, amountPaise: R(7000), narration: 'Dr. Rajeev Clinic — staff medical (Raju injury)', tag: 'general' })
createPayment({ yearId: Y25, date: '2025-10-17', partyAccountId: WELFARE_EXP, cashBankAccountId: CASH, amountPaise: R(36000), narration: 'Diwali staff welfare', tag: 'general' })
createPayment({ yearId: Y25, date: '2025-06-11', partyAccountId: MISC_EXP, cashBankAccountId: CASH, amountPaise: R(9200), narration: 'Agra Transport — misc freight inward', tag: 'general' })
did('2025 expenses: insurance, diesel ×2, tent, medical, welfare, freight')

// --- other income 2025 ---
createReceipt({ yearId: Y25, date: '2025-04-30', partyAccountId: GRADING_INC, cashBankAccountId: CASH, amountPaise: R(52000), narration: 'Grading & sorting charges', tag: 'general' })
createReceipt({ yearId: Y25, date: '2025-08-31', partyAccountId: GRADING_INC, cashBankAccountId: CASH, amountPaise: R(38500), narration: 'Grading & sorting charges', tag: 'general' })
createReceipt({ yearId: Y25, date: '2025-06-30', partyAccountId: KANTA_INC, cashBankAccountId: CASH, amountPaise: R(34800), narration: 'Kanta tulai Apr–Jun', tag: 'general' })
createReceipt({ yearId: Y25, date: '2025-10-31', partyAccountId: KANTA_INC, cashBankAccountId: CASH, amountPaise: R(28400), narration: 'Kanta tulai Jul–Oct', tag: 'general' })
createReceipt({ yearId: Y25, date: '2025-09-25', partyAccountId: TEMPO_INC, cashBankAccountId: CASH, amountPaise: R(12000), narration: 'Tata Ace hired out to Sanjay Foods (3 trips)', tag: 'general' })
createReceipt({ yearId: Y25, date: '2025-12-15', partyAccountId: SCRAP_INC, cashBankAccountId: CASH, amountPaise: R(15000), narration: 'Old bardana + drum scrap', tag: 'general' })
did('other income 2025: grading ×2, kanta ×2, tempo freight, scrap')

// --- salaries, EMIs, contras, charges 2025 ---
payMonthlySalaries(Y25, 2025, 12)
for (let m = 1; m <= 12; m++) tlEmi(Y25, `2025-${String(m).padStart(2, '0')}-07`)
did(`term loan 2025: 12 EMIs (o/s ₹${inr(tlBal)})`)
createContra({ yearId: Y25, date: '2025-02-03', fromAccountId: CANARA, toAccountId: CASH, amountPaise: R(350000), narration: 'Withdraw for filling season' })
createContra({ yearId: Y25, date: '2025-06-02', fromAccountId: CANARA, toAccountId: CASH, amountPaise: R(300000), narration: 'Withdraw for mid-season' })
createContra({ yearId: Y25, date: '2025-09-01', fromAccountId: CANARA, toAccountId: CASH, amountPaise: R(300000), narration: 'Withdraw for late season' })
createContra({ yearId: Y25, date: '2025-11-28', fromAccountId: CASH, toAccountId: CANARA, amountPaise: R(600000), narration: 'Season surplus deposited' })
createContra({ yearId: Y25, date: '2025-07-01', fromAccountId: COOP, toAccountId: CANARA, amountPaise: R(50000), narration: 'Co-op → Canara (consolidating funds)' })
for (const d of ['2025-03-31', '2025-06-30', '2025-09-30', '2025-12-31']) {
  createJournal({ yearId: Y25, date: d, narration: 'Canara Bank quarterly charges', entries: [
    { accountId: BANKCHG_EXP, drPaise: R(640), crPaise: 0, tag: 'general' }, { accountId: CANARA, drPaise: 0, crPaise: R(640), tag: 'general' }
  ] })
}
did('contras ×5 + quarterly bank charges 2025')

// --- partner moves 2025 ---
createPayment({ yearId: Y25, date: '2025-06-28', partyAccountId: SP_CO, cashBankAccountId: CANARA, amountPaise: R(200000), narration: 'Return of partner funds — UTR CNRB2506289999 (SP & Company)', tag: 'general' })
createPayment({ yearId: Y25, date: '2025-12-20', partyAccountId: SP_CO, cashBankAccountId: CANARA, amountPaise: R(100000), narration: 'Return of partner funds — UTR CNRB2512200001 (SP & Company)', tag: 'general' })
did('partner returns 2025 (SP & Company, UTR narrations)')

// --- loan repayments 2025 ---
const rakDue25 = getLoan(l25_rakesh.loanId, '2025-11-10')!.breakdown.outstandingPaise
recordPayment(l25_rakesh.loanId, rakDue25, '2025-11-10', 'bank', CANARA, U)
recordPayment(l25_staff.loanId, R(15000), '2025-11-30', 'cash', undefined, U) // zero-rate → zero interest
did('2025 repayments: Rakesh FULL (bank), staff advance FULL (zero interest)')

// --- bhada + year-end 2025 ---
const bh25 = accrueAllRent(Y25, '2025-11-20', U)
did(`bhada accrued 2025: ${bh25.kisans} kisans, ₹${inr(bh25.totalPaise)}`)
createJournal({ yearId: Y25, date: '2025-12-31', narration: 'Mandi shulk & license fee provision FY 2025', entries: [
  { accountId: MISC_EXP, drPaise: R(21000), crPaise: 0, tag: 'general' }, { accountId: MANDI_PAYABLE, drPaise: 0, crPaise: R(21000), tag: 'general' }
] })
createJournal({ yearId: Y25, date: '2025-12-31', narration: 'Depreciation 2025 — building (incl. new room, half-year) + plant + vehicle', entries: [
  { accountId: DEPR_EXP, drPaise: R(356250) + R(378000) + R(31875), crPaise: 0, tag: 'general' },
  { accountId: BUILDING, drPaise: 0, crPaise: R(356250), tag: 'general' },
  { accountId: PLANT, drPaise: 0, crPaise: R(378000), tag: 'general' },
  { accountId: VEHICLE, drPaise: 0, crPaise: R(31875), tag: 'general' }
] })
did('year-end journals 2025: mandi provision, depreciation (3 assets)')

// --- December 2025 settlements ---
for (const [acc, note] of [
  [MANOJ, 'Manoj'], [KRISHNA, 'Krishna'], [NEERAJ, 'Neeraj'], [GOPALV, 'Gopal Sabzi'], [ASLAM, 'Aslam'],
  [VIPIN, 'Vipin'], [SANJAY, 'Sanjay'], [IQBAL, 'Iqbal'], [RAMAVTAR_V, 'Ram Avtar (vyapar)']
] as Array<[number, string]>) settle(Y25, '2025-12-10', acc, { note: `${note} — final settlement 2025` })
for (const [acc, note] of [
  [RAMESH, 'Ramesh'], [SURESH, 'Suresh'], [MAHESH, 'Mahesh'], [DINESH, 'Dinesh'], [RAKESH, 'Rakesh'],
  [RAMAVTAR_K, 'Ram Avtar (kisan)'], [GHANSHYAM, 'Ghanshyam'], [NETRAPAL, 'Netrapal'], [CHANDRAPAL, 'Chandrapal'], [KUNWAR, 'Kunwar Pal']
] as Array<[number, string]>) settle(Y25, '2025-12-12', acc, { note: `${note} — proceeds paid out 2025` })
// Brijesh pays only part of his carried + this-year dues → stays defaulter a second year
const briBal = bal(BRIJESH, Y25)
if (briBal > R(10000)) {
  createReceipt({ yearId: Y25, date: '2025-12-18', partyAccountId: BRIJESH, cashBankAccountId: CASH, amountPaise: briBal - R(10000), narration: 'Brijesh part payment — ₹10,000 still due', tag: 'trade' })
} else if (briBal < 0) {
  settle(Y25, '2025-12-18', BRIJESH, { leaveDrPaise: R(10000), note: 'Brijesh — settled leaving ₹10,000 due' })
}
did('December 2025 settlements — Brijesh left owing ₹10,000; Dharamveer & Ramlal still owing')

// ============================================================
// CLOSE 2025 → 2026
// ============================================================
log('\n===== CLOSE YEAR 2025 =====')
const close25 = closeYear(Y25, U)
log(`  Summary: carried=${close25.summary.accountsCarried} dues=₹${inr(close25.summary.totalDuesPaise)} credits=₹${inr(close25.summary.totalCreditsPaise)} indirectLoans=${close25.summary.indirectLoans} newDefaulters=${close25.summary.newDefaulters} interestCap=₹${inr(close25.summary.interestCapitalisedPaise)} leftover=${close25.summary.leftoverPackets} pkts`)
log(`  Exceptions: ${close25.exceptions.map((e) => e.kind).join(', ') || 'none'}`)
check(close25.summary.leftoverPackets === 0, '2025 close leftover = 0 (store fully drained)')
check(getTrialBalance(Y25).balanced, 'trial balance 2025 balanced after close')

// ╔══════════════════════════════════════════════════════════╗
// ║                YEAR 2026 (to 10 July 2026)                ║
// ╚══════════════════════════════════════════════════════════╝
log('\n===== YEAR 2026 (Jan 1 – Jul 10) =====')
setSession({ userId: U, username: 'admin', accountantName: 'Nikhil', role: 'accountant', yearId: Y26, year: 2026 })

// carried liabilities
createPayment({ yearId: Y26, date: '2026-01-12', partyAccountId: MANDI_PAYABLE, cashBankAccountId: CANARA, amountPaise: R(21000), narration: 'Mandi shulk FY2025 deposited', tag: 'general' })
createPayment({ yearId: Y26, date: '2026-01-18', partyAccountId: UPPCL, cashBankAccountId: CANARA, amountPaise: R(84000), narration: 'UPPCL December 2025 bill cleared', tag: 'general' })
did('2026: carried mandi shulk + UPPCL December bill paid')

// Ramlal redeems fully; Dharamveer pays part; Brijesh pays out
const ramlalLoan26 = indirectLoanOf(RAMLAL, Y26)
const ramlalDue26 = getLoan(ramlalLoan26, '2026-03-14')!.breakdown.outstandingPaise
recordPayment(ramlalLoan26, ramlalDue26, '2026-03-14', 'cash', undefined, U)
setDefaulter(RAMLAL, false, U)
did(`Ramlal repaid carried loan FULL (₹${inr(ramlalDue26)}) → defaulter flag REMOVED`)
const dhLoan26 = indirectLoanOf(DHARAMVEER, Y26)
recordPayment(dhLoan26, Math.floor(getLoan(dhLoan26, '2026-05-20')!.breakdown.outstandingPaise / 2), '2026-05-20', 'cash', undefined, U)
const briLoan26 = indirectLoanOf(BRIJESH, Y26)
const briDue26 = getLoan(briLoan26, '2026-04-10')!.breakdown.outstandingPaise
recordPayment(briLoan26, briDue26, '2026-04-10', 'cash', undefined, U)
setDefaulter(BRIJESH, false, U)
did('Dharamveer part-paid (still defaulter); Brijesh cleared → flag removed')

// new loans 2026
const l26_dinesh = createLoan(Y26, { category: 'kisan', accountId: DINESH, date: '2026-02-12', amountPaise: R(90000), mode: 'bank', bankAccountId: CANARA, nature: 'direct', remark: 'Tractor repair advance' }, U)
createLoan(Y26, { category: 'vyapari', accountId: NEERAJ, date: '2026-05-02', amountPaise: R(120000), mobile: '9837002004', mode: 'cash', nature: 'direct', monthlyRateBps: 175, remark: 'Mandi working capital @1.75%' }, U)
recordPayment(l26_dinesh.loanId, R(90000), '2026-02-12', 'bank', CANARA, U) // same-day full repayment → zero interest
did('2026 loans: Dinesh (bank, repaid SAME DAY — zero interest), Neeraj @1.75%')

// bardana 2026 — including an UNDELIVERED pre-booking (open as of today)
createBardana(Y26, { direction: 'purchase', date: '2026-01-20', partyAccountId: null, ratePaise: R(27), qty: 7000, mode: 'bank', bankAccountId: CANARA }, U)
createBardana(Y26, { direction: 'issue', date: '2026-02-08', partyAccountId: RAMESH, ratePaise: R(33), qty: 2000, mode: 'cash' }, U)
createBardana(Y26, { direction: 'issue', date: '2026-02-14', partyAccountId: MAHESH, ratePaise: R(33), qty: 2800, paidPaise: R(50000), mode: 'cash' }, U)
createBardana(Y26, { direction: 'issue', date: '2026-06-25', partyAccountId: NEERAJ, ratePaise: R(34), qty: 1000, mode: 'cash', prebooked: true, remark: 'Pre-booked for next filling — NOT yet delivered' }, U)
did('bardana 2026: purchase + issues + OPEN pre-booking (reserved stock)')

// filling season 2026 — first use of new room 6
lots.clear()
fill(Y26, 'ram26', '2026-02-05', RAMESH, 9000, [{ room: 1, floor: 1, rack: 1, packets: 4500 }, { room: 1, floor: 1, rack: 2, packets: 4500 }])
fill(Y26, 'sur26', '2026-02-09', SURESH, 8500, [{ room: 1, floor: 3, rack: 10, packets: 8500 }])
fill(Y26, 'mah26', '2026-02-13', MAHESH, 15000, [{ room: 2, floor: 1, rack: 20, packets: 7500 }, { room: 2, floor: 2, rack: 20, packets: 7500 }])
fill(Y26, 'din26', '2026-02-17', DINESH, 7000, [{ room: 2, floor: 4, rack: 30, packets: 7000 }])
fill(Y26, 'rak26', '2026-02-21', RAKESH, 8000, [{ room: 3, floor: 1, rack: 40, packets: 8000 }])
fill(Y26, 'bri26', '2026-02-25', BRIJESH, 3500, [{ room: 3, floor: 3, rack: 50, packets: 3500 }])
fill(Y26, 'rav26', '2026-03-01', RAMAVTAR_K, 9500, [{ room: 4, floor: 1, rack: 60, packets: 9500 }])
fill(Y26, 'gha26', '2026-03-05', GHANSHYAM, 8000, [{ room: 4, floor: 4, rack: 70, packets: 8000 }])
fill(Y26, 'cha26', '2026-03-09', CHANDRAPAL, 9000, [{ room: 5, floor: 1, rack: 80, packets: 9000 }])
fill(Y26, 'kun26', '2026-03-13', KUNWAR, 7000, [{ room: 6, floor: 1, rack: 10, packets: 4000 }, { room: 6, floor: 2, rack: 10, packets: 3000 }]) // NEW ROOM 6
fill(Y26, 'net26', '2026-03-20', NETRAPAL, 4500, [{ room: 2, floor: 6, rack: 5, packets: 4500 }])

// loading contractors 2026
setLoadingContractorYear(Y26, { accountId: LOADER1, loadingAmountPaise: R(180000), unloadingAmountPaise: null }, U)
setLoadingContractorYear(Y26, { accountId: LOADER2, loadingAmountPaise: null, unloadingAmountPaise: R(130000) }, U)
payLoadingContractor(Y26, { partyAccountId: LOADER2, amountPaise: R(70000), date: '2026-03-12', mode: 'cash', narration: 'Unloading (filling)' }, U)
payLoadingContractor(Y26, { partyAccountId: LOADER2, amountPaise: R(60000), date: '2026-03-30', mode: 'cash', narration: 'Unloading final' }, U)
payLoadingContractor(Y26, { partyAccountId: LOADER1, amountPaise: R(60000), date: '2026-06-15', mode: 'bank', bankAccountId: CANARA, narration: 'Loading (season so far)' }, U)
did('loading contractors 2026: quotes + 3 payments to date')

// saudas + sales Apr–Jul 8 (season ~45% done)
S(Y26, '2026-04-02', MANOJ, RAMESH, 4500, 545); S(Y26, '2026-04-15', KRISHNA, MAHESH, 7500, 550)
S(Y26, '2026-05-01', GOPALV, SURESH, 8500, 540); S(Y26, '2026-05-18', ASLAM, RAKESH, 4000, 552.5)
S(Y26, '2026-06-03', VIPIN, GHANSHYAM, 4000, 548); S(Y26, '2026-06-20', IQBAL, KUNWAR, 4000, 555)
S(Y26, '2026-07-01', NEERAJ, CHANDRAPAL, 4500, 558)
did('7 saudas 2026 (to date)')
sale(Y26, '2026-04-10', MANOJ, [{ lot: 'ram26', pkts: 4500, rate: 545 }], { vehicle: 'UP80-CA-2001', bhada: 70000 })
sale(Y26, '2026-04-24', KRISHNA, [{ lot: 'mah26', pkts: 7500, rate: 550 }], { vehicle: 'UP80-CA-2002' })
sale(Y26, '2026-05-08', GOPALV, [{ lot: 'sur26', pkts: 8500, rate: 540 }], { vehicle: 'UP80-CA-2003', bhada: 115000 })
sale(Y26, '2026-05-25', ASLAM, [{ lot: 'rak26', pkts: 4000, rate: 552.5 }], { vehicle: 'UP80-CA-2004' })
sale(Y26, '2026-06-10', VIPIN, [{ lot: 'gha26', pkts: 4000, rate: 548 }], { vehicle: 'UP80-CA-2005' })
sale(Y26, '2026-06-28', IQBAL, [{ lot: 'kun26', pkts: 4000, rate: 555 }], { vehicle: 'UP80-CA-2006' }) // out of the new room
sale(Y26, '2026-07-08', NEERAJ, [{ lot: 'cha26', pkts: 4500, rate: 558 }], { vehicle: 'UP80-CA-2007' })
self(Y26, '2026-06-18', 'rav26', 1500) // kisan takes some home for family use
did('7 gate passes + 1 self-withdrawal 2026 — store still ~55% full')

// receipts / cheques 2026
createReceipt({ yearId: Y26, date: '2026-04-20', partyAccountId: MANOJ, cashBankAccountId: CANARA, amountPaise: R(1500000), narration: 'Manoj part payment (bank)', tag: 'trade' })
const c8 = recordCheque(Y26, { direction: 'received', partyAccountId: KRISHNA, bankAccountId: CANARA, amountPaise: R(2500000), no: 'ICICI-445566', bank: 'ICICI', date: '2026-05-05', receiveDate: '2026-05-05' }, U)
clearCheque(c8.chequeId, '2026-05-12', U)
createReceipt({ yearId: Y26, date: '2026-05-30', partyAccountId: GOPALV, cashBankAccountId: CASH, amountPaise: R(200000), narration: 'Gopal Sabzi part payment', tag: 'trade' })
createReceipt({ yearId: Y26, date: '2026-06-08', partyAccountId: GOPALV, cashBankAccountId: CANARA, amountPaise: R(3800000), narration: 'Gopal Sabzi part payment (RTGS)', tag: 'trade' })
const c9 = recordCheque(Y26, { direction: 'given', partyAccountId: SURESH, bankAccountId: CANARA, amountPaise: R(1800000), no: 'CNR-26-000501', bank: 'Canara Bank', date: '2026-06-05', receiveDate: '2026-06-05' }, U)
clearCheque(c9.chequeId, '2026-06-11', U)
recordCheque(Y26, { direction: 'received', partyAccountId: ASLAM, bankAccountId: CANARA, amountPaise: R(1200000), no: 'SBI-309988', bank: 'SBI', date: '2026-07-05', receiveDate: '2026-07-05' }, U)
did('2026 money: part receipts, cheque cleared in/out, Aslam cheque ₹12,00,000 PENDING as of today')

// partner + expenses + income 2026
createReceipt({ yearId: Y26, date: '2026-02-02', partyAccountId: SP_CO, cashBankAccountId: CANARA, amountPaise: R(150000), narration: 'UTR CNRB2602020011 — SP & Company working funds for filling season (partner Satyapal Singh)', tag: 'general' })
createJournal({ yearId: Y26, date: '2026-03-16', narration: 'Bee Pee Electricals — panel maintenance (partner firm)', entries: [
  { accountId: REPAIR_EXP, drPaise: R(38000), crPaise: 0, tag: 'general' }, { accountId: BEEPEE, drPaise: 0, crPaise: R(38000), tag: 'general' }
] })
createPayment({ yearId: Y26, date: '2026-04-08', partyAccountId: BEEPEE, cashBankAccountId: CANARA, amountPaise: R(38000), narration: 'Bee Pee maintenance — UTR CNRB2604080022', tag: 'general' })
did('partner transactions 2026 (SP & Co funds in, Bee Pee billed & paid, UTRs)')
payElectricityDirect(Y26, 2026, [[1, 80000], [2, 96000], [3, 138000], [4, 162000], [5, 178000], [6, 192000]])
createPayment({ yearId: Y26, date: '2026-04-06', partyAccountId: INSUR_EXP, cashBankAccountId: CANARA, amountPaise: R(140000), narration: 'New India Insurance — policy 2026-27', tag: 'general' })
createPayment({ yearId: Y26, date: '2026-03-25', partyAccountId: DIESEL_EXP, cashBankAccountId: CASH, amountPaise: R(24000), narration: 'Genset diesel (filling season)', tag: 'general' })
createPayment({ yearId: Y26, date: '2026-02-10', partyAccountId: MISC_EXP, cashBankAccountId: CASH, amountPaise: R(14000), narration: 'Mahadev Tent House — filling season', tag: 'general' })
createReceipt({ yearId: Y26, date: '2026-04-30', partyAccountId: GRADING_INC, cashBankAccountId: CASH, amountPaise: R(56000), narration: 'Grading & sorting charges', tag: 'general' })
createReceipt({ yearId: Y26, date: '2026-06-30', partyAccountId: KANTA_INC, cashBankAccountId: CASH, amountPaise: R(33600), narration: 'Kanta tulai Apr–Jun', tag: 'general' })
createReceipt({ yearId: Y26, date: '2026-05-22', partyAccountId: TEMPO_INC, cashBankAccountId: CASH, amountPaise: R(9000), narration: 'Tata Ace hired out (2 trips)', tag: 'general' })
did('2026 expenses (electricity ×6, insurance, diesel, tent) + income (grading, kanta, tempo)')

// salaries Jan–Jun, EMIs Jan–Jul, contras, charges
payMonthlySalaries(Y26, 2026, 6)
for (let m = 1; m <= 7; m++) tlEmi(Y26, `2026-${String(m).padStart(2, '0')}-07`)
did(`term loan 2026: 7 EMIs to date (o/s ₹${inr(tlBal)})`)
createContra({ yearId: Y26, date: '2026-02-02', fromAccountId: CANARA, toAccountId: CASH, amountPaise: R(350000), narration: 'Withdraw for filling season' })
createContra({ yearId: Y26, date: '2026-05-04', fromAccountId: CANARA, toAccountId: CASH, amountPaise: R(300000), narration: 'Withdraw for season expenses' })
createContra({ yearId: Y26, date: '2026-06-30', fromAccountId: CASH, toAccountId: CANARA, amountPaise: R(100000), narration: 'Surplus cash deposited' })
for (const d of ['2026-03-31', '2026-06-30']) {
  createJournal({ yearId: Y26, date: d, narration: 'Canara Bank quarterly charges', entries: [
    { accountId: BANKCHG_EXP, drPaise: R(640), crPaise: 0, tag: 'general' }, { accountId: CANARA, drPaise: 0, crPaise: R(640), tag: 'general' }
  ] })
}
did('contras ×3 + bank charges 2026')

// bhada accrued once filling is complete (full-year rent on stored qty)
const bh26 = accrueAllRent(Y26, '2026-04-25', U)
did(`bhada accrued 2026: ${bh26.kisans} kisans, ₹${inr(bh26.totalPaise)}`)

// ============================================================
// NEGATIVE / EDGE CASES — every one of these MUST reject
// ============================================================
log('\n===== NEGATIVE / EDGE CASES (must reject) =====')
expectReject('nikasi over-stock (draw > available)', () => createNikasi(Y26, { date: '2026-07-09', deliveredToType: 'vyapari', deliveredToAccountId: MANOJ, lines: [{ aamadId: lots.get('ram26')!.id, packets: 999999, weightKg: 50000000, ratePaise: R(500) }] }, U))
expectReject('aamad locations exceed total', () => createAamad(Y26, { date: '2026-03-01', kisanAccountId: RAMESH, totalPackets: 100, locations: [{ room: 1, floor: 1, rack: 3, packets: 150 }] }, U))
expectReject('aamad rack out of bounds', () => createAamad(Y26, { date: '2026-03-01', kisanAccountId: RAMESH, totalPackets: 10, locations: [{ room: 1, floor: 1, rack: 9999, packets: 10 }] }, U))
expectReject('aamad room beyond store config', () => createAamad(Y26, { date: '2026-03-01', kisanAccountId: RAMESH, totalPackets: 10, locations: [{ room: 7, floor: 1, rack: 1, packets: 10 }] }, U))
expectReject('aamad zero total', () => createAamad(Y26, { date: '2026-03-01', kisanAccountId: RAMESH, totalPackets: 0, locations: [] }, U))
expectReject('nikasi zero lines', () => createNikasi(Y26, { date: '2026-07-09', deliveredToType: 'vyapari', deliveredToAccountId: MANOJ, lines: [] }, U))
expectReject('nikasi negative rate', () => createNikasi(Y26, { date: '2026-07-09', deliveredToType: 'vyapari', deliveredToAccountId: MANOJ, lines: [{ aamadId: lots.get('ram26')!.id, packets: 1, ratePaise: -5 }] }, U))
expectReject('sauda zero packets', () => createSauda(Y26, { date: '2026-07-09', vyapariAccountId: MANOJ, kisanAccountId: RAMESH, packets: 0, ratePaise: R(500) }, U))
expectReject('loan amount zero', () => createLoan(Y26, { category: 'kisan', accountId: RAMESH, date: '2026-07-09', amountPaise: 0, mode: 'cash', nature: 'direct' }, U))
expectReject('cheque loan without cheque number', () => createLoan(Y26, { category: 'kisan', accountId: RAMESH, date: '2026-07-09', amountPaise: R(1000), mode: 'cheque', bankAccountId: CANARA, nature: 'direct' }, U))
expectReject('indirect cheque loan (moves no money)', () => createLoan(Y26, { category: 'kisan', accountId: RAMESH, date: '2026-07-09', amountPaise: R(1000), mode: 'cheque', bankAccountId: CANARA, chequeNo: 'X-1', nature: 'indirect' }, U))
expectReject('bank loan without bank account', () => createLoan(Y26, { category: 'kisan', accountId: RAMESH, date: '2026-07-09', amountPaise: R(1000), mode: 'bank', nature: 'direct' }, U))
expectReject('loan repayment exceeds outstanding', () => recordPayment(l26_dinesh.loanId, R(99999999), '2026-07-09', 'cash', undefined, U))
expectReject('contra same account', () => createContra({ yearId: Y26, date: '2026-07-09', fromAccountId: CASH, toAccountId: CASH, amountPaise: R(100) }))
expectReject('contra through a party account', () => createContra({ yearId: Y26, date: '2026-07-09', fromAccountId: RAMESH, toAccountId: CASH, amountPaise: R(100) }))
expectReject('receipt into a party account (not Cash and Bank)', () => createReceipt({ yearId: Y26, date: '2026-07-09', partyAccountId: MANOJ, cashBankAccountId: RAMESH, amountPaise: R(100), tag: 'trade' }))
expectReject('unbalanced journal', () => createJournal({ yearId: Y26, date: '2026-07-09', narration: 'bad', entries: [{ accountId: CASH, drPaise: R(100), crPaise: 0 }, { accountId: RAMESH, drPaise: 0, crPaise: R(90) }] }))
expectReject('journal entry both Dr and Cr', () => createJournal({ yearId: Y26, date: '2026-07-09', narration: 'bad', entries: [{ accountId: CASH, drPaise: R(100), crPaise: R(100) }, { accountId: RAMESH, drPaise: 0, crPaise: 0 }] }))
expectReject('zero-total voucher', () => createJournal({ yearId: Y26, date: '2026-07-09', narration: 'bad', entries: [{ accountId: CASH, drPaise: 0, crPaise: 0 }, { accountId: RAMESH, drPaise: 0, crPaise: 0 }] }))
expectReject('negative amounts in voucher', () => createJournal({ yearId: Y26, date: '2026-07-09', narration: 'bad', entries: [{ accountId: CASH, drPaise: -100, crPaise: 0 }, { accountId: RAMESH, drPaise: 0, crPaise: -100 }] }))
expectReject('bardana zero qty', () => createBardana(Y26, { direction: 'purchase', date: '2026-07-09', partyAccountId: null, ratePaise: R(25), qty: 0, mode: 'cash' }, U))
expectReject('bardana paid more than deal amount', () => createBardana(Y26, { direction: 'issue', date: '2026-07-09', partyAccountId: RAMESH, ratePaise: R(30), qty: 10, paidPaise: R(400), mode: 'cash' }, U))
expectReject('bardana credit without a party', () => createBardana(Y26, { direction: 'issue', date: '2026-07-09', partyAccountId: null, ratePaise: R(30), qty: 10, paidPaise: 0, mode: 'cash' }, U))
expectReject('prebooked bardana PURCHASE', () => createBardana(Y26, { direction: 'purchase', date: '2026-07-09', partyAccountId: RAMESH, ratePaise: R(25), qty: 10, mode: 'cash', prebooked: true }, U))
expectReject('bank account outside Cash and Bank subgroup', () => createAccount({ name: 'Bad Bank', type: 'bank', subgroupId: FARMER }, 2026))
expectReject('kisan filed into Cash and Bank subgroup', () => createAccount({ name: 'Bad Kisan', type: 'kisan', subgroupId: CASHBANK }, 2026))
expectReject('opening balance on Opening Balance Equity itself', () => setOpeningBalance(sys('Opening Balance Equity'), Y26, R(100), 'dr', '2026-01-01', U))
expectReject('zero opening balance', () => setOpeningBalance(RAMESH, Y26, 0, 'dr', '2026-01-01', U))
expectReject('delete account with ledger history', () => deleteAccount(RAMESH, U))
expectReject('delete system account', () => deleteAccount(CASH, U))
expectReject('delete person still linked to accounts', () => deletePerson(ramAvtarPerson, U))
expectReject('re-void an already-voided voucher', () => voidVoucher(wrong.voucherId, 'again', U))
expectReject('close an already-closed year', () => closeYear(Y24, U))
expectReject('duplicate financial year', () => createYear(2024))
expectReject('login with wrong password', () => login(2026, 'admin', 'wrong-password'))
expectReject('login into a year that does not exist', () => login(1999, 'admin', 'admin123'))
expectReject('store config beyond maximum', () => setStoreConfig({ rooms: 99, floors: 6, racksPerFloor: 160 }, U))

// ============================================================
// VERIFICATION REPORT
// ============================================================
log('\n===== VERIFICATION =====')
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function count(table: any, cond: any): number {
  return db().select({ n: sql<number>`count(*)` }).from(table).where(cond).get()!.n
}
for (const [Y, yr] of [[Y24, 2024], [Y25, 2025], [Y26, 2026]] as Array<[number, number]>) {
  const tb = getTrialBalance(Y)
  const vch = count(voucherT, and(eq(voucherT.yearId, Y), isNull(voucherT.voidedAt)))
  const am = count(aamadT, eq(aamadT.yearId, Y))
  const nk = count(nikasiT, eq(nikasiT.yearId, Y))
  const sd = count(saudaT, eq(saudaT.yearId, Y))
  const ln = count(loanT, eq(loanT.yearId, Y))
  const bd = count(bardanaT, eq(bardanaT.yearId, Y))
  const stock = getMap(Y, 'current').totalPackets
  const ba = getBardanaAccount(Y)
  check(tb.balanced, `${yr}: trial balance balanced (Dr = Cr = ₹${inr(tb.totalDr)})`)
  log(`  ${yr}: vouchers=${vch} aamad=${am} nikasi=${nk} sauda=${sd} loans=${ln} bardana=${bd} | stock=${stock} pkts | bardana stock=${ba.stockCount} reserved=${ba.reservedQty} profit=₹${inr(ba.profitPaise)}`)
}
check(getMap(Y24, 'current').totalPackets === 491, '2024 map shows the 491 leftover packets')
check(getMap(Y25, 'current').totalPackets === 0, '2025 map fully drained')
check(getMap(Y26, 'current').totalPackets > 40000, '2026 store still holds stock (season in progress)')
const pendingCheques = db().select({ n: sql<number>`count(*)` }).from(chequeT).where(eq(chequeT.status, 'pending')).get()!.n
check(pendingCheques === 2, `exactly 2 cheques still pending (2024 Sanjay + 2026 Aslam) — got ${pendingCheques}`)
check(bal(CASH, Y26) >= 0, `2026 cash in hand not negative (₹${inr(bal(CASH, Y26))})`)
check(bal(CANARA, Y26) >= 0, `2026 Canara balance not negative (₹${inr(bal(CANARA, Y26))})`)
check(bal(COOP, Y26) >= 0, `2026 co-op balance not negative (₹${inr(bal(COOP, Y26))})`)
log(`  Cash 2026: ₹${inr(bal(CASH, Y26))} | Canara 2026: ₹${inr(bal(CANARA, Y26))} | Co-op 2026: ₹${inr(bal(COOP, Y26))} | Term loan o/s: ₹${inr(-bal(TERM_LOAN, Y26))}`)

log(`\n=== DONE — ${ok} operations OK, ${failures.length} failures ===`)
if (failures.length) { for (const f of failures) log('  ✗ ' + f); process.exitCode = 1 }
closeDb()
