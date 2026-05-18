-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Add manager_comment column to public.check_ins
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.check_ins ADD COLUMN IF NOT EXISTS manager_comment text;
