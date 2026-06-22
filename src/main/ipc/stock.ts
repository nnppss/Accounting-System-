import { ipcMain } from 'electron'
import type {
  AamadInput,
  AamadSearchFilter,
  MapType,
  NikasiInput,
  SaudaInput,
  StoreConfig
} from '../../shared/contracts'
import { createAamad, deleteAamad, getAamad, listAamad } from '../services/aamad'
import { createSauda, deleteSauda, latestRate, listSauda } from '../services/sauda'
import { createNikasi, deleteNikasi, getNikasi, listNikasi } from '../services/nikasi'
import { getMap, getRackStock } from '../services/maps'
import { getStoreConfig, setStoreConfig } from '../services/store'
import { accrueAllRent, accrueRent, getStandingBhada } from '../engines/bhada'
import { requireSession } from '../session'

/** Phase 2 IPC — store layout, Aamad, Sauda, Nikasi, Maps, and the Bhada engine. */
export function registerStockIpc(): void {
  // Store layout
  ipcMain.handle('store:get', () => getStoreConfig())
  ipcMain.handle('store:set', (_e, cfg: StoreConfig) =>
    setStoreConfig(cfg, requireSession().userId)
  )

  // Aamad
  ipcMain.handle('aamad:create', (_e, input: AamadInput) => {
    const s = requireSession()
    return createAamad(s.yearId, input, s.userId)
  })
  ipcMain.handle('aamad:list', (_e, filter?: AamadSearchFilter) =>
    listAamad(requireSession().yearId, filter)
  )
  ipcMain.handle('aamad:get', (_e, id: number) => getAamad(id))
  ipcMain.handle('aamad:delete', (_e, id: number) => {
    const s = requireSession()
    return deleteAamad(s.yearId, id, s.userId)
  })

  // Sauda
  ipcMain.handle('sauda:create', (_e, input: SaudaInput) => {
    const s = requireSession()
    return createSauda(s.yearId, input, s.userId)
  })
  ipcMain.handle('sauda:list', () => listSauda(requireSession().yearId))
  ipcMain.handle('sauda:delete', (_e, id: number) => {
    const s = requireSession()
    return deleteSauda(s.yearId, id, s.userId)
  })
  ipcMain.handle('sauda:latestRate', (_e, vyapariAccountId: number, kisanAccountId: number) =>
    latestRate(requireSession().yearId, vyapariAccountId, kisanAccountId)
  )

  // Nikasi
  ipcMain.handle('nikasi:create', (_e, input: NikasiInput) => {
    const s = requireSession()
    return createNikasi(s.yearId, input, s.userId)
  })
  ipcMain.handle('nikasi:list', () => listNikasi(requireSession().yearId))
  ipcMain.handle('nikasi:get', (_e, id: number) => getNikasi(id))
  ipcMain.handle('nikasi:delete', (_e, id: number) => {
    const s = requireSession()
    return deleteNikasi(s.yearId, id, s.userId)
  })

  // Maps
  ipcMain.handle('maps:get', (_e, type: MapType) => getMap(requireSession().yearId, type))
  ipcMain.handle('maps:racks', (_e, room: number, floor: number, type: MapType) =>
    getRackStock(requireSession().yearId, room, floor, type)
  )

  // Bhada
  ipcMain.handle('bhada:accrue', (_e, kisanAccountId: number, date: string) => {
    const s = requireSession()
    return accrueRent(kisanAccountId, s.yearId, date, s.userId)
  })
  ipcMain.handle('bhada:accrueAll', (_e, date: string) => {
    const s = requireSession()
    return accrueAllRent(s.yearId, date, s.userId)
  })
  ipcMain.handle('bhada:standing', (_e, kisanAccountId: number) =>
    getStandingBhada(kisanAccountId, requireSession().yearId)
  )
}
