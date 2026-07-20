import { ipcMain } from 'electron'
import type {
  AamadInput,
  AamadSearchFilter,
  MapType,
  NikasiInput,
  NikasiListFilter,
  SaudaInput,
  StoreConfig
} from '../../shared/contracts'
import { createAamad, deleteAamad, getAamad, listAamad, updateAamad } from '../services/aamad'
import { createSauda, deleteSauda, listSauda, rateForLifting, settleSauda, unsettleSauda } from '../services/sauda'
import { createNikasi, deleteNikasi, getNikasi, listNikasi, lotsWithRemaining } from '../services/nikasi'
import { getMap, getRackStock, kisanStockLocations } from '../services/maps'
import { getStoreConfig, setStoreConfig } from '../services/store'
import { accrueAllRent, getRentReport, setRentRate } from '../engines/bhada'
import { requireOpenYear, requireSession } from '../session'

/** Phase 2 IPC — store layout, Aamad, Sauda, Nikasi, Maps, and the Bhada engine. */
export function registerStockIpc(): void {
  // Store layout
  ipcMain.handle('store:get', () => getStoreConfig())
  ipcMain.handle('store:set', (_e, cfg: StoreConfig) =>
    setStoreConfig(cfg, requireSession().userId)
  )

  // Aamad
  ipcMain.handle('aamad:create', (_e, input: AamadInput) => {
    const s = requireOpenYear()
    return createAamad(s.yearId, input, s.userId)
  })
  ipcMain.handle('aamad:update', (_e, id: number, input: AamadInput) => {
    const s = requireSession()
    return updateAamad(s.yearId, id, input, s.userId)
  })
  ipcMain.handle('aamad:list', (_e, filter?: AamadSearchFilter) =>
    listAamad(requireSession().yearId, filter)
  )
  ipcMain.handle('aamad:get', (_e, id: number) => {
    requireSession()
    return getAamad(id)
  })
  ipcMain.handle('aamad:delete', (_e, id: number) => {
    const s = requireOpenYear()
    return deleteAamad(s.yearId, id, s.userId)
  })

  // Sauda
  ipcMain.handle('sauda:create', (_e, input: SaudaInput) => {
    const s = requireOpenYear()
    return createSauda(s.yearId, input, s.userId)
  })
  ipcMain.handle('sauda:list', () => listSauda(requireSession().yearId))
  ipcMain.handle('sauda:delete', (_e, id: number) => {
    const s = requireOpenYear()
    return deleteSauda(s.yearId, id, s.userId)
  })
  ipcMain.handle('sauda:rateForLifting', (_e, vyapariAccountId: number, kisanAccountId: number) =>
    rateForLifting(requireSession().yearId, vyapariAccountId, kisanAccountId)
  )
  ipcMain.handle('sauda:settle', (_e, id: number, input: { date: string; amountPaise: number }) => {
    const s = requireOpenYear()
    return settleSauda(s.yearId, id, input, s.userId)
  })
  ipcMain.handle('sauda:unsettle', (_e, id: number) => {
    const s = requireOpenYear()
    return unsettleSauda(s.yearId, id, s.userId)
  })

  // Nikasi
  ipcMain.handle('nikasi:create', (_e, input: NikasiInput) => {
    const s = requireOpenYear()
    return createNikasi(s.yearId, input, s.userId)
  })
  ipcMain.handle('nikasi:list', (_e, filter?: NikasiListFilter) =>
    listNikasi(requireSession().yearId, filter)
  )
  ipcMain.handle('nikasi:get', (_e, id: number) => getNikasi(id))
  ipcMain.handle('nikasi:lots', (_e, kisanAccountId?: number) =>
    lotsWithRemaining(requireSession().yearId, kisanAccountId)
  )
  ipcMain.handle('nikasi:delete', (_e, id: number) => {
    const s = requireOpenYear()
    return deleteNikasi(s.yearId, id, s.userId)
  })

  // Maps
  ipcMain.handle('maps:get', (_e, type: MapType) => getMap(requireSession().yearId, type))
  ipcMain.handle('maps:racks', (_e, room: number, floor: number, type: MapType) =>
    getRackStock(requireSession().yearId, room, floor, type)
  )
  ipcMain.handle('maps:kisanStock', (_e, kisanAccountId: number) =>
    kisanStockLocations(requireSession().yearId, kisanAccountId)
  )

  // Bhada
  ipcMain.handle('bhada:accrueAll', (_e, date: string) => {
    const s = requireOpenYear()
    return accrueAllRent(s.yearId, date, s.userId)
  })
  ipcMain.handle('bhada:setRate', (_e, ratePaise: number, date: string) => {
    const s = requireOpenYear()
    return setRentRate(s.yearId, ratePaise, date, s.userId)
  })
  ipcMain.handle('bhada:report', () => {
    const s = requireOpenYear()
    return getRentReport(s.yearId)
  })
}
