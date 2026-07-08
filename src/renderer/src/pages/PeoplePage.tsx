import { useRef, useState } from 'react'
import { App as AntApp, Button, Empty, Input, Popconfirm, Space, Table } from 'antd'
import { DeleteOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { PersonRow } from '@shared/contracts'
import { useTableKeyNav } from '../lib/useTableKeyNav'
import { PageBanner } from '../components/report'

/**
 * People (person master) management. Persons are a permanent, reusable identity list — one human can
 * own several role-accounts — so they are never deleted automatically. This page is the deliberate,
 * audited place to remove one. Deletion is refused server-side while any account still links to the
 * person (the error names those accounts).
 */
export default function PeoplePage(): JSX.Element {
  const { t } = useTranslation()
  const { message } = AntApp.useApp()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const searchTimer = useRef<ReturnType<typeof setTimeout>>()

  // Type-ahead: only query once something is typed, so the page never dumps the whole master list.
  const term = search.trim()
  const persons = useQuery({
    queryKey: ['persons', term],
    queryFn: () => window.api.persons.list(term),
    enabled: term.length > 0
  })

  const onSearch = (v: string): void => {
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => setSearch(v), 250)
  }

  const { containerRef, rowClassName } = useTableKeyNav(persons.data, () => {})

  const remove = useMutation({
    mutationFn: (id: number) => window.api.persons.delete(id),
    onSuccess: () => {
      message.success(t('people.deleted'))
      queryClient.invalidateQueries({ queryKey: ['persons'] })
    },
    onError: (e: Error) => message.error(e.message)
  })

  const columns = [
    { title: t('accounts.name'), dataIndex: 'name' },
    {
      title: 'S/o',
      dataIndex: 'sonOf',
      render: (v: string | null) => v ?? t('common.none')
    },
    {
      title: t('accounts.village'),
      dataIndex: 'villageCity',
      render: (v: string | null) => v ?? t('common.none')
    },
    {
      title: t('accounts.state'),
      dataIndex: 'state',
      render: (v: string | null) => v ?? t('common.none')
    },
    {
      title: t('accounts.phone'),
      dataIndex: 'phone',
      render: (v: string | null) => v ?? t('common.none')
    },
    {
      title: '',
      key: 'actions',
      width: 110,
      render: (_: unknown, r: PersonRow) => (
        <Popconfirm
          title={t('people.confirmDelete', { name: r.name })}
          okText={t('common.delete')}
          okButtonProps={{ danger: true, loading: remove.isPending }}
          cancelText={t('common.cancel')}
          onConfirm={() => remove.mutate(r.id)}
        >
          <Button danger size="small" icon={<DeleteOutlined />}>
            {t('common.delete')}
          </Button>
        </Popconfirm>
      )
    }
  ]

  return (
    <div>
      <PageBanner title={t('people.title')} subtitle={t('people.subtitle')} />

      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <Input.Search
          allowClear
          style={{ maxWidth: 480 }}
          placeholder={t('accounts.personSearch')}
          loading={persons.isFetching}
          onChange={(e) => onSearch(e.target.value)}
          onSearch={(v) => onSearch(v)}
        />
        <div ref={containerRef} style={{ width: '100%' }}>
        <Table
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={persons.data ?? []}
          loading={persons.isFetching}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          rowClassName={rowClassName}
          locale={{
            emptyText: term ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('common.noResults')} />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('common.typeToSearch')} />
            )
          }}
        />
        </div>
      </Space>
    </div>
  )
}
