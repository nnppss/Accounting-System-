import { formatINR } from '../../shared/money'
import type {
  BardanaRow,
  Bill,
  BillLoanLine,
  BillSection,
  ExpenseRow,
  LedgerLine,
  NikasiDetail,
  TrialBalance,
  VoucherDetail
} from '../../shared/contracts'
import type { EntryTag, VoucherType } from '../../shared/enums'

/**
 * Print templates — **pure** functions that turn a DTO into a self-contained HTML string
 * (architecture.md §8: "HTML templates rendered to PDF via Electron"). They never touch the DB or
 * Electron, so they are unit-tested directly; `printing/print.ts` fetches the DTO, calls one of
 * these, and feeds the HTML to `webContents.printToPDF`.
 *
 * Every label is **bilingual** (English / हिन्दी) per the v1 requirement — rendered as
 * "English / हिन्दी" so a single template serves both readers without an i18n runtime in main.
 */

/** A bilingual label: "English / हिन्दी". */
function L(en: string, hi: string): string {
  return `${en} / ${hi}`
}

/** Escape text that goes into HTML (names, narrations) so it can't break the markup. */
function esc(s: string | null | undefined): string {
  if (s === null || s === undefined) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** A signed ledger balance the accountant's way: amount + Dr/Cr. */
function balanceLabel(paise: number): string {
  if (paise === 0) return formatINR(0)
  return `${formatINR(Math.abs(paise))} ${paise > 0 ? 'Dr' : 'Cr'}`
}

/**
 * A balance as a colour-coded pill so the eye lands on who owes whom. Dr (party owes the cold) is
 * the accent colour; Cr (the cold owes the party) is amber; a settled account is neutral grey.
 * The inner text is exactly `balanceLabel(paise)` so it reads the same as the rest of the document.
 */
function balancePill(paise: number): string {
  const kind = paise === 0 ? 'zero' : paise > 0 ? 'dr' : 'cr'
  return `<span class="pill pill-${kind}">${balanceLabel(paise)}</span>`
}

/**
 * The same balance spelled out for a layman, bilingual. Sign matches the ledger — positive (Dr)
 * means the party owes the cold, negative (Cr) means the cold owes the party.
 */
function balanceSentence(name: string, paise: number): string {
  const who = esc(name)
  if (paise === 0) {
    return L(`${who}'s account is settled — nothing due either way.`, `${who} का खाता बराबर है — दोनों ओर कुछ बकाया नहीं।`)
  }
  const amount = formatINR(Math.abs(paise))
  return paise > 0
    ? L(`${who} owes the cold ${amount}.`, `${who} को कोल्ड को ${amount} देने हैं।`)
    : L(`The cold owes ${who} ${amount}.`, `कोल्ड को ${who} को ${amount} देने हैं।`)
}

/** A rupee figure, or an empty cell for zero (keeps dense tables uncluttered). */
function money(paise: number): string {
  return paise ? formatINR(paise) : ''
}

/** Title-case bilingual name for a voucher type, e.g. receipt → "Receipt / रसीद". */
function voucherTypeLabel(t: VoucherType): string {
  switch (t) {
    case 'receipt':
      return L('Receipt', 'रसीद')
    case 'payment':
      return L('Payment', 'भुगतान')
    case 'journal':
      return L('Journal', 'जर्नल')
    case 'contra':
      return L('Contra', 'कोंट्रा')
  }
}

/** Short Title-case voucher type for dense ledger cells (no Hindi, keeps the column narrow). */
function voucherTypeShort(t: VoucherType): string {
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/** A small chip describing what an entry is about; `general` gets no chip (it is the default). */
function tagChip(tag: EntryTag): string {
  const map: Record<EntryTag, string | null> = {
    rent: L('Rent', 'भाड़ा'),
    loan: L('Loan', 'ऋण'),
    interest: L('Interest', 'ब्याज'),
    trade: L('Trade', 'व्यापार'),
    opening: L('Opening', 'प्रारंभिक'),
    general: null
  }
  const label = map[tag]
  return label ? `<span class="tag tag-${tag}">${label}</span>` : ''
}

const STYLE = `
  :root {
    --ink: #111827;
    --muted: #6b7280;
    --line: #e5e7eb;
    --soft: #f8fafc;
    --accent: #1d4ed8;
    --accent-soft: #eff6ff;
    --amber: #92400e;
    --amber-soft: #fef3c7;
    --green: #166534;
    --green-soft: #ecfdf5;
  }
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body {
    font-family: 'Noto Sans', 'Noto Sans Devanagari', Arial, sans-serif;
    color: var(--ink); margin: 0; padding: 0; font-size: 12px; line-height: 1.45;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; font-feature-settings: 'tnum'; }

  /* ---- letterhead ---- */
  .head { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px;
    border-bottom: 3px solid var(--accent); padding-bottom: 12px; margin-bottom: 18px; }
  .brand h1 { font-size: 20px; margin: 0; letter-spacing: -0.2px; }
  .brand .sub { color: var(--muted); font-size: 11px; margin-top: 2px; }
  .doc { text-align: right; }
  .doc .kind { display: inline-block; background: var(--accent); color: #fff; font-weight: 700;
    font-size: 12px; padding: 3px 12px; border-radius: 999px; letter-spacing: 0.3px; }
  .doc .ref { color: var(--muted); font-size: 11px; margin-top: 5px; }

  /* ---- titles ---- */
  h2 { font-size: 14px; margin: 18px 0 8px; }
  .subtitle { color: var(--muted); font-size: 11px; }

  /* ---- meta grid ---- */
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 28px; margin: 0 0 14px;
    background: var(--soft); border: 1px solid var(--line); border-radius: 8px; padding: 10px 14px; }
  .meta div { padding: 2px 0; }
  .meta .k { color: var(--muted); }
  .meta .v { font-weight: 600; }

  /* ---- summary cards ---- */
  .cards { display: flex; gap: 10px; margin: 0 0 16px; flex-wrap: wrap; }
  .card { flex: 1 1 0; min-width: 130px; border: 1px solid var(--line); border-radius: 8px;
    padding: 9px 12px; background: #fff; }
  .card .lab { color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: 0.4px; }
  .card .val { font-size: 16px; font-weight: 700; margin-top: 3px; font-variant-numeric: tabular-nums; }
  .card.accent { background: var(--accent-soft); border-color: #bfdbfe; }
  .card.accent .val { color: var(--accent); }
  .card.amber { background: var(--amber-soft); border-color: #fde68a; }
  .card.amber .val { color: var(--amber); }
  .card.green { background: var(--green-soft); border-color: #bbf7d0; }
  .card.green .val { color: var(--green); }

  /* ---- tables ---- */
  table { width: 100%; border-collapse: collapse; margin: 6px 0 14px; }
  thead { display: table-header-group; }
  th, td { padding: 6px 9px; text-align: left; vertical-align: top; border-bottom: 1px solid var(--line); }
  th { background: var(--accent-soft); color: #1e3a8a; font-weight: 700; font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.4px; border-bottom: 2px solid #bfdbfe; }
  tbody tr { break-inside: avoid; }
  tbody tr:nth-child(even) td { background: var(--soft); }
  tfoot td { font-weight: 700; background: #f1f5f9; border-top: 2px solid var(--line);
    border-bottom: none; font-variant-numeric: tabular-nums; }
  .muted { color: var(--muted); }
  .empty { color: var(--muted); font-style: italic; padding: 10px 0; }

  /* ---- pills & chips ---- */
  .pill { display: inline-block; padding: 1px 9px; border-radius: 999px; font-weight: 700; font-size: 11px;
    white-space: nowrap; font-variant-numeric: tabular-nums; }
  .pill-dr { background: var(--accent-soft); color: var(--accent); }
  .pill-cr { background: var(--amber-soft); color: var(--amber); }
  .pill-zero { background: #f1f5f9; color: var(--muted); }
  .tag { display: inline-block; padding: 0 7px; border-radius: 4px; font-size: 9.5px; font-weight: 600;
    margin-left: 6px; background: #eef2ff; color: #4338ca; vertical-align: middle; }
  .tag-rent { background: #ecfeff; color: #0e7490; }
  .tag-loan { background: #fef3c7; color: var(--amber); }
  .tag-interest { background: #fae8ff; color: #86198f; }
  .tag-trade { background: #ecfdf5; color: var(--green); }
  .tag-opening { background: #f1f5f9; color: var(--muted); }
  .badge { display: inline-block; background: var(--accent); color: #fff; border-radius: 4px;
    padding: 1px 8px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px;
    margin-right: 8px; }

  /* ---- sections (bill) ---- */
  .section { border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; margin-bottom: 14px;
    break-inside: avoid; }
  .section-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;
    padding-bottom: 8px; border-bottom: 1px dashed var(--line); }
  .section-head .who { font-size: 13px; }
  .mini-h { font-size: 11px; font-weight: 700; color: var(--muted); text-transform: uppercase;
    letter-spacing: 0.4px; margin: 12px 0 4px; }

  /* ---- closing / net ---- */
  .closing { display: flex; justify-content: space-between; align-items: center; margin-top: 12px;
    padding: 12px 16px; background: var(--soft); border: 1px solid var(--line); border-radius: 8px; }
  .closing .lab { font-size: 13px; font-weight: 700; }
  .plain { font-size: 11px; color: #374151; margin-top: 6px; }
  .right { text-align: right; }

  .status-ok { color: var(--green); font-weight: 700; }
  .status-bad { color: #b91c1c; font-weight: 700; }

  .foot { margin-top: 28px; padding-top: 8px; border-top: 1px solid var(--line);
    color: var(--muted); font-size: 9.5px; text-align: center; }
`

/** Wrap a document body in the bilingual letterhead + print stylesheet. */
function shell(docKind: string, ref: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><style>${STYLE}</style></head>
<body>
  <div class="head">
    <div class="brand">
      <h1>Paritosh Cold / परितोष कोल्ड</h1>
      <div class="sub">${L('Cold storage accounting', 'शीतगृह लेखा')}</div>
    </div>
    <div class="doc">
      <div class="kind">${docKind}</div>
      <div class="ref">${ref}</div>
    </div>
  </div>
  ${bodyHtml}
  <div class="foot">${L('Computer-generated document', 'कंप्यूटर-जनित दस्तावेज़')} — Paritosh Cold</div>
</body>
</html>`
}

function metaRow(k: string, v: string): string {
  return `<div><span class="k">${k}:</span> <span class="v">${v}</span></div>`
}

function metaGrid(rows: string[]): string {
  return `<div class="meta">${rows.filter(Boolean).join('')}</div>`
}

interface Card {
  label: string
  value: string
  tone?: 'accent' | 'amber' | 'green'
}

function cards(items: Card[]): string {
  const html = items
    .map((c) => `<div class="card${c.tone ? ' ' + c.tone : ''}"><div class="lab">${c.label}</div><div class="val">${c.value}</div></div>`)
    .join('')
  return `<div class="cards">${html}</div>`
}

/** A summary card showing a balance, toned by Dr/Cr/settled so it matches the running balance pill. */
function balanceCard(label: string, paise: number): Card {
  return {
    label,
    value: balanceLabel(paise),
    tone: paise === 0 ? undefined : paise > 0 ? 'accent' : 'amber'
  }
}

// ---------------------------------------------------------------- Gate pass (Nikasi)

export function gatePassHtml(n: NikasiDetail): string {
  const rows = n.lines
    .map(
      (l) => `<tr>
        <td>${esc(l.fromKisanName)}</td>
        <td>R${l.room} / F${l.floor} / ${l.rack}</td>
        <td class="num">${l.packets}</td>
        <td class="num">${l.weightKg ?? ''}</td>
        <td class="num">${formatINR(l.ratePaise)}</td>
        <td class="num">${formatINR(l.amountPaise)}</td>
      </tr>`
    )
    .join('')
  const totalPackets = n.lines.reduce((s, l) => s + l.packets, 0)
  const totalWeight = n.lines.reduce((s, l) => s + (l.weightKg ?? 0), 0)
  const totalAmount = n.lines.reduce((s, l) => s + l.amountPaise, 0)
  const deliveredKind = n.deliveredToType === 'vyapari' ? L('Vyapari', 'व्यापारी') : L('Kisan', 'किसान')

  const body = `
  ${cards([
    { label: L('Packets', 'पैकेट'), value: String(totalPackets), tone: 'accent' },
    { label: L('Goods value', 'माल मूल्य'), value: formatINR(totalAmount) },
    { label: L('Bhada recovered', 'भाड़ा वसूल'), value: formatINR(n.bhadaRecoveredPaise), tone: 'green' }
  ])}
  ${metaGrid([
    metaRow(L('Gate pass no.', 'गेट पास सं.'), `#${n.billNo}`),
    metaRow(L('Date', 'दिनांक'), esc(n.date)),
    metaRow(L('Delivered to', 'प्राप्तकर्ता'), `${esc(n.deliveredToName)} <span class="muted">(${deliveredKind})</span>`),
    metaRow(L('Vehicle no.', 'वाहन सं.'), esc(n.vehicleNo) || '—'),
    metaRow(L('Received by', 'प्राप्तकर्ता हस्ताक्षर'), esc(n.receivedBy) || '—'),
    n.voucherNo ? metaRow(L('Sale voucher', 'बिक्री वाउचर'), `#${n.voucherNo}`) : ''
  ])}
  <table>
    <thead><tr>
      <th>${L('From kisan', 'किसान')}</th>
      <th>${L('Location', 'स्थान')}</th>
      <th class="num">${L('Packets', 'पैकेट')}</th>
      <th class="num">${L('Weight (kg)', 'वज़न')}</th>
      <th class="num">${L('Rate', 'दर')}</th>
      <th class="num">${L('Amount', 'राशि')}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr>
      <td colspan="2">${L('Total', 'कुल')}</td>
      <td class="num">${totalPackets}</td>
      <td class="num">${totalWeight || ''}</td>
      <td></td>
      <td class="num">${formatINR(totalAmount)}</td>
    </tr></tfoot>
  </table>`
  return shell(L('Gate Pass', 'गेट पास'), `#${n.billNo} · ${esc(n.date)}`, body)
}

// ---------------------------------------------------------------- Ledger table (shared)

/**
 * The running-ledger table shared by the ledger statement and each bill section. Renders the
 * per-entry Dr/Cr, a colour-coded running balance, an entry chip (rent/loan/…), and a tfoot that
 * totals the debits and credits and restates the closing balance.
 */
function ledgerTable(lines: LedgerLine[]): string {
  if (lines.length === 0) return `<p class="empty">${L('No ledger entries', 'कोई प्रविष्टि नहीं')}</p>`
  const rows = lines
    .map(
      (l) => `<tr>
        <td class="num">${esc(l.date)}</td>
        <td>${voucherTypeShort(l.type)} <span class="muted">#${l.voucherNo}</span></td>
        <td>${esc(l.narration) || ''}${tagChip(l.tag)}</td>
        <td class="num">${money(l.drPaise)}</td>
        <td class="num">${money(l.crPaise)}</td>
        <td class="num">${balancePill(l.balancePaise)}</td>
      </tr>`
    )
    .join('')
  const totalDr = lines.reduce((s, l) => s + l.drPaise, 0)
  const totalCr = lines.reduce((s, l) => s + l.crPaise, 0)
  const closing = lines[lines.length - 1].balancePaise
  return `<table>
    <thead><tr>
      <th class="num">${L('Date', 'दिनांक')}</th>
      <th>${L('Voucher', 'वाउचर')}</th>
      <th>${L('Particulars', 'विवरण')}</th>
      <th class="num">${L('Dr', 'नामे')}</th>
      <th class="num">${L('Cr', 'जमा')}</th>
      <th class="num">${L('Balance', 'शेष')}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr>
      <td colspan="3">${L('Total', 'कुल')}</td>
      <td class="num">${formatINR(totalDr)}</td>
      <td class="num">${formatINR(totalCr)}</td>
      <td class="num">${balancePill(closing)}</td>
    </tr></tfoot>
  </table>`
}

// ---------------------------------------------------------------- Bill (person-wise)

function loanTable(loans: BillLoanLine[]): string {
  if (loans.length === 0) return ''
  const rows = loans
    .map(
      (l) => `<tr>
        <td class="num">${esc(l.date)}</td>
        <td>${esc(l.category)} <span class="muted">· ${esc(l.nature)}</span></td>
        <td class="num">${formatINR(l.basePaise)}</td>
        <td class="num">${formatINR(l.unpostedInterestPaise)}</td>
        <td class="num">${formatINR(l.liveOutstandingPaise)}</td>
      </tr>`
    )
    .join('')
  return `<div class="mini-h">${L('Loans', 'ऋण')}</div>
  <table>
    <thead><tr>
      <th class="num">${L('Date', 'दिनांक')}</th>
      <th>${L('Type', 'प्रकार')}</th>
      <th class="num">${L('Posted base', 'पोस्ट मूल')}</th>
      <th class="num">${L('Un-posted interest', 'अनपोस्ट ब्याज')}</th>
      <th class="num">${L('Live outstanding', 'वर्तमान बकाया')}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`
}

function bardanaTable(rows: BardanaRow[]): string {
  if (rows.length === 0) return ''
  const body = rows
    .map(
      (r) => `<tr>
        <td class="num">${esc(r.date)}</td>
        <td>${r.direction === 'purchase' ? L('Purchase', 'खरीद') : L('Issue', 'जारी')}</td>
        <td class="num">${r.qty}</td>
        <td class="num">${formatINR(r.ratePaise)}</td>
        <td class="num">${formatINR(r.amountPaise)}</td>
      </tr>`
    )
    .join('')
  return `<div class="mini-h">${L('Bardana (cash-settled)', 'बारदाना (नकद)')}</div>
  <table>
    <thead><tr>
      <th class="num">${L('Date', 'दिनांक')}</th>
      <th>${L('Direction', 'प्रकार')}</th>
      <th class="num">${L('Qty', 'मात्रा')}</th>
      <th class="num">${L('Rate', 'दर')}</th>
      <th class="num">${L('Amount', 'राशि')}</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>`
}

function expenseTable(rows: ExpenseRow[]): string {
  if (rows.length === 0) return ''
  const body = rows
    .map(
      (r) => `<tr>
        <td class="num">${esc(r.date)}</td>
        <td>${voucherTypeShort('payment')} <span class="muted">#${r.voucherNo}</span></td>
        <td>${esc(r.narration) || ''}</td>
        <td class="num">${formatINR(r.amountPaise)}</td>
      </tr>`
    )
    .join('')
  return `<div class="mini-h">${L('Salary / loading (cash-settled)', 'वेतन / लदाई (नकद)')}</div>
  <table>
    <thead><tr>
      <th class="num">${L('Date', 'दिनांक')}</th>
      <th>${L('Voucher', 'वाउचर')}</th>
      <th>${L('Particulars', 'विवरण')}</th>
      <th class="num">${L('Amount', 'राशि')}</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>`
}

function sectionHtml(s: BillSection): string {
  const bhada =
    s.standingBhadaPaise !== 0
      ? `<p class="plain muted">${L('Of which standing bhada', 'इसमें बकाया भाड़ा')}: ${formatINR(s.standingBhadaPaise)}</p>`
      : ''
  return `<div class="section">
    <div class="section-head">
      <div class="who"><span class="badge">${esc(s.role)}</span><strong>${esc(s.accountName)}</strong> <span class="muted">${esc(s.subgroupName)}</span></div>
      <div>${L('Section net', 'अनुभाग शेष')}: ${balancePill(s.netPaise)}</div>
    </div>
    ${ledgerTable(s.ledgerLines)}
    ${bhada}
    ${loanTable(s.loans)}
    ${bardanaTable(s.bardanaRows)}
    ${expenseTable(s.expenseRows)}
  </div>`
}

export function billHtml(b: Bill): string {
  const ident = metaGrid([
    b.sonOf ? metaRow(L('Son of', 'पिता'), esc(b.sonOf)) : '',
    b.villageCity ? metaRow(L('Village / City', 'गाँव / शहर'), esc(b.villageCity)) : '',
    b.phone ? metaRow(L('Phone', 'फ़ोन'), esc(b.phone)) : '',
    metaRow(L('As of', 'तिथि तक'), esc(b.asOf)),
    metaRow(L('Accounts', 'खाते'), String(b.sections.length))
  ])
  const summary = cards([balanceCard(L('Combined net', 'कुल शेष'), b.combinedNetPaise)])
  const closing = `<div class="plain">${balanceSentence(b.name, b.combinedNetPaise)}</div>`
  const sections = b.sections.map(sectionHtml).join('')
  return shell(
    L('Bill', 'बिल'),
    `${esc(b.name)} · ${esc(b.asOf)}`,
    `<h2>${esc(b.name)}</h2>${ident}${summary}${closing}${sections}`
  )
}

// ---------------------------------------------------------------- Voucher

export function voucherHtml(v: VoucherDetail): string {
  const rows = v.entries
    .map(
      (e) => `<tr>
        <td>${esc(e.accountName)}${tagChip(e.tag)}</td>
        <td class="num">${money(e.drPaise)}</td>
        <td class="num">${money(e.crPaise)}</td>
      </tr>`
    )
    .join('')
  const totalDr = v.entries.reduce((s, e) => s + e.drPaise, 0)
  const totalCr = v.entries.reduce((s, e) => s + e.crPaise, 0)
  const body = `
  ${metaGrid([
    metaRow(L('Type', 'प्रकार'), voucherTypeLabel(v.type)),
    metaRow(L('No.', 'सं.'), `#${v.no}`),
    metaRow(L('Date', 'दिनांक'), esc(v.date)),
    metaRow(L('Narration', 'विवरण'), esc(v.narration) || '—')
  ])}
  <table>
    <thead><tr>
      <th>${L('Account', 'खाता')}</th>
      <th class="num">${L('Dr', 'नामे')}</th>
      <th class="num">${L('Cr', 'जमा')}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr>
      <td>${L('Total', 'कुल')}</td>
      <td class="num">${formatINR(totalDr)}</td>
      <td class="num">${formatINR(totalCr)}</td>
    </tr></tfoot>
  </table>`
  return shell(L('Voucher', 'वाउचर'), `${voucherTypeShort(v.type)} #${v.no} · ${esc(v.date)}`, body)
}

// ---------------------------------------------------------------- Ledger statement

export function ledgerHtml(accountName: string, lines: LedgerLine[]): string {
  const closing = lines.length ? lines[lines.length - 1].balancePaise : 0
  const totalDr = lines.reduce((s, l) => s + l.drPaise, 0)
  const totalCr = lines.reduce((s, l) => s + l.crPaise, 0)
  const period = lines.length ? `${esc(lines[0].date)} → ${esc(lines[lines.length - 1].date)}` : '—'

  const body = `<h2>${esc(accountName)}</h2>
  ${metaGrid([
    metaRow(L('Account', 'खाता'), esc(accountName)),
    metaRow(L('Period', 'अवधि'), period),
    metaRow(L('Entries', 'प्रविष्टियाँ'), String(lines.length))
  ])}
  ${cards([
    { label: L('Total debits', 'कुल नामे'), value: formatINR(totalDr) },
    { label: L('Total credits', 'कुल जमा'), value: formatINR(totalCr) },
    balanceCard(L('Closing balance', 'अंतिम शेष'), closing)
  ])}
  ${ledgerTable(lines)}
  <div class="closing">
    <span class="lab">${L('Closing balance', 'अंतिम शेष')}</span>
    ${balancePill(closing)}
  </div>
  <div class="plain">${balanceSentence(accountName, closing)}</div>`
  return shell(L('Ledger Statement', 'खाता विवरण'), esc(accountName), body)
}

// ---------------------------------------------------------------- Trial balance

export function trialBalanceHtml(year: number, tb: TrialBalance): string {
  const rows = tb.rows
    .map(
      (r) => `<tr>
        <td>${esc(r.accountName)}</td>
        <td class="muted">${esc(r.subgroupName)}</td>
        <td class="num">${money(r.drPaise)}</td>
        <td class="num">${money(r.crPaise)}</td>
      </tr>`
    )
    .join('')
  const status = tb.balanced
    ? `<span class="status-ok">${L('Balanced', 'संतुलित')}</span>`
    : `<span class="status-bad">${L('NOT balanced', 'असंतुलित')}</span>`
  const body = `
  ${metaGrid([
    metaRow(L('Financial year', 'वित्तीय वर्ष'), String(year)),
    metaRow(L('Accounts', 'खाते'), String(tb.rows.length)),
    metaRow(L('Status', 'स्थिति'), status)
  ])}
  ${cards([
    { label: L('Total debits', 'कुल नामे'), value: formatINR(tb.totalDr) },
    { label: L('Total credits', 'कुल जमा'), value: formatINR(tb.totalCr) },
    { label: L('Difference', 'अंतर'), value: formatINR(Math.abs(tb.totalDr - tb.totalCr)), tone: tb.balanced ? 'green' : 'amber' }
  ])}
  <table>
    <thead><tr>
      <th>${L('Account', 'खाता')}</th>
      <th>${L('Subgroup', 'उपसमूह')}</th>
      <th class="num">${L('Dr', 'नामे')}</th>
      <th class="num">${L('Cr', 'जमा')}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr>
      <td colspan="2">${L('Total', 'कुल')}</td>
      <td class="num">${formatINR(tb.totalDr)}</td>
      <td class="num">${formatINR(tb.totalCr)}</td>
    </tr></tfoot>
  </table>`
  return shell(L('Trial Balance', 'तलपट'), String(year), body)
}
