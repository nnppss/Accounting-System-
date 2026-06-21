import { useMemo, useState } from 'react'
import { Input, Space, Table, Tag, Typography } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { AccountType } from '@shared/enums'
import type { BillSubject } from '@shared/contracts'
import { balanceLabel } from '../lib/format'

/** Bills index (software.md §3.11) — one row per person (grouping roles) or standalone account. */
export default function BillsPage(): JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')

  const subjects = useQuery({ queryKey: ['bills', 'subjects'], queryFn: () => window.api.bills.subjects() })

  const rows = useMemo(() => {
    const all = subjects.data ?? []
    const q = search.trim().toLowerCase()
    if (!q) return all
    return all.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.villageCity ?? '').toLowerCase().includes(q) ||
        (s.phone ?? '').includes(q) ||
        (s.sonOf ?? '').toLowerCase().includes(q)
    )
  }, [subjects.data, search])

  const open = (s: BillSubject): void => navigate(`/bills/${s.primaryAccountId}`)

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
    {
      title: t('bills.net'),
      dataIndex: 'netPaise',
      align: 'right' as const,
      render: (v: number) => balanceLabel(v)
    }
  ]

  return (
    <div>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        {t('bills.title')}
      </Typography.Title>
      <Input.Search
        placeholder={t('bills.search')}
        allowClear
        style={{ width: 320, marginBottom: 16 }}
        onChange={(e) => setSearch(e.target.value)}
      />
      <Table
        rowKey="subjectKey"
        size="small"
        loading={subjects.isLoading}
        columns={columns}
        dataSource={rows}
        pagination={{ pageSize: 20 }}
        onRow={(r) => ({ onClick: () => open(r), style: { cursor: 'pointer' } })}
      />
    </div>
  )
}
