-- Custom SQL migration file, put your code below! --

-- Backfill for cheques cleared before the clear-time narration fix. Their entry voucher still ends
-- in "(in clearing)" even though the money has moved, so the party ledger/bill reads e.g.
-- "Cheque 123456 given (in clearing)" for a settled cheque. Strip just that trailing marker (both
-- the cheque module and loan disbursement/repayment append it) for cheques now marked cleared.
UPDATE voucher
SET narration = substr(narration, 1, length(narration) - length(' (in clearing)'))
WHERE id IN (SELECT voucher_id FROM cheque WHERE status = 'cleared' AND voucher_id IS NOT NULL)
  AND narration LIKE '% (in clearing)';
