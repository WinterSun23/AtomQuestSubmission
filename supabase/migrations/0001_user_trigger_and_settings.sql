-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Auto-provision public.users on auth.users INSERT + App Settings
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Trigger function: runs every time auth creates a new user ──────────────
--    Works for email/password, Google, Microsoft, and any future provider.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER                        -- runs as DB owner, can write to public.users
SET search_path = public
AS $$
DECLARE
  _name text;
BEGIN
  -- Pull name from OAuth metadata (full_name, name) or fall back to email prefix
  _name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    split_part(NEW.email, '@', 1)
  );

  INSERT INTO public.users (auth_id, email, name, role)
  VALUES (NEW.id, NEW.email, _name, 'employee')
  ON CONFLICT (auth_id) DO NOTHING;   -- idempotent: SSO re-logins won't duplicate

  RETURN NEW;
END;
$$;

-- ── Attach trigger to auth.users ─────────────────────────────────────────────
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_auth_user();

-- ── 2. App-wide settings table ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.app_settings (
  key         varchar(100) PRIMARY KEY,
  value       text         NOT NULL,
  description text,
  updated_at  timestamp    NOT NULL DEFAULT now(),
  updated_by  uuid         REFERENCES public.users(id)
);

-- Seed default settings
INSERT INTO public.app_settings (key, value, description) VALUES
  ('mfa_required',        'false', 'Require TOTP MFA for all users after login'),
  ('mfa_enrollment_grace','7',     'Days a user can skip MFA enrollment after first login'),
  ('goal_window_open',    'true',  'Whether the current goal creation window is open'),
  ('escalation_enabled',  'true',  'Whether the escalation cron job is active'),
  ('max_goals_per_sheet', '8',     'Maximum goals an employee can add to one sheet'),
  ('min_goal_weightage',  '10',    'Minimum weightage allowed per goal (percent)')
ON CONFLICT (key) DO NOTHING;

-- ── 3. RLS Policies for app_settings ─────────────────────────────────────────
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- ── Helper functions (SECURITY DEFINER = bypass RLS, runs as DB owner) ─────────
-- These are the ONLY safe way to check role/id inside RLS policies on the
-- same table. Calling SELECT on public.users inside a public.users policy
-- causes infinite recursion; SECURITY DEFINER functions avoid that.

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role::text FROM public.users WHERE auth_id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_my_portal_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.users WHERE auth_id = auth.uid() LIMIT 1;
$$;

-- Everyone can read settings
CREATE POLICY "settings_read_all"
  ON public.app_settings FOR SELECT
  USING (true);

-- Only admins can update settings (uses helper — no recursion)
CREATE POLICY "settings_write_admin"
  ON public.app_settings FOR ALL
  USING (public.get_my_role() = 'admin');

-- ── 4. RLS Policies for public.users ─────────────────────────────────────────
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Own row — auth_id = auth.uid() is a direct column check, no subquery, no recursion
CREATE POLICY "users_read_own"
  ON public.users FOR SELECT
  USING (auth_id = auth.uid());

-- Managers see their direct reports
-- get_my_portal_id() is SECURITY DEFINER → queries users without RLS → no recursion
CREATE POLICY "users_read_direct_reports"
  ON public.users FOR SELECT
  USING (manager_id = public.get_my_portal_id());

-- Admins read all users
CREATE POLICY "users_read_admin"
  ON public.users FOR SELECT
  USING (public.get_my_role() = 'admin');

-- Admins update any user (role assignment, manager reassignment)
CREATE POLICY "users_write_admin"
  ON public.users FOR UPDATE
  USING (public.get_my_role() = 'admin');

-- The trigger function (SECURITY DEFINER) handles INSERT — no INSERT policy needed
