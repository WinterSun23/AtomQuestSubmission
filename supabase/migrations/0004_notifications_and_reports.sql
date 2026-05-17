CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    link TEXT,
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own notifications"
    ON public.notifications FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own notifications"
    ON public.notifications FOR UPDATE
    USING (auth.uid() = user_id);

-- Create reports bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public) 
VALUES ('reports', 'reports', false)
ON CONFLICT (id) DO NOTHING;

-- Bucket policies
CREATE POLICY "Admins and Managers can view reports"
ON storage.objects FOR SELECT
USING ( bucket_id = 'reports' AND (
  EXISTS (
    SELECT 1 FROM public.users 
    WHERE users.auth_id = auth.uid() 
    AND (users.role = 'admin' OR users.role = 'manager')
  )
));

CREATE POLICY "Service role can insert reports"
ON storage.objects FOR INSERT
WITH CHECK ( bucket_id = 'reports' );
