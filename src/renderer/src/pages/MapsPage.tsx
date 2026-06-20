import { useState } from 'react'
import { Card, Drawer, Segmented, Space, Statistic, Table, Typography } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { MapType } from '@shared/contracts'

export default function MapsPage(): JSX.Element {
  const { t } = useTranslation()
  const [type, setType] = useState<MapType>('current')
  const [cell, setCell] = useState<{ room: number; floor: number } | null>(null)

  const map = useQuery({ queryKey: ['maps', type], queryFn: () => window.api.maps.get(type) })
  const racks = useQuery({
    queryKey: ['maps', 'racks', type, cell?.room, cell?.floor],
    queryFn: () => window.api.maps.racks(cell!.room, cell!.floor, type),
    enabled: cell !== null
  })

  const packetsAt = (room: number, floor: number): number =>
    map.data?.cells.find((c) => c.room === room && c.floor === floor)?.packets ?? 0

  const rooms = map.data?.rooms ?? 0
  const floors = map.data?.floors ?? 0

  const cellStyle: React.CSSProperties = {
    border: '1px solid #f0f0f0',
    padding: '10px 8px',
    textAlign: 'center',
    cursor: 'pointer',
    minWidth: 64
  }
  const headStyle: React.CSSProperties = { ...cellStyle, cursor: 'default', background: '#fafafa', fontWeight: 600 }

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {t('maps.title')}
        </Typography.Title>
        <Segmented
          value={type}
          onChange={(v) => setType(v as MapType)}
          options={[
            { value: 'aamad', label: t('maps.aamad') },
            { value: 'nikasi', label: t('maps.nikasi') },
            { value: 'current', label: t('maps.current') }
          ]}
        />
      </Space>

      <Statistic title={t('maps.total')} value={map.data?.totalPackets ?? 0} style={{ marginBottom: 16 }} />

      <Card loading={map.isLoading} styles={{ body: { overflowX: 'auto' } }}>
        <table style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={headStyle}>{t('maps.floor')} \ {t('maps.room')}</th>
              {Array.from({ length: rooms }, (_, i) => i + 1).map((room) => (
                <th key={room} style={headStyle}>
                  {room}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: floors }, (_, i) => i + 1).map((floor) => (
              <tr key={floor}>
                <td style={headStyle}>{floor}</td>
                {Array.from({ length: rooms }, (_, i) => i + 1).map((room) => {
                  const p = packetsAt(room, floor)
                  return (
                    <td
                      key={room}
                      style={{
                        ...cellStyle,
                        background: p > 0 ? '#e6f4ff' : undefined,
                        color: p > 0 ? '#0958d9' : '#bfbfbf'
                      }}
                      onClick={() => setCell({ room, floor })}
                    >
                      {p || '·'}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Drawer
        title={
          cell
            ? `${t('maps.rackDetail')} — ${t('maps.room')} ${cell.room} / ${t('maps.floor')} ${cell.floor}`
            : ''
        }
        open={cell !== null}
        onClose={() => setCell(null)}
        width={520}
      >
        <Table
          rowKey={(r) => `${r.rack}:${r.kisanAccountId}`}
          size="small"
          loading={racks.isLoading}
          pagination={false}
          locale={{ emptyText: t('maps.empty') }}
          dataSource={racks.data ?? []}
          columns={[
            { title: t('maps.rack'), dataIndex: 'rack', width: 90 },
            { title: t('aamad.kisan'), dataIndex: 'kisanName' },
            { title: t('maps.packets'), dataIndex: 'packets', align: 'right' as const, width: 110 }
          ]}
        />
      </Drawer>
    </div>
  )
}
