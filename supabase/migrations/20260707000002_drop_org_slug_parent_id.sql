-- Drop slug and parent_id from organizations table
ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_parent_id_fkey;
ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_slug_key;
ALTER TABLE public.organizations DROP COLUMN IF EXISTS slug;
ALTER TABLE public.organizations DROP COLUMN IF EXISTS parent_id;
