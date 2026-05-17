-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: User Notification Preferences
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.notification_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE UNIQUE NOT NULL,
    email_enabled BOOLEAN DEFAULT true NOT NULL,
    teams_enabled BOOLEAN DEFAULT false NOT NULL,
    reminder_days_before INTEGER DEFAULT 3 NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Enable RLS
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they already exist to avoid execution conflicts
DROP POLICY IF EXISTS "Users can view their own notification preferences" ON public.notification_preferences;
DROP POLICY IF EXISTS "Users can update their own notification preferences" ON public.notification_preferences;

-- Select policy
CREATE POLICY "Users can view their own notification preferences"
    ON public.notification_preferences FOR SELECT
    USING (auth.uid() = (SELECT auth_id FROM public.users WHERE id = user_id));

-- Upsert policy
CREATE POLICY "Users can update their own notification preferences"
    ON public.notification_preferences FOR ALL
    USING (auth.uid() = (SELECT auth_id FROM public.users WHERE id = user_id))
    WITH CHECK (auth.uid() = (SELECT auth_id FROM public.users WHERE id = user_id));
