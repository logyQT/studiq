alter table "public"."invitations"
  add column "created_at" timestamptz not null default now();

