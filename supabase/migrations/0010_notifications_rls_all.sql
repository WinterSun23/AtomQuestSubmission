-- Migration: Complete Notifications RLS Overhaul
-- Drops existing partial policies and ensures complete CRUD permissions linked to profile ID

DROP POLICY IF EXISTS "Users can view their own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can update their own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can delete their own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can select own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can delete own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can insert own notifications" ON public.notifications;

-- 1. SELECT: Users can retrieve their own notifications
CREATE POLICY "Users can select own notifications"
    ON public.notifications FOR SELECT
    USING (public.get_my_portal_id() = user_id);

-- 2. UPDATE: Users can update their own notifications
CREATE POLICY "Users can update own notifications"
    ON public.notifications FOR UPDATE
    USING (public.get_my_portal_id() = user_id);

-- 3. DELETE: Users can delete their own notifications (critical for delete-on-read)
CREATE POLICY "Users can delete own notifications"
    ON public.notifications FOR DELETE
    USING (public.get_my_portal_id() = user_id);

-- 4. INSERT: Users/System can create notifications for this user
CREATE POLICY "Users can insert own notifications"
    ON public.notifications FOR INSERT
    WITH CHECK (public.get_my_portal_id() = user_id);
