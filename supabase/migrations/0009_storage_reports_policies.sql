-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Add explicit storage policies for reports bucket management
-- ─────────────────────────────────────────────────────────────────────────────

-- Drop existing overlapping policies to prevent conflicts
DROP POLICY IF EXISTS "Admins and Managers can insert reports" ON storage.objects;
DROP POLICY IF EXISTS "Admins and Managers can delete reports" ON storage.objects;

-- Allow authenticated Admins and Managers to insert reports
CREATE POLICY "Admins and Managers can insert reports"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'reports' AND
  EXISTS (
    SELECT 1 FROM public.users 
    WHERE users.auth_id = auth.uid() 
    AND (users.role = 'admin' OR users.role = 'manager')
  )
);

-- Allow authenticated Admins and Managers to delete reports (for upserts)
CREATE POLICY "Admins and Managers can delete reports"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'reports' AND
  EXISTS (
    SELECT 1 FROM public.users 
    WHERE users.auth_id = auth.uid() 
    AND (users.role = 'admin' OR users.role = 'manager')
  )
);
