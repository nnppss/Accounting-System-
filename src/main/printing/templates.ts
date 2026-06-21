import { formatINR } from '../../shared/money'
import type {
  Bill,
  BillSection,
  LedgerLine,
  NikasiDetail,
  TrialBalance,
  VoucherDetail
} from '../../shared/contracts'

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

function money(paise: number): string {
  return paise ? formatINR(paise) : ''
}

const STYLE = `
  * { box-sizing: border-box; }
  body { font-family: 'Noto Sans', 'Noto Sans Devanagari', Arial, sans-serif; color: #1a1a1a; margin: 0; padding: 28px; font-size: 12px; }
  h1 { font-size: 18px; margin: 0; }
  h2 { font-size: 14px; margin: 18px 0 6px; }
  .sub { color: #666; font-size: 11px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1a1a1a; padding-bottom: 10px; margin-bottom: 14px; }
  .doc { text-align: right; }
  .doc .title { font-size: 15px; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0 12px; }
  th, td { border: 1px solid #ccc; padding: 4px 7px; text-align: left; vertical-align: top; }
  th { background: #f3f3f3; font-weight: 600; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  tr.total td { font-weight: 700; background: #fafafa; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 24px; margin-bottom: 12px; }
  .meta div { padding: 2px 0; }
  .meta .k { color: #666; }
  .net { font-size: 14px; font-weight: 700; }
  .section { border: 1px solid #ddd; border-radius: 4px; padding: 10px 12px; margin-bottom: 12px; }
  .badge { display: inline-block; background: #e6f0ff; color: #1d4ed8; border-radius: 3px; padding: 1px 7px; font-size: 11px; margin-right: 6px; }
  .foot { margin-top: 26px; color: #999; font-size: 10px; text-align: center; }
`

/** Wrap a document body in the bilingual letterhead + print stylesheet. */
function shell(docTitle: string, subtitle: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><style>${STYLE}</style></head>
<body>
  <div class="head">
    <div>
      <h1>Paritosh Cold / परितोष कोल्ड</h1>
      <div class="sub">${L('Cold storage accounting', 'शीतगृह लेखा')}</div>
    </div>
    <div class="doc">
      <div class="title">${docTitle}</div>
      <div class="sub">${subtitle}</div>
    </div>
  </div>
  ${bodyHtml}
  <div class="foot">${L('Computer-generated document', 'कंप्यूटर-जनित दस्तावेज़')} — Paritosh Cold</div>
</body>
</html>`
}

function metaRow(k: string, v: string): string {
  return `<div><span class="k">${k}:</span> ${v}</div>`
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
  const totalAmount = n.lines.reduce((s, l) => s + l.amountPaise, 0)

  const body = `
  <div class="meta">
    ${metaRow(L('Gate pass no.', 'गेट पास सं.'), String(n.billNo))}
    ${metaRow(L('Date', 'दिनांक'), esc(n.date))}
    ${metaRow(L('Delivered to', 'प्राप्तकर्ता'), `${esc(n.deliveredToName)} (${L(n.deliveredToType === 'vyapari' ? 'Vyapari' : 'Kisan', n.deliveredToType === 'vyapari' ? 'व्यापारी' : 'किसान')})`)}
    ${metaRow(L('Vehicle no.', 'वाहन सं.'), esc(n.vehicleNo) || '—')}
    ${metaRow(L('Received by', 'प्राप्तकर्ता हस्ताक्षर'), esc(n.receivedBy) || '—')}
    ${metaRow(L('Bhada recovered', 'भाड़ा वसूल'), formatINR(n.bhadaRecoveredPaise))}
  </div>
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
    <tfoot><tr class="total">
      <td colspan="2">${L('Total', 'कुल')}</td>
      <td class="num">${totalPackets}</td>
      <td></td><td></td>
      <td class="num">${formatINR(totalAmount)}</td>
    </tr></tfoot>
  </table>`
  return shell(L('Gate Pass', 'गेट पास'), `#${n.billNo} · ${esc(n.date)}`, body)
}

// ---------------------------------------------------------------- Bill (person-wise)

function ledgerTable(lines: LedgerLine[]): string {
  if (lines.length === 0) return `<p class="sub">${L('No ledger entries', 'कोई प्रविष्टि नहीं')}</p>`
  const rows = lines
    .map(
      (l) => `<tr>
        <td>${esc(l.date)}</td>
        <td>${esc(l.type)} #${l.voucherNo}</td>
        <td>${esc(l.narration) || ''}</td>
        <td class="num">${money(l.drPaise)}</td>
        <td class="num">${money(l.crPaise)}</td>
        <td class="num">${balanceLabel(l.balancePaise)}</td>
      </tr>`
    )
    .join('')
  return `<table>
    <thead><tr>
      <th>${L('Date', 'दिनांक')}</th>
      <th>${L('Voucher', 'वाउचर')}</th>
      <th>${L('Narration', 'विवरण')}</th>
      <th class="num">${L('Dr', 'नामे')}</th>
      <th class="num">${L('Cr', 'जमा')}</th>
      <th class="num">${L('Balance', 'शेष')}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`
}

function sectionHtml(s: BillSection): string {
  const loans =
    s.loans.length > 0
      ? `<p class="sub">${L('Loans', 'ऋण')}: ${s.loans.length} · ${L('live outstanding', 'वर्तमान बकाया')} ${formatINR(s.loans.reduce((a, l) => a + l.liveOutstandingPaise, 0))} (${L('un-posted interest', 'अनपोस्ट ब्याज')} ${formatINR(s.unpostedInterestPaise)})</p>`
      : ''
  const bhada =
    s.standingBhadaPaise !== 0
      ? `<p class="sub">${L('Standing bhada', 'बकाया भाड़ा')}: ${formatINR(s.standingBhadaPaise)}</p>`
      : ''
  return `<div class="section">
    <div><span class="badge">${esc(s.role)}</span><strong>${esc(s.accountName)}</strong> <span class="sub">${esc(s.subgroupName)}</span></div>
    ${ledgerTable(s.ledgerLines)}
    ${loans}
    ${bhada}
    <div style="text-align:right"><strong>${L('Section net', 'अनुभाग शेष')}: ${balanceLabel(s.netPaise)}</strong></div>
  </div>`
}

export function billHtml(b: Bill): string {
  const ident = `
  <div class="meta">
    ${b.sonOf ? metaRow(L('Son of', 'पिता'), esc(b.sonOf)) : ''}
    ${b.villageCity ? metaRow(L('Village / City', 'गाँव / शहर'), esc(b.villageCity)) : ''}
    ${b.phone ? metaRow(L('Phone', 'फ़ोन'), esc(b.phone)) : ''}
    ${metaRow(L('As of', 'तिथि तक'), esc(b.asOf))}
  </div>
  <div style="text-align:right" class="net">${L('Combined net', 'कुल शेष')}: ${balanceLabel(b.combinedNetPaise)}</div>`
  const sections = b.sections.map(sectionHtml).join('')
  return shell(L('Bill', 'बिल'), `${esc(b.name)} · ${esc(b.asOf)}`, `<h2>${esc(b.name)}</h2>${ident}${sections}`)
}

// ---------------------------------------------------------------- Voucher

export function voucherHtml(v: VoucherDetail): string {
  const rows = v.entries
    .map(
      (e) => `<tr>
        <td>${esc(e.accountName)}</td>
        <td class="num">${money(e.drPaise)}</td>
        <td class="num">${money(e.crPaise)}</td>
      </tr>`
    )
    .join('')
  const totalDr = v.entries.reduce((s, e) => s + e.drPaise, 0)
  const totalCr = v.entries.reduce((s, e) => s + e.crPaise, 0)
  const body = `
  <div class="meta">
    ${metaRow(L('Type', 'प्रकार'), esc(v.type))}
    ${metaRow(L('No.', 'सं.'), String(v.no))}
    ${metaRow(L('Date', 'दिनांक'), esc(v.date))}
    ${metaRow(L('Narration', 'विवरण'), esc(v.narration) || '—')}
  </div>
  <table>
    <thead><tr>
      <th>${L('Account', 'खाता')}</th>
      <th class="num">${L('Dr', 'नामे')}</th>
      <th class="num">${L('Cr', 'जमा')}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr class="total">
      <td>${L('Total', 'कुल')}</td>
      <td class="num">${formatINR(totalDr)}</td>
      <td class="num">${formatINR(totalCr)}</td>
    </tr></tfoot>
  </table>`
  return shell(L('Voucher', 'वाउचर'), `${esc(v.type)} #${v.no} · ${esc(v.date)}`, body)
}

// ---------------------------------------------------------------- Ledger statement

export function ledgerHtml(accountName: string, lines: LedgerLine[]): string {
  const closing = lines.length ? lines[lines.length - 1].balancePaise : 0
  const body = `<h2>${esc(accountName)}</h2>
  ${ledgerTable(lines)}
  <div style="text-align:right"><strong>${L('Closing balance', 'अंतिम शेष')}: ${balanceLabel(closing)}</strong></div>`
  return shell(L('Ledger Statement', 'खाता विवरण'), esc(accountName), body)
}

// ---------------------------------------------------------------- Trial balance

export function trialBalanceHtml(year: number, tb: TrialBalance): string {
  const rows = tb.rows
    .map(
      (r) => `<tr>
        <td>${esc(r.accountName)}</td>
        <td>${esc(r.subgroupName)}</td>
        <td class="num">${money(r.drPaise)}</td>
        <td class="num">${money(r.crPaise)}</td>
      </tr>`
    )
    .join('')
  const body = `
  <p class="sub">${tb.balanced ? L('Balanced', 'संतुलित') : L('NOT balanced', 'असंतुलित')}</p>
  <table>
    <thead><tr>
      <th>${L('Account', 'खाता')}</th>
      <th>${L('Subgroup', 'उपसमूह')}</th>
      <th class="num">${L('Dr', 'नामे')}</th>
      <th class="num">${L('Cr', 'जमा')}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr class="total">
      <td colspan="2">${L('Total', 'कुल')}</td>
      <td class="num">${formatINR(tb.totalDr)}</td>
      <td class="num">${formatINR(tb.totalCr)}</td>
    </tr></tfoot>
  </table>`
  return shell(L('Trial Balance', 'तलपट'), String(year), body)
}
