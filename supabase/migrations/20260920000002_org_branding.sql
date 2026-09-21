-- ==========================================
-- Organization branding: logo + brand color
--
-- Adds the columns needed to let a manager upload a university logo
-- and set a brand color, plus the storage bucket that logo uploads go
-- into. Uploads go through packages/server/src/services/storage.service.ts's
-- uploadToBucket(), which uses the service-role client — writes bypass
-- RLS entirely, so only a public-read policy is needed here (the
-- bucket is also marked public, which alone is enough for
-- getPublicUrl() to be fetchable, but the explicit policy documents
-- the intent and matches the pattern used for assignment-images in
-- 20260713000001_teacher_assignments.sql).
-- ==========================================

ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS logo_url text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS brand_color text;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'org-logos',
  'org-logos',
  true,
  5242880,
  ARRAY['image/png', 'image/jpeg', 'image/gif', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "org_logos_select_public"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'org-logos');
