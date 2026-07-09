import { useEffect, useRef, useState } from 'react'
import { Button, DatePicker, Empty, Table, Tag } from 'antd'
import { LeftOutlined, PrinterOutlined, RightOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import type { DayBookEntry, DayBookVoucher } from '@shared/contracts'
import { DATE_INPUT_FORMATS, formatINR } from '../lib/format'
import { isInputFocused, isNavFocused, isOverlayOpen } from '../lib/keyGuards'
import { usePrinter } from '../lib/usePrinter'
import { SectionBar } from './report'

/**
 * Day Book — every financial transaction posted on one date, grouped by voucher. Embedded as a
 * segment of the Money Book. Step days with the ‹ › buttons, the Today button, or the ←/→ arrow
 * keys (when not typing in a field).
 */
export function DayBookView(): JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const print = usePrinter()
  const today = dayjs().format('YYYY-MM-DD')
  const [date, setDate] = useState(today)
  const day = useQuery({ queryKey: ['daybook', date], queryFn: () => window.api.daybook.get(date) })

  const shift = (n: number): void => setDate((d) => dayjs(d).add(n, 'day').format('YYYY-MM-DD'))

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
  }, [])

  const columns = [
    { title: t('vouchers.account'), dataIndex: 'accountName' },
    {
      title: t('common.dr'),
      dataIndex: 'drPaise',
      align: 'right' as const,
      width: 160,
      render: (v: number) => (v ? formatINR(v) : '')
    },
    {
      title: t('common.cr'),
      dataIndex: 'crPaise',
      align: 'right' as const,
      width: 160,
      render: (v: number) => (v ? formatINR(v) : '')
    }
  ]

  const vouchers = day.data?.vouchers ?? []
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
      </div>

      {!day.isLoading && vouchers.length === 0 ? (
        <Empty description={t('dayBook.empty')} />
      ) : (
        vouchers.map((v: DayBookVoucher, i) => (
          <div key={v.voucherId}>
            <SectionBar>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Tag color="magenta" style={{ margin: 0 }}>
                  {t(`vouchers.${v.type}`)}
                </Tag>
                <span>#{v.voucherNo}</span>
                {v.narration && <span style={{ fontWeight: 400 }}>· {v.narration}</span>}
              </span>
            </SectionBar>
            <Table
              className="pc-report"
              rowKey="accountId"
              size="small"
              loading={day.isLoading && i === 0}
              showHeader={i === 0}
              columns={columns}
              dataSource={v.entries}
              pagination={false}
              onRow={(e: DayBookEntry) => ({
                onClick: () =>
                  navigate(`/accounts/${e.accountId}`, { state: { fromNav: '/money-book' } }),
                style: { cursor: 'pointer' }
              })}
            />
          </div>
        ))
      )}
      {vouchers.length > 0 && (
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
            {t('common.dr')} {formatINR(day.data?.totalDrPaise ?? 0)}
          </span>
          <span>
            {t('common.cr')} {formatINR(day.data?.totalCrPaise ?? 0)}
          </span>
        </div>
      )}
    </div>
  )
}
