import { ipcMain } from 'electron'
import type {
  AamadInput,
  AamadSearchFilter,
  MapType,
  NikasiInput,
  SaudaInput,
  StoreConfig
} from '../../shared/contracts'
import { createAamad, deleteAamad, getAamad, listAamad, updateAamad } from '../services/aamad'
import { createSauda, deleteSauda, latestRate, listSauda } from '../services/sauda'
import { createNikasi, deleteNikasi, getNikasi, listNikasi } from '../services/nikasi'
import { getMap, getRackStock, kisanStockLocations } from '../services/maps'
import { getStoreConfig, setStoreConfig } from '../services/store'
import { accrueAllRent } from '../engines/bhada'
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
  ipcMain.handle('sauda:latestRate', (_e, vyapariAccountId: number, kisanAccountId: number) =>
    latestRate(requireSession().yearId, vyapariAccountId, kisanAccountId)
  )

  // Nikasi
  ipcMain.handle('nikasi:create', (_e, input: NikasiInput) => {
    const s = requireOpenYear()
    return createNikasi(s.yearId, input, s.userId)
  })
  ipcMain.handle('nikasi:list', () => listNikasi(requireSession().yearId))
  ipcMain.handle('nikasi:get', (_e, id: number) => getNikasi(id))
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
}
