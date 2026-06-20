import { eq } from 'drizzle-orm'
import { db } from '../data/db'
import { storeConfig } from '../data/schema'
import type { StoreConfig } from '../../shared/contracts'
import { writeAudit } from '../audit/audit'

/** Store layout config (phase1.md §7 / plan Phase 2): Room → Floor → Rack, cap 8×10×200. */
export type { StoreConfig } from '../../shared/contracts'

const MAX = { rooms: 8, floors: 10, racksPerFloor: 200 }

export function getStoreConfig(): StoreConfig {
  const row = db().select().from(storeConfig).get()
  if (!row) throw new Error('Store config missing — was seedReferenceData() called?')
  return { rooms: row.rooms, floors: row.floors, racksPerFloor: row.racksPerFloor }
}

export function setStoreConfig(cfg: StoreConfig, userId?: number): void {
  if (cfg.rooms < 1 || cfg.rooms > MAX.rooms) throw new Error(`Rooms must be 1–${MAX.rooms}`)
  if (cfg.floors < 1 || cfg.floors > MAX.floors) throw new Error(`Floors must be 1–${MAX.floors}`)
  if (cfg.racksPerFloor < 1 || cfg.racksPerFloor > MAX.racksPerFloor) {
    throw new Error(`Racks per floor must be 1–${MAX.racksPerFloor}`)
  }
  const existing = db().select().from(storeConfig).get()
  if (!existing) {
    db().insert(storeConfig).values(cfg).run()
  } else {
    db().update(storeConfig).set(cfg).where(eq(storeConfig.id, existing.id)).run()
  }
  writeAudit({ userId, action: 'update', entity: 'store_config', after: cfg })
}

/** Validate a Room/Floor/Rack triple is inside the configured store. */
export function assertLocationInBounds(room: number, floor: number, rack: number): void {
  const cfg = getStoreConfig()
  if (!Number.isInteger(room) || room < 1 || room > cfg.rooms) {
    throw new Error(`Room ${room} out of range (1–${cfg.rooms})`)
  }
  if (!Number.isInteger(floor) || floor < 1 || floor > cfg.floors) {
    throw new Error(`Floor ${floor} out of range (1–${cfg.floors})`)
  }
  if (!Number.isInteger(rack) || rack < 1 || rack > cfg.racksPerFloor) {
    throw new Error(`Rack ${rack} out of range (1–${cfg.racksPerFloor})`)
  }
}
