-- Migration: Robust Direct Notifications RLS Policies
-- Bypasses get_my_portal_id() function to prevent context-switching issues with auth.uid()

DROP POLICY IF EXISTS "Users can select own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can delete own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can insert own notifications" ON public.notifications;

-- 1. SELECT: Direct subquery match on auth.uid()
CREATE POLICY "Users can select own notifications"
    ON public.notifications FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.users
        WHERE users.id = notifications.user_id
        AND users.auth_id = auth.uid()
    ));

-- 2. UPDATE: Direct subquery match on auth.uid()
CREATE POLICY "Users can update own notifications"
    ON public.notifications FOR UPDATE
    USING (EXISTS (
        SELECT 1 FROM public.users
        WHERE users.id = notifications.user_id
        AND users.auth_id = auth.uid()
    ));

-- 3. DELETE: Direct subquery match on auth.uid()
CREATE POLICY "Users can delete own notifications"
    ON public.notifications FOR DELETE
    USING (EXISTS (
        SELECT 1 FROM public.users
        WHERE users.id = notifications.user_id
        AND users.auth_id = auth.uid()
    ));

-- 4. INSERT: Direct subquery match on auth.uid()
CREATE POLICY "Users can insert own notifications"
    ON public.notifications FOR INSERT
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.users
        WHERE users.id = notifications.user_id
        AND users.auth_id = auth.uid()
    ));
