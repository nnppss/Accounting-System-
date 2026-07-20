import { useState } from 'react'
import AutoFocusModal from '../components/AutoFocusModal'
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Descriptions,
  Empty,
  Form,
  Input,
  List,
  Space,
  Statistic,
  Tag,
  Typography
} from 'antd'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { CloseException, CloseSummary } from '@shared/contracts'
import { useSession } from '../store/session'
import { formatINR } from '../lib/format'
import { SeverityTag } from '../components/Highlight'
import { PageBanner } from '../components/report'
import { useFormKeyNav } from '../lib/useFormKeyNav'

/**
 * The English sentence beside each exception is built here (not in the backend engine) so it runs
 * through i18n and follows the selected language. The tag/name/amount are rendered separately.
 */
function exceptionDetail(t: TFunction, ex: CloseException): string {
  switch (ex.kind) {
    case 'pending_cheque':
      return t('close.exd.pending_cheque', {
        no: ex.chequeNo,
        direction: ex.chequeDirection ? t(`cheques.dir.${ex.chequeDirection}`) : ''
      })
    case 'leftover_stock':
      return t('close.exd.leftover_stock', { packets: ex.packets ?? 0 })
    case 'unsettled_sauda':
      return t('close.exd.unsettled_sauda', {
        packets: ex.packets ?? 0,
        kisan: ex.counterpartyName ?? ''
      })
    case 'credit_balance':
    case 'unbalanced':
      return t(`close.exd.${ex.kind}`)
  }
}

/**
 * Year-end Close (software.md §3.13) — the one screen that writes money on a button press. Shows a
 * dry-run preview (summary + exceptions) of an open year, then closes it behind a password. A
 * closed year shows its closing report and an Undo (also password-gated). Reversible per the spec.
 */
export default function ClosePage(): JSX.Element {
  const { t } = useTranslation()
  const { message } = AntApp.useApp()
  const queryClient = useQueryClient()
  const session = useSession((s) => s.session)
  const [gate, setGate] = useState<null | 'run' | 'rollback'>(null)

  const status = useQuery({ queryKey: ['close', 'status'], queryFn: () => window.api.close.status() })
  const preview = useQuery({
    queryKey: ['close', 'preview'],
    queryFn: () => window.api.close.preview(),
    enabled: status.data === null // only meaningful while the year is open
  })

  const invalidate = (): void => {
    queryClient.invalidateQueries({ queryKey: ['close'] })
    queryClient.invalidateQueries() // balances/loans/accounts all shift on a close
  }

  const run = useMutation({
    mutationFn: (password: string) => window.api.close.run(password),
    onSuccess: (r) => {
      message.success(t('close.closed', { year: r.summary.year }))
      setGate(null)
      invalidate()
    },
    onError: (e: Error) => message.error(e.message)
  })
  const rollback = useMutation({
    mutationFn: (password: string) => window.api.close.rollback(password),
    onSuccess: (r) => {
      message.success(t('close.rolledBack', { year: r.year }))
      setGate(null)
      invalidate()
    },
    onError: (e: Error) => message.error(e.message)
  })

  const closed = status.data
  const year = session?.year ?? closed?.year ?? 0
  const nextYear = closed?.nextYear ?? year + 1
  const summary = closed?.summary ?? preview.data?.summary
  const exceptions = preview.data?.exceptions ?? []

  return (
    <div>
      <PageBanner
        title={t('close.title')}
        subtitle={t('close.subtitle', { year, next: nextYear })}
        extra={closed ? <Tag color="red">{t('close.closedTag')}</Tag> : <Tag color="green">{t('close.openTag')}</Tag>}
      />

      {closed && (
        <Alert
          style={{ marginBottom: 16 }}
          type="info"
          showIcon
          message={t('close.alreadyClosed', { year: closed.year, next: closed.nextYear })}
        />
      )}

      {summary && (
        <Card title={closed ? t('close.summary') : t('close.previewTitle')} style={{ marginBottom: 16 }}>
          <SummaryGrid summary={summary} />
        </Card>
      )}

      {!closed && (
        <Card title={t('close.exceptions')} style={{ marginBottom: 16 }}>
          {exceptions.length === 0 ? (
            <Typography.Text type="secondary">{t('close.noExceptions')}</Typography.Text>
          ) : (
            <List
              size="small"
              dataSource={exceptions}
              renderItem={(ex: CloseException) => (
                <List.Item>
                  <Space>
                    <SeverityTag severity="warning" icon>
                      {t(`close.ex.${ex.kind}`)}
                    </SeverityTag>
                    {ex.accountName && <strong>{ex.accountName}</strong>}
                    {ex.amountPaise !== undefined && <span>{formatINR(ex.amountPaise)}</span>}
                    <Typography.Text type="secondary">{exceptionDetail(t, ex)}</Typography.Text>
                  </Space>
                </List.Item>
              )}
            />
          )}
        </Card>
      )}

      {!closed && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={t('close.runWarningTitle')}
          description={t('close.runWarning')}
        />
      )}

      <Space>
        {closed ? (
          <Button danger onClick={() => setGate('rollback')} loading={rollback.isPending}>
            {t('close.rollback')}
          </Button>
        ) : (
          <Button type="primary" onClick={() => setGate('run')} loading={run.isPending}>
            {t('close.run')}
          </Button>
        )}
      </Space>

      {gate && (
        <PasswordGate
          confirmText={
            gate === 'run'
              ? t('close.runConfirm', { year, next: nextYear })
              : t('close.rollbackConfirm', { year })
          }
          okText={gate === 'run' ? t('close.run') : t('close.rollback')}
          danger={gate === 'rollback'}
          loading={run.isPending || rollback.isPending}
          onCancel={() => setGate(null)}
          onConfirm={(password) => (gate === 'run' ? run.mutate(password) : rollback.mutate(password))}
        />
      )}
    </div>
  )
}

function SummaryGrid({ summary }: { summary: CloseSummary }): JSX.Element {
  const { t } = useTranslation()
  return (
    <Descriptions column={3} size="small" bordered>
      <Descriptions.Item label={t('close.accountsCarried')}>{summary.accountsCarried}</Descriptions.Item>
      <Descriptions.Item label={t('close.totalDues')}>{formatINR(summary.totalDuesPaise)}</Descriptions.Item>
      <Descriptions.Item label={t('close.totalCredits')}>{formatINR(summary.totalCreditsPaise)}</Descriptions.Item>
      <Descriptions.Item label={t('close.indirectLoans')}>{summary.indirectLoans}</Descriptions.Item>
      <Descriptions.Item label={t('close.indirectLoanTotal')}>
        {formatINR(summary.indirectLoanTotalPaise)}
      </Descriptions.Item>
      <Descriptions.Item label={t('close.newDefaulters')}>{summary.newDefaulters}</Descriptions.Item>
      <Descriptions.Item label={t('close.loansCapitalised')}>{summary.loansCapitalised}</Descriptions.Item>
      <Descriptions.Item label={t('close.interestCapitalised')}>
        {formatINR(summary.interestCapitalisedPaise)}
      </Descriptions.Item>
      <Descriptions.Item label={t('close.leftoverPackets')}>{summary.leftoverPackets}</Descriptions.Item>
    </Descriptions>
  )
}

function PasswordGate({
  confirmText,
  okText,
  danger,
  loading,
  onCancel,
  onConfirm
}: {
  confirmText: string
  okText: string
  danger?: boolean
  loading: boolean
  onCancel: () => void
  onConfirm: (password: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  const [form] = Form.useForm()
  const formNav = useFormKeyNav({ onAccept: () => form.submit() })
  return (
    <AutoFocusModal
      open
      title={t('close.password')}
      okText={okText}
      okButtonProps={{ danger }}
      confirmLoading={loading}
      onCancel={onCancel}
      onOk={() => form.submit()}
    >
      <Typography.Paragraph>{confirmText}</Typography.Paragraph>
      <div ref={formNav.containerRef} onKeyDownCapture={formNav.onKeyDownCapture}>
      <Form form={form} onFinish={(v) => onConfirm(v.password)}>
        <Form.Item name="password" rules={[{ required: true }]} style={{ marginBottom: 0 }}>
          <Input.Password placeholder={t('close.passwordPlaceholder')} autoFocus />
        </Form.Item>
      </Form>
      </div>
    </AutoFocusModal>
  )
}
