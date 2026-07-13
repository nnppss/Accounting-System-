import { useMemo } from 'react'
import { Input, Segmented, Space, Table, Tag } from 'antd'
import { PageBanner } from '../components/report'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { AccountType } from '@shared/enums'
import type { BillSubject } from '@shared/contracts'
import { formatINR } from '../lib/format'
import { BalanceAmount } from '../components/Highlight'
import { useBillsView, type BillMode } from '../store/billsView'
import { useTableKeyNav } from '../lib/useTableKeyNav'

/**
 * Bills & Salaries index (software.md §3.11) — one row per person (grouping roles) or standalone
 * account. Toggled between Bill (parties with ledger dealings) and Salary (staff, who carry salary
 * slips rather than bills). Staff are shown only under Salary; everyone else under Bill. The tab and
 * search live in a store so they survive opening a bill and returning (see billsView store).
 */
export default function BillsPage(): JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { mode, search, setMode, setSearch } = useBillsView()

  const subjects = useQuery({ queryKey: ['bills', 'subjects'], queryFn: () => window.api.bills.subjects() })

  const rows = useMemo(() => {
    const all = subjects.data ?? []
    const byMode = all.filter((s) =>
      mode === 'salary' ? s.roles.includes('staff') : s.roles.some((r) => r !== 'staff')
    )
    const q = search.trim().toLowerCase()
    if (!q) return byMode
    return byMode.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.villageCity ?? '').toLowerCase().includes(q) ||
        (s.phone ?? '').includes(q) ||
        (s.sonOf ?? '').toLowerCase().includes(q)
    )
  }, [subjects.data, search, mode])

  const open = (s: BillSubject): void => navigate(`/bills/${s.primaryAccountId}`)
  const { containerRef, rowClassName } = useTableKeyNav(rows, open)

  const valueColumn =
    mode === 'salary'
      ? {
          title: t('bills.salaryPaid'),
          dataIndex: 'salaryPaidPaise',
          align: 'right' as const,
          render: (v: number) => formatINR(v)
        }
      : {
          title: t('bills.net'),
          dataIndex: 'netPaise',
          align: 'right' as const,
          render: (v: number) => <BalanceAmount paise={v} />
        }

  const columns = [
    {
      title: t('accounts.name'),
      dataIndex: 'name',
      render: (name: string, r: BillSubject) => <a onClick={() => open(r)}>{name}</a>
    },
    { title: t('bills.sonOf'), dataIndex: 'sonOf', render: (v: string | null) => v ?? '—' },
    { title: t('bills.village'), dataIndex: 'villageCity', render: (v: string | null) => v ?? '—' },
    { title: t('bills.phone'), dataIndex: 'phone', render: (v: string | null) => v ?? '—' },
    {
      title: t('bills.roles'),
      dataIndex: 'roles',
      render: (roles: AccountType[]) => (
        <Space size={4} wrap>
          {roles.map((r) => (
            <Tag key={r}>{t(`accounts.type.${r}`)}</Tag>
          ))}
        </Space>
      )
    },
    valueColumn
  ]

  return (
    <div>
      <PageBanner
        title={t('bills.title')}
        extra={
          <Segmented
            value={mode}
            onChange={(v) => setMode(v as BillMode)}
            options={[
              { label: t('bills.tab.bill'), value: 'bill' },
              { label: t('bills.tab.salary'), value: 'salary' }
            ]}
          />
        }
      />
      <div>
        <Input.Search
          placeholder={t('bills.search')}
          allowClear
          value={search}
          style={{ width: 320, marginBottom: 16 }}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div ref={containerRef}>
        <Table
          className="pc-report"
          rowKey="subjectKey"
          size="small"
          loading={subjects.isLoading}
          columns={columns}
          dataSource={rows}
          pagination={{ defaultPageSize: 20 }}
          rowClassName={rowClassName}
          onRow={(r) => ({ onClick: () => open(r), style: { cursor: 'pointer' } })}
        />
      </div>
    </div>
  )
}
