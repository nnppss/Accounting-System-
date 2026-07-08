import { useEffect, useRef, useState } from 'react'
import { Card, Drawer, Segmented, Statistic, Table } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { MapType } from '@shared/contracts'
import { palette } from '../theme'
import { PageBanner } from '../components/report'

export default function MapsPage(): JSX.Element {
  const { t } = useTranslation()
  const [type, setType] = useState<MapType>('current')
  const [cell, setCell] = useState<{ room: number; floor: number } | null>(null)
  // Keyboard cursor over the grid (Tally-style: arrows move, Enter opens the rack drawer).
  const [active, setActive] = useState<{ room: number; floor: number }>({ room: 1, floor: 1 })

  const map = useQuery({ queryKey: ['maps', type], queryFn: () => window.api.maps.get(type) })
  const racks = useQuery({
    queryKey: ['maps', 'racks', type, cell?.room, cell?.floor],
    queryFn: () => window.api.maps.racks(cell!.room, cell!.floor, type),
    enabled: cell !== null
  })

  const packetsAt = (room: number, floor: number): number =>
    map.data?.cells.find((c) => c.room === room && c.floor === floor)?.packets ?? 0

  const roomTotal = (room: number): number =>
    map.data?.cells.filter((c) => c.room === room).reduce((s, c) => s + c.packets, 0) ?? 0

  const rooms = map.data?.rooms ?? 0
  const floors = map.data?.floors ?? 0

  // Arrow keys move the cursor across the grid; Enter opens the highlighted cell's racks.
  const activeRef = useRef(active)
  activeRef.current = active
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (cell !== null) return // drawer open — let it handle keys
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      if (el?.closest('#pc-top-nav')) return // top nav focused — its arrows drive the menu
      if (rooms === 0 || floors === 0) return
      const a = activeRef.current
      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault()
          setActive({ ...a, room: Math.min(a.room + 1, rooms) })
          break
        case 'ArrowLeft':
          e.preventDefault()
          setActive({ ...a, room: Math.max(a.room - 1, 1) })
          break
        case 'ArrowDown':
          e.preventDefault()
          setActive({ ...a, floor: Math.min(a.floor + 1, floors) })
          break
        case 'ArrowUp':
          e.preventDefault()
          setActive({ ...a, floor: Math.max(a.floor - 1, 1) })
          break
        case 'Enter':
          e.preventDefault()
          setCell({ room: a.room, floor: a.floor })
          break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [cell, rooms, floors])

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
      <PageBanner
        title={t('maps.title')}
        extra={
          <Segmented
            value={type}
            onChange={(v) => setType(v as MapType)}
            options={[
              { value: 'aamad', label: t('maps.aamad') },
              { value: 'nikasi', label: t('maps.nikasi') },
              { value: 'current', label: t('maps.current') }
            ]}
          />
        }
      />

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
                  const isActive = active.room === room && active.floor === floor
                  return (
                    <td
                      key={room}
                      style={{
                        ...cellStyle,
                        background: isActive ? palette.primaryFixed : p > 0 ? '#e6f4ff' : undefined,
                        color: p > 0 ? '#0958d9' : '#bfbfbf',
                        outline: isActive ? `2px solid ${palette.primary}` : undefined,
                        outlineOffset: -2
                      }}
                      onClick={() => {
                        setActive({ room, floor })
                        setCell({ room, floor })
                      }}
                    >
                      {p || '·'}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td style={headStyle}>{t('maps.total')}</td>
              {Array.from({ length: rooms }, (_, i) => i + 1).map((room) => {
                const p = roomTotal(room)
                return (
                  <td key={room} style={{ ...headStyle, color: p > 0 ? '#0958d9' : '#bfbfbf' }}>
                    {p || '·'}
                  </td>
                )
              })}
            </tr>
          </tfoot>
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
