-- ============================================================
-- Migration: Add 'deleted' and 'edited' to messages_status_check
-- ============================================================

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_status_check;

ALTER TABLE messages
  ADD CONSTRAINT messages_status_check
  CHECK (status IN ('sending', 'sent', 'delivered', 'read', 'failed', 'deleted', 'edited'));
