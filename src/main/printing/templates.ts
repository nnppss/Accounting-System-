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

/** Stored ISO date (YYYY-MM-DD) → the app's display format DD/MM/YYYY. Unexpected input is left as-is. */
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
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

/**
 * Shared warm "Paritosh Cold" theme — a maroon serif wordmark on a cream page with beige tables.
 * Every document (gate pass, voucher, ledger, trial balance, and the bill's own header block) reuses
 * this palette and table styling so the whole document set looks like one stationery family.
 */
const STYLE = `
  :root {
    --maroon: #7a3b2e;
    --maroon-soft: #f0e6e1;
    --ink: #1f1d1b;
    --ink-soft: #3a3632;
    --muted: #8a8279;
    --line: #cfc8bf;
    --line-soft: #ddd6cc;
    --soft: #f5f1ea;
    --beige: #e8e2d9;
    --beige-2: #efeae2;
    --amber: #8a5a2b;
    --amber-soft: #f3e7d4;
    --green: #2f6b3f;
    --green-soft: #e7f0e7;
    --red: #9c3a2f;
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
    border-bottom: 2px solid var(--maroon); padding-bottom: 12px; margin-bottom: 18px; }
  .brand h1 { font-family: Georgia, 'Times New Roman', serif; font-style: italic; font-weight: 700;
    color: var(--maroon); font-size: 24px; margin: 0; line-height: 1; }
  .brand h1 .hi { font-family: 'Noto Sans Devanagari', Arial, sans-serif; font-style: normal; margin-left: 10px; }
  .brand .sub { color: var(--muted); font-size: 11px; margin-top: 5px; }
  .doc { text-align: right; }
  .doc .kind { display: inline-block; background: var(--maroon); color: #fff; font-weight: 700;
    font-size: 12px; padding: 3px 12px; border-radius: 4px; letter-spacing: 0.3px; }
  .doc .ref { color: var(--muted); font-size: 11px; margin-top: 5px; }

  /* ---- titles ---- */
  h2 { font-size: 15px; margin: 18px 0 8px; }

  /* ---- meta grid ---- */
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 28px; margin: 0 0 14px;
    background: var(--soft); border: 1px solid var(--line); border-radius: 6px; padding: 10px 14px; }
  .meta div { padding: 2px 0; }
  .meta .k { color: var(--muted); }
  .meta .v { font-weight: 600; }

  /* ---- summary cards ---- */
  .cards { display: flex; gap: 10px; margin: 0 0 16px; flex-wrap: wrap; }
  .card { flex: 1 1 0; min-width: 130px; border: 1px solid var(--line); border-radius: 6px;
    padding: 9px 12px; background: #fff; }
  .card .lab { color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: 0.4px; }
  .card .val { font-size: 16px; font-weight: 700; margin-top: 3px; font-variant-numeric: tabular-nums; }
  .card.accent { background: var(--maroon-soft); border-color: #e0cfc7; }
  .card.accent .val { color: var(--maroon); }
  .card.amber { background: var(--amber-soft); border-color: #e6d3b8; }
  .card.amber .val { color: var(--amber); }
  .card.green { background: var(--green-soft); border-color: #c4ddc4; }
  .card.green .val { color: var(--green); }

  /* ---- tables ---- */
  table { width: 100%; border-collapse: collapse; margin: 6px 0 14px; }
  thead { display: table-header-group; }
  th, td { padding: 6px 9px; text-align: left; vertical-align: top; border: 1px solid var(--line); }
  th { background: var(--beige); color: var(--ink-soft); font-weight: 700; font-size: 10.5px;
    letter-spacing: 0.3px; }
  th .hi { display: block; font-weight: 500; }
  th.num { text-align: right; }
  tbody tr { break-inside: avoid; }
  tbody tr:nth-child(even) td { background: rgba(0, 0, 0, 0.012); }
  tfoot td { font-weight: 700; background: var(--beige); font-variant-numeric: tabular-nums; }
  .muted { color: var(--muted); }
  .empty { color: var(--muted); font-style: italic; padding: 10px 2px; }

  /* ---- pills & chips ---- */
  .pill { display: inline-block; padding: 1px 9px; border-radius: 999px; font-weight: 700; font-size: 11px;
    white-space: nowrap; font-variant-numeric: tabular-nums; }
  .pill-dr { background: var(--maroon-soft); color: var(--maroon); }
  .pill-cr { background: var(--amber-soft); color: var(--amber); }
  .pill-zero { background: var(--beige-2); color: var(--muted); }
  .tag { display: inline-block; padding: 0 7px; border-radius: 4px; font-size: 9.5px; font-weight: 600;
    margin-left: 6px; background: var(--beige-2); color: var(--ink-soft); vertical-align: middle; }
  .tag-rent { background: #e3eeec; color: #3a6b63; }
  .tag-loan { background: var(--amber-soft); color: var(--amber); }
  .tag-interest { background: #efe6f0; color: #7a4a7a; }
  .tag-trade { background: var(--green-soft); color: var(--green); }
  .tag-opening { background: var(--beige-2); color: var(--muted); }

  /* ---- closing / net ---- */
  .closing { display: flex; justify-content: space-between; align-items: center; margin-top: 12px;
    padding: 12px 16px; background: var(--soft); border: 1px solid var(--line); border-radius: 6px; }
  .closing .lab { font-size: 13px; font-weight: 700; }
  .plain { font-size: 11px; color: var(--ink-soft); margin-top: 6px; }

  .status-ok { color: var(--green); font-weight: 700; }
  .status-bad { color: var(--red); font-weight: 700; }

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
      <h1>Paritosh Cold <span class="hi">परितोष कोल्ड</span></h1>
      <div class="sub">${L('Cold storage accounting', 'शीतगृह लेखा')}</div>
    </div>
    <div class="doc">
      <div class="kind">${docKind}</div>
      <div class="ref">${ref}</div>
    </div>
  </div>
  ${bodyHtml}
  <div class="foot">${L('Computer-generated document', 'कंप्यूटर-जनित दस्तावेज़')} — Paritosh Cold Storage</div>
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
    metaRow(L('Date', 'दिनांक'), esc(fmtDate(n.date))),
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
  return shell(L('Gate Pass', 'गेट पास'), `#${n.billNo} · ${esc(fmtDate(n.date))}`, body)
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
        <td class="num">${esc(fmtDate(l.date))}</td>
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

/**
 * The cold's own letterhead details. These are not in the database, so edit them here to match the
 * business — they print at the top of every bill.
 */
const COLD = {
  address: 'Khasra No. 137 ,Village Trakpura Pawavali,Baroli Ahir, Agra - 283125',
  phone: '+91 9412258426',
  email: 'satyapalsp.co@gmail.com'
}

/**
 * The bill is the cold's flagship customer-facing document, so it gets a bespoke letterhead
 * (wordmark · contact details · Hindi wordmark) over a "Bill to" + balance-summary band. It reuses
 * the shared `STYLE` palette and table styling — only the header and section bars are bill-specific
 * (`BILL_HEAD_STYLE`), so the whole document set stays one stationery family.
 */
const BILL_HEAD_STYLE = `
  /* ---- letterhead row ---- */
  .b-letter { display: grid; grid-template-columns: auto 1fr auto; gap: 22px; align-items: center;
    border-bottom: 2px solid var(--maroon); padding-bottom: 14px; }
  .lh-mark { font-family: Georgia, 'Times New Roman', serif; font-style: italic; font-weight: 700;
    color: var(--maroon); font-size: 38px; line-height: 0.95; }
  .lh-info { border-left: 2px solid var(--line); padding-left: 16px; font-size: 11px; color: var(--ink-soft); }
  .lh-info .co { font-weight: 700; font-size: 13px; color: var(--ink); margin-bottom: 3px; }
  .lh-info div { margin: 1px 0; }
  .lh-right { text-align: right; }
  .lh-right .b-hi { font-family: 'Noto Sans Devanagari', Arial, sans-serif; font-weight: 700; color: var(--maroon);
    font-size: 26px; line-height: 1; }
  .lh-right .as-of { font-size: 11px; color: var(--ink-soft); margin-top: 9px; }
  .lh-right .accounts { font-size: 11px; color: var(--muted); margin-top: 3px; }

  /* ---- bill-to + balance summary band ---- */
  .b-billrow { display: grid; grid-template-columns: 1fr auto; gap: 22px; align-items: start; margin: 16px 0 18px; }
  .billto { display: flex; align-items: stretch; }
  .billto-tab { background: var(--beige); color: var(--ink-soft); font-weight: 700; font-size: 11px;
    letter-spacing: 1.5px; writing-mode: vertical-rl; transform: rotate(180deg); text-align: center;
    padding: 10px 5px; border-radius: 4px; }
  .billto-body { padding-left: 14px; }
  .billto-body .name { font-size: 18px; font-weight: 800; margin-bottom: 5px; }
  .billto-body div { font-size: 12px; color: var(--ink-soft); margin: 2px 0; }

  .b-summary { width: 320px; max-width: 100%; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
  .b-summary .bs-title { background: var(--beige); text-align: center; font-weight: 700; font-size: 12px;
    padding: 6px; color: var(--ink-soft); }
  .b-summary .bs-body { background: var(--beige-2); text-align: center; padding: 11px 14px; }
  .bs-net-lab { font-size: 11px; font-weight: 700; letter-spacing: 0.5px; color: var(--ink-soft); text-transform: uppercase; }
  .bs-amount { font-size: 26px; font-weight: 800; margin: 4px 0 8px; }
  .bs-note { font-size: 11px; color: var(--ink-soft); line-height: 1.4; }
  .bs-foot { font-size: 11px; color: var(--ink-soft); margin-top: 8px; padding-top: 7px;
    border-top: 1px solid var(--line); font-weight: 600; }

  .sec-bar { display: flex; align-items: center; gap: 8px; margin: 16px 0 6px; padding-bottom: 5px;
    border-bottom: 1px solid var(--line-soft); font-size: 12px; }
  .sec-bar .role { font-weight: 800; text-transform: uppercase; letter-spacing: 0.3px; }
  .sec-bar .net { margin-left: auto; font-weight: 700; }
  .bhada-note { font-size: 11px; color: var(--muted); margin: -8px 0 12px; }
  .mini-h { background: var(--beige); text-align: center; font-weight: 700; font-size: 11.5px; color: var(--ink-soft);
    padding: 5px; border: 1px solid var(--line); border-bottom: none; margin-top: 14px; }
  .particulars .nl { display: block; font-size: 11px; color: var(--ink-soft); margin-top: 2px; }
`

/** Ledger balance cell for the bill: plain Dr/Cr, or a dash for a settled/zero line. */
function billBalance(paise: number): string {
  return paise === 0 ? '—' : balanceLabel(paise)
}

/** A bilingual table header that stacks the Hindi under the English, per the bill design. */
function th2(en: string, hi: string, num = false): string {
  return `<th${num ? ' class="num"' : ''}>${en} <span class="hi">${hi}</span></th>`
}

/** Narration with newlines turned into stacked sub-lines (matches the multi-line particulars). */
function particulars(narration: string | null, tag: EntryTag): string {
  const text = esc(narration) || ''
  const lines = text.split('\n')
  const head = `${lines[0]}${tagChip(tag)}`
  const rest = lines.slice(1).map((s) => `<span class="nl">${s}</span>`).join('')
  return `${head}${rest}`
}

/**
 * The bill's running-ledger table for one section. Always renders the full header/column structure;
 * an account with no movement shows an explicit empty row rather than collapsing the table, so every
 * role (kisan / vyapari / staff / …) reads as a proper statement.
 */
function billLedgerTable(lines: LedgerLine[]): string {
  const head = `<thead><tr>
      ${th2('Date', 'दिनांक')}
      ${th2('Voucher', 'वाउचर')}
      <th>Particulars <span class="hi">विवरण</span></th>
      ${th2('Dr', 'नामे', true)}
      ${th2('Cr', 'जमा', true)}
      ${th2('Balance', 'शेष', true)}
    </tr></thead>`
  if (lines.length === 0) {
    return `<table>${head}
    <tbody><tr><td colspan="6" class="empty">${L('No ledger entries', 'कोई प्रविष्टि नहीं')}</td></tr></tbody>
  </table>`
  }
  const rows = lines
    .map(
      (l) => `<tr>
        <td>${esc(fmtDate(l.date))}</td>
        <td>${l.voucherNo ? '#' + l.voucherNo : ''}</td>
        <td class="particulars">${particulars(l.narration, l.tag)}</td>
        <td class="num">${money(l.drPaise)}</td>
        <td class="num">${money(l.crPaise)}</td>
        <td class="num">${billBalance(l.balancePaise)}</td>
      </tr>`
    )
    .join('')
  const totalDr = lines.reduce((s, l) => s + l.drPaise, 0)
  const totalCr = lines.reduce((s, l) => s + l.crPaise, 0)
  const closing = lines[lines.length - 1].balancePaise
  return `<table>${head}
    <tbody>${rows}</tbody>
    <tfoot><tr>
      <td colspan="3" class="num">${L('Total', 'कुल')}</td>
      <td class="num">${formatINR(totalDr)}</td>
      <td class="num">${formatINR(totalCr)}</td>
      <td class="num">${billBalance(closing)}</td>
    </tr></tfoot>
  </table>`
}

/** A section's loans table (live engine figures), shown under its ledger when the account has loans. */
function billLoanTable(loans: BillLoanLine[]): string {
  const rows = loans
    .map(
      (l) => `<tr>
        <td>${esc(fmtDate(l.date))}</td>
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
      ${th2('Date', 'दिनांक')}
      ${th2('Type', 'प्रकार')}
      ${th2('Posted base', 'पोस्ट मूल', true)}
      ${th2('Un-posted interest', 'अनपोस्ट ब्याज', true)}
      ${th2('Live outstanding', 'वर्तमान बकाया', true)}
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`
}

/** A section's cash-settled bardana dealings, shown under its ledger when present. */
function billBardanaTable(rows: BardanaRow[]): string {
  const body = rows
    .map(
      (r) => `<tr>
        <td>${esc(fmtDate(r.date))}</td>
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
      ${th2('Date', 'दिनांक')}
      ${th2('Direction', 'प्रकार')}
      ${th2('Qty', 'मात्रा', true)}
      ${th2('Rate', 'दर', true)}
      ${th2('Amount', 'राशि', true)}
    </tr></thead>
    <tbody>${body}</tbody>
  </table>`
}

/** A section's cash-settled salary / loading payments, shown under its ledger when present. */
function billExpenseTable(rows: ExpenseRow[]): string {
  const body = rows
    .map(
      (r) => `<tr>
        <td>${esc(fmtDate(r.date))}</td>
        <td>${voucherTypeShort('payment')} <span class="muted">#${r.voucherNo}</span></td>
        <td>${esc(r.narration) || ''}</td>
        <td class="num">${formatINR(r.amountPaise)}</td>
      </tr>`
    )
    .join('')
  return `<div class="mini-h">${L('Salary / loading (cash-settled)', 'वेतन / लदाई (नकद)')}</div>
  <table>
    <thead><tr>
      ${th2('Date', 'दिनांक')}
      ${th2('Voucher', 'वाउचर')}
      <th>Particulars <span class="hi">विवरण</span></th>
      ${th2('Amount', 'राशि', true)}
    </tr></thead>
    <tbody>${body}</tbody>
  </table>`
}

/**
 * One role-account rendered in full: a section bar, its ledger (always a proper table), then any
 * loans / bardana / salary sub-tables that belong to it. Every section reads the same way whether or
 * not it carries movement.
 */
function billSection(s: BillSection): string {
  const bhada =
    s.standingBhadaPaise !== 0
      ? `<div class="bhada-note">${L('Of which standing bhada', 'इसमें बकाया भाड़ा')}: ${formatINR(s.standingBhadaPaise)}</div>`
      : ''
  return `<div class="sec-bar">
    <span class="role">${esc(s.role)}</span>
    <strong>${esc(s.accountName)}</strong>
    <span class="muted">${esc(s.subgroupName)}</span>
    <span class="net">${balanceLabel(s.netPaise)}</span>
  </div>
  ${billLedgerTable(s.ledgerLines)}
  ${bhada}
  ${s.loans.length ? billLoanTable(s.loans) : ''}
  ${s.bardanaRows.length ? billBardanaTable(s.bardanaRows) : ''}
  ${s.expenseRows.length ? billExpenseTable(s.expenseRows) : ''}`
}

export function billHtml(b: Bill): string {
  const sections = b.sections.length
    ? b.sections.map(billSection).join('')
    : `<p class="empty">${L('No ledger entries', 'कोई प्रविष्टि नहीं')}</p>`

  // Gross Dr/Cr split across the person's role-accounts (the summary footer); net is the headline.
  const totalDr = b.sections.reduce((s, x) => s + Math.max(x.netPaise, 0), 0)
  const totalCr = b.sections.reduce((s, x) => s + Math.max(-x.netPaise, 0), 0)

  const billTo = [
    b.sonOf ? `<div>${L('Son of', 'पिता')} ${esc(b.sonOf)}</div>` : '',
    b.phone ? `<div>${L('Phone', 'फ़ोन')} : ${esc(b.phone)}</div>` : '',
    b.villageCity ? `<div>${L('City', 'शहर')} : ${esc(b.villageCity)}</div>` : ''
  ].join('')

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${L('Bill', 'बिल')} — ${esc(b.name)}</title><style>${STYLE}${BILL_HEAD_STYLE}</style></head>
<body>
  <header class="b-letter">
    <div class="lh-mark">Paritosh<br>Cold</div>
    <div class="lh-info">
      <div class="co">Paritosh Cold</div>
      <div>${esc(COLD.address)}</div>
      <div>${L('Phone', 'फ़ोन')} : ${esc(COLD.phone)}</div>
      <div>${L('Email', 'ईमेल')} : ${esc(COLD.email)}</div>
    </div>
    <div class="lh-right">
      <div class="b-hi">परितोष कोल्ड</div>
      <div class="as-of">${L('Summary as of', 'तिथि तक शेष')} ${esc(fmtDate(b.asOf))}</div>
      <div class="accounts">${L('Accounts', 'खाते')}: ${b.sections.length}</div>
    </div>
  </header>
  <section class="b-billrow">
    <div class="billto">
      <div class="billto-tab">BILL TO</div>
      <div class="billto-body">
        <div class="name">${esc(b.name)}</div>
        ${billTo}
      </div>
    </div>
    <div class="b-summary">
      <div class="bs-title">${L('Balance Summary', 'शेष सारांश')}</div>
      <div class="bs-body">
        <div class="bs-net-lab">${L('Combined net', 'कुल शेष')}</div>
        <div class="bs-amount">${balanceLabel(b.combinedNetPaise)}</div>
        <div class="bs-note">${balanceSentence(b.name, b.combinedNetPaise)}</div>
        <div class="bs-foot">${L('Total Dr', 'कुल नामे')}: ${formatINR(totalDr)} &nbsp;·&nbsp; ${L('Total Cr', 'कुल जमा')}: ${formatINR(totalCr)}</div>
      </div>
    </div>
  </section>
  ${sections}
  <div class="foot">${L('Computer-generated document', 'कंप्यूटर-जनित दस्तावेज़')} — Paritosh Cold</div>
</body>
</html>`
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
    metaRow(L('Date', 'दिनांक'), esc(fmtDate(v.date))),
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
  return shell(L('Voucher', 'वाउचर'), `${voucherTypeShort(v.type)} #${v.no} · ${esc(fmtDate(v.date))}`, body)
}

// ---------------------------------------------------------------- Ledger statement

export function ledgerHtml(accountName: string, lines: LedgerLine[]): string {
  const closing = lines.length ? lines[lines.length - 1].balancePaise : 0
  const totalDr = lines.reduce((s, l) => s + l.drPaise, 0)
  const totalCr = lines.reduce((s, l) => s + l.crPaise, 0)
  const period = lines.length ? `${esc(fmtDate(lines[0].date))} → ${esc(fmtDate(lines[lines.length - 1].date))}` : '—'

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
