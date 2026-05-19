-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Grant table privileges to Supabase roles
-- ─────────────────────────────────────────────────────────────────────────────
-- Tables created via raw SQL / Drizzle migrations do NOT automatically inherit
-- the default Supabase grants that Dashboard-created tables receive.
-- Without these GRANTs, every query returns "permission denied for table X"
-- even when RLS policies are correctly defined.
--
-- GRANT controls whether the role can touch the table at all.
-- RLS policies control which specific rows are visible/editable.
-- Both must be satisfied for a query to succeed.
-- ─────────────────────────────────────────────────────────────────────────────

-- Schema access
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- ── public.users ──────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.users TO authenticated;
GRANT SELECT                          ON public.users TO anon;
GRANT ALL                             ON public.users TO service_role;

-- ── public.departments ───────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.departments TO authenticated;
GRANT ALL                             ON public.departments TO service_role;

-- ── public.thrust_areas ──────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.thrust_areas TO authenticated;
GRANT ALL                             ON public.thrust_areas TO service_role;

-- ── public.cycles ────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cycles TO authenticated;
GRANT ALL                             ON public.cycles TO service_role;

-- ── public.check_in_windows ──────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.check_in_windows TO authenticated;
GRANT ALL                             ON public.check_in_windows TO service_role;

-- ── public.goal_sheets ───────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.goal_sheets TO authenticated;
GRANT ALL                             ON public.goal_sheets TO service_role;

-- ── public.goals ─────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.goals TO authenticated;
GRANT ALL                             ON public.goals TO service_role;

-- ── public.check_ins ─────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.check_ins TO authenticated;
GRANT ALL                             ON public.check_ins TO service_role;

-- ── public.manager_comments ──────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE  ON public.manager_comments TO authenticated;
GRANT ALL                             ON public.manager_comments TO service_role;

-- ── public.audit_log ─────────────────────────────────────────────────────────
GRANT SELECT, INSERT                  ON public.audit_log TO authenticated;
GRANT ALL                             ON public.audit_log TO service_role;

-- ── public.escalation_log ────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE          ON public.escalation_log TO authenticated;
GRANT ALL                             ON public.escalation_log TO service_role;

-- ── public.bot_user_links ────────────────────────────────────────────────────
GRANT SELECT, INSERT, DELETE          ON public.bot_user_links TO authenticated;
GRANT ALL                             ON public.bot_user_links TO service_role;

-- ── public.app_settings ──────────────────────────────────────────────────────
GRANT SELECT          ON public.app_settings TO anon, authenticated;
GRANT INSERT, UPDATE  ON public.app_settings TO authenticated;
GRANT ALL             ON public.app_settings TO service_role;
