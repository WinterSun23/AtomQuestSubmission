-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Add severity threshold preferences
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.notification_preferences 
ADD COLUMN IF NOT EXISTS min_email_severity VARCHAR(10) DEFAULT 'low' NOT NULL,
ADD COLUMN IF NOT EXISTS min_teams_severity VARCHAR(10) DEFAULT 'low' NOT NULL;
