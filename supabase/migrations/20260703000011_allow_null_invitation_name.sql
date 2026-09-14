-- Name is no longer required on invitations — user-controlled at registration.
ALTER TABLE public.invitations ALTER COLUMN name DROP NOT NULL;
