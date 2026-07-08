-- Custom SQL migration file, put your code below! --

-- Backfill aamad_id on nikasi lines created before the lot feature. Each pre-feature line names a
-- kisan + room/floor/rack; attribute it to an aamad that placed stock at that exact spot for that
-- kisan (lowest id if a kisan happens to have two lots on one rack — a cosmetic tie-break; the
-- rack-level maps are unaffected either way). Without this, legacy lines are invisible to per-lot
-- "remaining", so the picker over-reports available stock.
UPDATE nikasi_line
SET aamad_id = (
  SELECT al.aamad_id
  FROM aamad_location al
  JOIN aamad a ON al.aamad_id = a.id
  WHERE a.kisan_account_id = nikasi_line.from_kisan_account_id
    AND al.room = nikasi_line.room
    AND al.floor = nikasi_line.floor
    AND al.rack = nikasi_line.rack
  ORDER BY al.aamad_id
  LIMIT 1
)
WHERE aamad_id IS NULL;