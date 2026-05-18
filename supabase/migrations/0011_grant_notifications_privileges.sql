-- Migration: Grant notifications table privileges to authenticated and service_role roles
-- Without these grants, PostgREST returns 403 Forbidden before RLS policies are evaluated.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL                             ON public.notifications TO service_role;
