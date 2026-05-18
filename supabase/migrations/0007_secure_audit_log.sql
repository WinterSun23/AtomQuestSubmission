-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Secure public.audit_log table via strict RLS
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable RLS on audit_log
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- 1. Policy to allow reading audit log entries
DROP POLICY IF EXISTS "Users can view audit log" ON public.audit_log;
CREATE POLICY "Users can view audit log"
    ON public.audit_log FOR SELECT
    USING (auth.role() = 'authenticated');

-- 2. Policy to allow writing audit log entries
DROP POLICY IF EXISTS "System can insert audit log" ON public.audit_log;
CREATE POLICY "System can insert audit log"
    ON public.audit_log FOR INSERT
    WITH CHECK (auth.role() = 'authenticated');

-- Note: Because there is no UPDATE or DELETE policy, PostgreSQL will reject all
-- update and delete requests by default for all authenticated users, including admins!
