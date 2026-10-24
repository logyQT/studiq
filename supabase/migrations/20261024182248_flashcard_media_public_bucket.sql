-- ==========================================
-- Flashcard media bucket becomes public-read (#185)
--
-- storage.service.ts#uploadFile() returns getPublicUrl(), and those URLs are
-- persisted inside flashcard markdown (images + <audio>), so they must stay
-- loadable forever — an expiring signed URL is not an option here. The bucket
-- was created private, which made every returned URL answer
-- 400 {"error":"Bucket not found"}.
--
-- Writes still go exclusively through the service-role client
-- (packages/server/src/lib/supabase/service.ts), which bypasses RLS, so only a
-- public-read policy is needed — the same pattern as org-logos
-- (20260920000002_org_branding.sql) and assignment-images
-- (20260713000001_teacher_assignments.sql). Existing objects become readable
-- as soon as the bucket flips public; no backfill.
--
-- config.toml carries the same setting for local `supabase start` / `db reset`.
-- ==========================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'flashcard-media',
  'flashcard-media',
  true,
  52428800,
  ARRAY['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'audio/mpeg', 'audio/wav', 'audio/ogg']
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "flashcard_media_select_public" ON storage.objects;

CREATE POLICY "flashcard_media_select_public"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'flashcard-media');
