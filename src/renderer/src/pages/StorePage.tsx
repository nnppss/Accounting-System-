import {
  App as AntApp,
  Button,
  Card,
  DatePicker,
  Form,
  InputNumber,
  Space,
  Statistic,
  Typography
} from 'antd'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import { useSession } from '../store/session'
import { formatINR } from '../lib/format'

export default function StorePage(): JSX.Element {
  const { t } = useTranslation()
  const { message } = AntApp.useApp()
  const queryClient = useQueryClient()
  const session = useSession((s) => s.session)

  const store = useQuery({ queryKey: ['store'], queryFn: () => window.api.store.get() })
  const years = useQuery({ queryKey: ['years'], queryFn: () => window.api.auth.listYears() })
  const rentRate = years.data?.find((y) => y.id === session?.yearId)?.rentRatePaise ?? 0

  const saveStore = useMutation({
    mutationFn: (cfg: { rooms: number; floors: number; racksPerFloor: number }) =>
      window.api.store.set(cfg),
    onSuccess: () => {
      message.success(t('store.saved'))
      queryClient.invalidateQueries({ queryKey: ['store'] })
      queryClient.invalidateQueries({ queryKey: ['maps'] })
    },
    onError: (e: Error) => message.error(e.message)
  })

  const accrueAll = useMutation({
    mutationFn: (date: string) => window.api.bhada.accrueAll(date),
    onSuccess: (r) => {
      message.success(t('bhada.accrued', { count: r.kisans, amount: formatINR(r.totalPaise) }))
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      queryClient.invalidateQueries({ queryKey: ['trialBalance'] })
    },
    onError: (e: Error) => message.error(e.message)
  })

  return (
    <div>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        {t('nav.store')}
      </Typography.Title>

      <Card title={t('store.title')} style={{ maxWidth: 520, marginBottom: 24 }}>
        {store.data && (
          <Form
            layout="inline"
            initialValues={store.data}
            onFinish={(v) => saveStore.mutate(v)}
          >
            <Form.Item name="rooms" label={t('store.rooms')} rules={[{ required: true }]}>
              <InputNumber min={1} max={8} />
            </Form.Item>
            <Form.Item name="floors" label={t('store.floors')} rules={[{ required: true }]}>
              <InputNumber min={1} max={10} />
            </Form.Item>
            <Form.Item name="racksPerFloor" label={t('store.racks')} rules={[{ required: true }]}>
              <InputNumber min={1} max={200} />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit" loading={saveStore.isPending}>
                {t('common.save')}
              </Button>
            </Form.Item>
          </Form>
        )}
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
          {t('store.note')}
        </Typography.Paragraph>
      </Card>

      <Card title={t('bhada.title')} style={{ maxWidth: 520 }}>
        <Space size="large" align="end" wrap>
          <Statistic title={t('bhada.rate')} value={formatINR(rentRate)} />
          <Form layout="inline" initialValues={{ date: dayjs() }} onFinish={(v) => accrueAll.mutate((v.date as dayjs.Dayjs).format('YYYY-MM-DD'))}>
            <Form.Item name="date" label={t('bhada.date')} rules={[{ required: true }]}>
              <DatePicker format="YYYY-MM-DD" />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit" loading={accrueAll.isPending}>
                {t('bhada.accrueAll')}
              </Button>
            </Form.Item>
          </Form>
        </Space>
      </Card>
    </div>
  )
}
