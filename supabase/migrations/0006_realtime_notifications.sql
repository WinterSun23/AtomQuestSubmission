-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Enable Realtime WebSockets for notifications table
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable full replica identity for comprehensive realtime update payloads
ALTER TABLE public.notifications REPLICA IDENTITY FULL;

-- Add notifications table safely to the Supabase Realtime publication
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables 
      WHERE pubname = 'supabase_realtime' 
        AND schemaname = 'public' 
        AND tablename = 'notifications'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
    END IF;
  END IF;
END $$;
