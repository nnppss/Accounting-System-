import { useEffect, useRef, useState } from 'react'
import { Button, DatePicker, Empty, Table, Tag } from 'antd'
import { FileExcelOutlined, LeftOutlined, PrinterOutlined, RightOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import type { DayBookSection, MoneyBookDetailRow } from '@shared/contracts'
import { DATE_INPUT_FORMATS, formatDate, formatINR, paiseToRupees } from '../lib/format'
import { isInputFocused, isNavFocused, isOverlayOpen } from '../lib/keyGuards'
import { usePrinter } from '../lib/usePrinter'
import { useExporter } from '../lib/useExporter'
import { SectionBar } from './report'
import { SeverityText } from './Highlight'

/**
 * Day Book — the money that moved on one date, one section per cash/bank account, with the running
 * balance after every transaction. Embedded as a segment of the Money Book. Step days with the ‹ ›
 * buttons, the Today button, or the ←/→ arrow keys (when not typing in a field).
 *
 * The day lives in the URL (?date=…) so returning from a party's ledger lands back on the same day.
 */
export function DayBookView(): JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const print = usePrinter()
  const exportXlsx = useExporter()
  const today = dayjs().format('YYYY-MM-DD')
  const [params, setParams] = useSearchParams()
  const date = params.get('date') ?? today
  const setDate = (d: string): void =>
    setParams(
      (p) => {
        p.set('date', d)
        return p
      },
      { replace: true }
    )
  const day = useQuery({ queryKey: ['daybook', date], queryFn: () => window.api.daybook.get(date) })

  const shift = (n: number): void => setDate(dayjs(date).add(n, 'day').format('YYYY-MM-DD'))

  // How many day-chips fit in the strip — recomputed on resize. Kept odd so the selected day centres.
  const stripRef = useRef<HTMLDivElement>(null)
  const [count, setCount] = useState(7)
  useEffect(() => {
    const el = stripRef.current
    if (!el) return
    const CHIP = 72 // chip width + gap, must match .pc-day-chip in styles.css
    const update = (): void => {
      const n = Math.min(15, Math.max(3, Math.floor(el.clientWidth / CHIP)))
      setCount(n % 2 === 0 ? n - 1 : n)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const half = (count - 1) / 2
  const days = Array.from({ length: count }, (_, i) => dayjs(date).add(i - half, 'day'))

  // ←/→ step the day, unless the user is typing in an input (e.g. the date field itself).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isInputFocused() || isOverlayOpen() || isNavFocused()) return
      if (e.key === 'ArrowLeft') shift(-1)
      else if (e.key === 'ArrowRight') shift(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [date])

  // Coming back from a ledger should land on this same day, so carry the query string along.
  const openAccount = (id: number): void =>
    navigate(`/accounts/${id}`, { state: { fromNav: `${location.pathname}${location.search}` } })

  const columns = [
    {
      title: t('vouchers.no'),
      dataIndex: 'voucherNo',
      width: 110,
      render: (no: number, r: MoneyBookDetailRow) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Tag color="magenta" style={{ margin: 0 }}>
            {t(`vouchers.${r.type}`)}
          </Tag>
          #{no}
        </span>
      )
    },
    {
      title: t('moneyBook.counterparty'),
      dataIndex: 'counterparties',
      width: 200,
      render: (cs: MoneyBookDetailRow['counterparties']) =>
        cs.length === 0
          ? '—'
          : cs.map((c, i) => (
              <span key={c.id}>
                {i > 0 && ', '}
                <a onClick={() => openAccount(c.id)}>{c.name}</a>
              </span>
            ))
    },
    {
      title: t('common.narration'),
      dataIndex: 'narration',
      render: (n: string | null) => n ?? '—'
    },
    {
      title: t('moneyBook.receipts'),
      dataIndex: 'receiptPaise',
      align: 'right' as const,
      width: 130,
      render: (v: number) => (v ? formatINR(v) : '')
    },
    {
      title: t('moneyBook.payments'),
      dataIndex: 'paymentPaise',
      align: 'right' as const,
      width: 130,
      render: (v: number) => (v ? formatINR(v) : '')
    },
    {
      title: t('common.balance'),
      dataIndex: 'balancePaise',
      align: 'right' as const,
      width: 140,
      // Holding after this transaction. Negative = overdrawn, a red flag.
      render: (v: number) =>
        v < 0 ? (
          <SeverityText severity="danger" strong>
            {formatINR(v)}
          </SeverityText>
        ) : (
          <strong>{formatINR(v)}</strong>
        )
    }
  ]

  const sections = day.data?.sections ?? []
  const isToday = date === today

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 16,
          padding: '8px 12px',
          border: '1px solid #eadfe6',
          borderRadius: 10,
          background: '#fff'
        }}
      >
        <Button icon={<LeftOutlined />} onClick={() => shift(-1)} aria-label={t('dayBook.prev')} />
        <div ref={stripRef} style={{ flex: 1, display: 'flex', gap: 6, justifyContent: 'center', overflow: 'hidden' }}>
          {days.map((d) => {
            const iso = d.format('YYYY-MM-DD')
            return (
              <button
                key={iso}
                className={`pc-day-chip${iso === today ? ' is-today' : ''}`}
                aria-pressed={iso === date}
                aria-label={d.format('dddd, DD/MM/YYYY')}
                onClick={() => setDate(iso)}
              >
                <span style={{ fontSize: 11, opacity: 0.7 }}>{d.format('ddd')}</span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{d.format('DD/MM')}</span>
              </button>
            )
          })}
        </div>
        <Button icon={<RightOutlined />} onClick={() => shift(1)} aria-label={t('dayBook.next')} />
        <DatePicker
          allowClear={false}
          format={DATE_INPUT_FORMATS}
          value={dayjs(date)}
          onChange={(d) => d && setDate(d.format('YYYY-MM-DD'))}
          style={{ width: 150 }}
        />
        <Button onClick={() => setDate(today)} disabled={isToday}>
          {t('dayBook.today')}
        </Button>
        <Button
          icon={<PrinterOutlined />}
          onClick={() => print(() => window.api.print.dayBook(date))}
          aria-label={t('common.print')}
        />
        <Button
          icon={<FileExcelOutlined />}
          aria-label={t('common.excel')}
          onClick={() =>
            exportXlsx(
              `day-book-${date}.xlsx`,
              `${t('dayBook.title')} ${formatDate(date)}`,
              [
                t('moneyBook.account'),
                t('vouchers.no'),
                t('vouchers.type'),
                t('moneyBook.counterparty'),
                t('common.narration'),
                t('moneyBook.receipts'),
                t('moneyBook.payments'),
                t('common.balance')
              ],
              sections.flatMap((s) =>
                s.rows.map((r) => [
                  s.accountName,
                  r.voucherNo,
                  t(`vouchers.${r.type}`),
                  r.counterparties.map((c) => c.name).join(', '),
                  r.narration ?? '',
                  r.receiptPaise ? paiseToRupees(r.receiptPaise) : '',
                  r.paymentPaise ? paiseToRupees(r.paymentPaise) : '',
                  paiseToRupees(r.balancePaise)
                ])
              ),
              [5, 6, 7] // Receipts, Payments, Balance
            )
          }
        />
      </div>

      {!day.isLoading && sections.length === 0 ? (
        <Empty description={t('dayBook.empty')} />
      ) : (
        sections.map((s: DayBookSection, i) => (
          <div key={s.accountId} style={{ marginBottom: 20 }}>
            <SectionBar>
              <span style={{ display: 'flex', alignItems: 'center', gap: 16, width: '100%' }}>
                <span>{s.accountName}</span>
                <span style={{ marginLeft: 'auto', fontWeight: 400 }}>
                  {t('moneyBook.opening')} {formatINR(s.openingPaise)}
                </span>
                <span>
                  {t('moneyBook.closing')} {formatINR(s.closingPaise)}
                </span>
              </span>
            </SectionBar>
            <Table
              className="pc-report"
              rowKey="voucherId"
              size="small"
              loading={day.isLoading && i === 0}
              columns={columns}
              dataSource={s.rows}
              pagination={false}
              scroll={{ x: 'max-content' }}
            />
          </div>
        ))
      )}
      {sections.length > 0 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 24,
            marginTop: 16,
            padding: '10px 16px',
            borderRadius: 8,
            background: '#4a0039',
            color: '#fff',
            fontWeight: 700,
            fontVariantNumeric: 'tabular-nums'
          }}
        >
          <span style={{ marginRight: 'auto' }}>{t('common.total')}</span>
          <span>
            {t('moneyBook.receipts')} {formatINR(day.data?.totalReceiptPaise ?? 0)}
          </span>
          <span>
            {t('moneyBook.payments')} {formatINR(day.data?.totalPaymentPaise ?? 0)}
          </span>
        </div>
      )}
    </div>
  )
}
