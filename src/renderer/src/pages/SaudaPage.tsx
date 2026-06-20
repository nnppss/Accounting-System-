import {
  App as AntApp,
  Button,
  Card,
  DatePicker,
  Form,
  InputNumber,
  Select,
  Space,
  Table,
  Typography
} from 'antd'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import type { SaudaListRow } from '@shared/contracts'
import { formatINR, toPaise } from '../lib/format'

export default function SaudaPage(): JSX.Element {
  const { t } = useTranslation()
  const { message } = AntApp.useApp()
  const queryClient = useQueryClient()
  const [form] = Form.useForm()

  const vyaparis = useQuery({
    queryKey: ['accounts', 'vyapari'],
    queryFn: () => window.api.accounts.list({ type: 'vyapari' })
  })
  const kisans = useQuery({
    queryKey: ['accounts', 'kisan'],
    queryFn: () => window.api.accounts.list({ type: 'kisan' })
  })
  const saudas = useQuery({ queryKey: ['sauda'], queryFn: () => window.api.sauda.list() })

  const create = useMutation({
    mutationFn: (input: Parameters<typeof window.api.sauda.create>[0]) =>
      window.api.sauda.create(input),
    onSuccess: () => {
      message.success(t('sauda.created'))
      form.resetFields()
      queryClient.invalidateQueries({ queryKey: ['sauda'] })
    },
    onError: (e: Error) => message.error(e.message)
  })

  const vyapariOptions = (vyaparis.data ?? []).map((v) => ({ value: v.id, label: v.name }))
  const kisanOptions = (kisans.data ?? []).map((k) => ({ value: k.id, label: k.name }))

  const columns = [
    { title: t('common.date'), dataIndex: 'date', width: 120 },
    { title: t('sauda.vyapari'), dataIndex: 'vyapariName' },
    { title: t('sauda.kisan'), dataIndex: 'kisanName' },
    { title: t('sauda.packets'), dataIndex: 'packets', align: 'right' as const, width: 110 },
    {
      title: t('sauda.rate'),
      dataIndex: 'ratePaise',
      align: 'right' as const,
      width: 140,
      render: (v: number) => formatINR(v)
    }
  ]

  return (
    <div>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        {t('sauda.title')}
      </Typography.Title>

      <Card style={{ marginBottom: 24, maxWidth: 720 }}>
        <Form
          form={form}
          layout="inline"
          initialValues={{ date: dayjs() }}
          onFinish={(v) =>
            create.mutate({
              date: (v.date as dayjs.Dayjs).format('YYYY-MM-DD'),
              vyapariAccountId: v.vyapariAccountId,
              kisanAccountId: v.kisanAccountId,
              packets: v.packets,
              ratePaise: toPaise(v.rate)
            })
          }
        >
          <Form.Item name="date" rules={[{ required: true }]}>
            <DatePicker format="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item name="vyapariAccountId" rules={[{ required: true }]}>
            <Select
              placeholder={t('sauda.vyapari')}
              options={vyapariOptions}
              showSearch
              optionFilterProp="label"
              style={{ width: 180 }}
            />
          </Form.Item>
          <Form.Item name="kisanAccountId" rules={[{ required: true }]}>
            <Select
              placeholder={t('sauda.kisan')}
              options={kisanOptions}
              showSearch
              optionFilterProp="label"
              style={{ width: 180 }}
            />
          </Form.Item>
          <Form.Item name="packets" rules={[{ required: true }]}>
            <InputNumber min={1} placeholder={t('sauda.packets')} />
          </Form.Item>
          <Form.Item name="rate" rules={[{ required: true }]}>
            <InputNumber min={0} precision={2} addonBefore="₹" placeholder={t('sauda.rate')} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={create.isPending}>
              {t('common.create')}
            </Button>
          </Form.Item>
        </Form>
      </Card>

      <Table
        rowKey="id"
        size="small"
        loading={saudas.isLoading}
        columns={columns}
        dataSource={(saudas.data ?? []) as SaudaListRow[]}
        pagination={{ pageSize: 15 }}
      />
    </div>
  )
}
