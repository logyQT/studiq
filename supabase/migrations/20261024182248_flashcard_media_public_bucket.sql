-- ==========================================
-- Flashcard media bucket becomes public-read (#185)
--
-- storage.service.ts#uploadFile() returns getPublicUrl(), and those URLs are
-- persisted inside flashcard markdown (images + <audio>), so they must stay
-- loadable forever — an expiring signed URL is not an option here. The bucket
-- was created private, which made every returned URL answer
-- 400 {"error":"Bucket not found"}.
--
-- `buckets.public = true` is what makes /object/public/... fetchable. Do NOT add
-- a storage.objects SELECT policy: it would also authorise the Storage list
-- endpoint (POST /storage/v1/object/list/flashcard-media) for anon, letting
-- anyone enumerate every user's media. The app never lists/downloads with a user
-- JWT — writes and reads go through the service-role client (bypasses RLS) and
-- public URLs, so no policy is needed. (review-1-r1, finding #1)
--
-- Writes still go exclusively through the service-role client
-- (packages/server/src/lib/supabase/service.ts). Existing objects become
-- readable as soon as the bucket flips public; no backfill.
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
