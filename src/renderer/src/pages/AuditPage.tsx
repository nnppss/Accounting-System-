import { useState } from 'react'
import { Card, Select, Space, Table, Tag, Typography } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import type { AuditAction, AuditFilter, AuditLogRow } from '@shared/contracts'

const ACTION_COLORS: Record<AuditAction, string> = {
  create: 'green',
  update: 'blue',
  void: 'red'
}

/** 'loading_contractor_year' → 'loading contractor year' for display. */
const prettyEntity = (e: string): string => e.replace(/_/g, ' ')

/** Expanded row: the before/after snapshots recorded with the change. */
function AuditDetail({ row }: { row: AuditLogRow }): JSX.Element {
  const { t } = useTranslation()
  const block = (label: string, data: unknown): JSX.Element | null =>
    data == null ? null : (
      <div style={{ minWidth: 240 }}>
        <Typography.Text strong>{label}</Typography.Text>
        <pre style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap', fontSize: 12 }}>
          {JSON.stringify(data, null, 2)}
        </pre>
      </div>
    )
  return (
    <Space align="start" size="large" wrap>
      {block(t('audit.before'), row.before)}
      {block(t('audit.after'), row.after)}
    </Space>
  )
}

export default function AuditPage(): JSX.Element {
  const { t } = useTranslation()
  const [filter, setFilter] = useState<AuditFilter>({ limit: 500 })

  const facets = useQuery({ queryKey: ['audit-facets'], queryFn: () => window.api.audit.facets() })
  const log = useQuery({ queryKey: ['audit', filter], queryFn: () => window.api.audit.list(filter) })

  const patch = (p: Partial<AuditFilter>): void => setFilter((f) => ({ ...f, ...p }))

  const accountantOptions = (facets.data?.accountants ?? []).map((a) => ({ value: a, label: a }))
  const entityOptions = (facets.data?.entities ?? []).map((e) => ({
    value: e,
    label: prettyEntity(e)
  }))
  const actionOptions: Array<{ value: AuditAction; label: string }> = [
    { value: 'create', label: t('audit.action.create') },
    { value: 'update', label: t('audit.action.update') },
    { value: 'void', label: t('audit.action.void') }
  ]

  const columns = [
    {
      title: t('audit.when'),
      dataIndex: 'ts',
      width: 175,
      render: (ts: number) => dayjs(ts).format('DD MMM YYYY, HH:mm')
    },
    {
      title: t('audit.accountant'),
      dataIndex: 'accountantName',
      width: 190,
      render: (n: string | null) =>
        n ?? <Typography.Text type="secondary">{t('common.none')}</Typography.Text>
    },
    {
      title: t('audit.action'),
      dataIndex: 'action',
      width: 120,
      render: (a: AuditAction) => <Tag color={ACTION_COLORS[a]}>{t(`audit.action.${a}`)}</Tag>
    },
    {
      title: t('audit.entity'),
      dataIndex: 'entity',
      render: (e: string) => prettyEntity(e)
    },
    {
      title: t('audit.record'),
      dataIndex: 'entityId',
      width: 90,
      render: (id: number | null) => (id != null ? `#${id}` : t('common.none'))
    }
  ]

  return (
    <div>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        {t('audit.title')}
      </Typography.Title>

      <Card style={{ marginBottom: 16 }}>
        <Space wrap>
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            style={{ width: 220 }}
            placeholder={t('audit.allAccountants')}
            options={accountantOptions}
            loading={facets.isLoading}
            value={filter.accountantName}
            onChange={(v) => patch({ accountantName: v })}
          />
          <Select
            allowClear
            style={{ width: 200 }}
            placeholder={t('audit.allEntities')}
            options={entityOptions}
            loading={facets.isLoading}
            value={filter.entity}
            onChange={(v) => patch({ entity: v })}
          />
          <Select
            allowClear
            style={{ width: 160 }}
            placeholder={t('common.all')}
            options={actionOptions}
            value={filter.action}
            onChange={(v) => patch({ action: v })}
          />
          <Select
            style={{ width: 120 }}
            value={filter.limit}
            onChange={(v) => patch({ limit: v })}
            options={[
              { value: 100, label: '100' },
              { value: 500, label: '500' },
              { value: 2000, label: '2000' }
            ]}
          />
        </Space>
      </Card>

      <Table
        rowKey="id"
        size="small"
        loading={log.isLoading}
        columns={columns}
        dataSource={log.data ?? []}
        pagination={{ pageSize: 20, showSizeChanger: false }}
        expandable={{
          expandedRowRender: (r: AuditLogRow) => <AuditDetail row={r} />,
          rowExpandable: (r: AuditLogRow) => r.before != null || r.after != null
        }}
      />
    </div>
  )
}
