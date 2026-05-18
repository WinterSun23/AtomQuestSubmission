-- Migration: Complete Notification Preferences Grants & RLS Overhaul
-- Without these grants, PostgREST returns 403 Forbidden before RLS policies are evaluated.

-- 1. Grant table privileges (Critical to prevent 403 Forbidden)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_preferences TO authenticated;
GRANT ALL                             ON public.notification_preferences TO service_role;

-- 2. Drop existing policies to prevent conflicts
DROP POLICY IF EXISTS "Users can view their own notification preferences" ON public.notification_preferences;
DROP POLICY IF EXISTS "Users can update their own notification preferences" ON public.notification_preferences;

-- 3. SELECT policy: Direct EXISTS check matching logged-in auth_id
CREATE POLICY "Users can view their own notification preferences"
    ON public.notification_preferences FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.users
        WHERE users.id = notification_preferences.user_id
        AND users.auth_id = auth.uid()
    ));

-- 4. ALL policy (Insert/Update/Delete): Direct EXISTS check matching logged-in auth_id
CREATE POLICY "Users can update their own notification preferences"
    ON public.notification_preferences FOR ALL
    USING (EXISTS (
        SELECT 1 FROM public.users
        WHERE users.id = notification_preferences.user_id
        AND users.auth_id = auth.uid()
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.users
        WHERE users.id = notification_preferences.user_id
        AND users.auth_id = auth.uid()
    ));
