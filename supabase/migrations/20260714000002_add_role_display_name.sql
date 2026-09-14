ALTER TABLE public.org_roles ADD COLUMN display_name text;

UPDATE public.org_roles SET display_name = name WHERE display_name IS NULL;

ALTER TABLE public.org_roles ALTER COLUMN display_name SET NOT NULL;
