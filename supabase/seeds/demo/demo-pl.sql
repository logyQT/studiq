-- ==========================================================
-- Seed: demo-pl — Uniwersytet Medyczny w Krakowie (Polski tenant demo)
--
-- Polish twin of `demo-en.sql`: the same shape (people, org, groups, decks,
-- banks, quizzes, assignments, seats and eight weeks of history) with Polish
-- people and Polish study content, so `apps/web/public/marketing/pl/` shows a
-- Polish UI over Polish material instead of translated chrome over English
-- content. Apply both with `bun scripts/demo-seed.ts`.
--
-- What it creates: one self-contained demo tenant that looks like a real
-- university using StudiQ — 11 accounts (1 manager, 2 educators, 8 students),
-- 2 groups, 3 topics, 5 decks (220 cards), 3 question banks (132 questions),
-- 4 quizzes, 3 published assignments, seat pools, and eight weeks of study
-- history (reviews, sessions, quiz attempts) for the student the marketing
-- screenshots log in as.
--
-- Apply it (idempotent — re-running drops the demo tenant first):
--
--   bun scripts/demo-seed.ts --locale en     # this tenant
--   bun scripts/demo-seed.ts                 # both locales
--   bun scripts/demo-seed.ts --reset         # remove both demo tenants
--
-- All accounts use the password `Seed4Test!`; `scripts/demo-seed.ts` prints
-- the exact logins on success.
--
-- This tenant owns the `e0000000-…` id block and the `@example.edu` accounts
-- listed below; `demo-en.sql` owns `d0000000-…`. Neither reset block can match
-- the other tenant, a `qa-*` tenant or an `e2e-*` tenant.
--
-- WHY IT IS NESTED (supabase/seeds/demo/, not supabase/seeds/):
-- `supabase/config.toml` sets `sql_paths = ['./seeds/*.sql']`, a one-level
-- glob. A file directly under `seeds/` would be replayed by every
-- `supabase db reset` — thousands of demo rows landing in the database of
-- every CI integration/QA run. Nested one level down, it is invisible to the
-- glob and applied only on purpose. Do not move it up.
--
-- Everything is namespaced `demo-*` / `@example.edu` with fixed ids below,
-- so the delete block hits only this tenant and never qa-* or e2e-* rows.
-- ==========================================================

BEGIN;

-- ----------------------------------------------------------
-- Deterministic ids, shaped like a v4 UUID.
--
-- Every generated row needs a stable id so the file can be re-applied and so
-- related rows can join on it. `md5()` alone gives random version/variant
-- nibbles, and the app validates request ids with a strict UUID schema
-- (`VALIDATION_UUID_INVALID`), so the version nibble is forced to 4 and the
-- variant to 8 here. A `pg_temp` function disappears with the session, so the
-- database keeps no trace of the seeding helper.
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.demo_uuid(seed text) RETURNS uuid
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT (substr(h, 1, 12) || '4' || substr(h, 14, 3) || '8' || substr(h, 18, 15))::uuid
  FROM (SELECT md5(seed) AS h) s
$fn$;

-- ----------------------------------------------------------
-- 0. Reset this tenant only.
--
-- Content (decks, cards, banks, questions, quizzes, assignments, practice,
-- attempts, sessions) is owned by the demo accounts and hangs off
-- `profiles`/`organizations` with ON DELETE CASCADE, so deleting the org and
-- the demo users clears both sides in one step. Ids are fixed, so nothing
-- outside this tenant can match.
-- ----------------------------------------------------------
DELETE FROM public.organizations WHERE id = 'e0000000-0000-4000-8000-000000000001';
DELETE FROM auth.users WHERE id::text LIKE 'e0000000-0000-4000-8001-%';

-- ----------------------------------------------------------
-- 1. Accounts
--
-- Mirrors 01_seed.sql: the password is bcrypt-hashed in SQL (one shared
-- password, cost 10 like GoTrue's own hashing), `raw_app_meta_data` carries
-- `account_type` for the JWT, `raw_user_meta_data.name` becomes
-- `profiles.full_name` through `handle_new_user`, and each user gets the
-- `email` identity row GoTrue writes on signup.
-- ----------------------------------------------------------
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
SELECT
  '00000000-0000-0000-0000-000000000000',
  u.id,
  'authenticated',
  'authenticated',
  u.email,
  crypt('Seed4Test!', gen_salt('bf', 10)),
  now() - interval '60 days',
  now() - interval '60 days',
  now() - interval '1 day',
  jsonb_build_object('account_type', u.account_type, 'provider', 'email', 'providers', jsonb_build_array('email')),
  jsonb_build_object('name', u.full_name, 'email_verified', true, 'account_type', u.account_type),
  '', '', '', ''
FROM (VALUES
  ('e0000000-0000-4000-8001-000000000001'::uuid, 'marek.wisniewski@example.edu',  'manager',  'Marek Wiśniewski'),
  ('e0000000-0000-4000-8001-000000000002'::uuid, 'anna.kowalska@example.edu',     'educator', 'dr Anna Kowalska'),
  ('e0000000-0000-4000-8001-000000000003'::uuid, 'piotr.lewandowski@example.edu', 'educator', 'dr Piotr Lewandowski'),
  ('e0000000-0000-4000-8001-000000000004'::uuid, 'zofia.nowak@example.edu',       'student',  'Zofia Nowak'),
  ('e0000000-0000-4000-8001-000000000005'::uuid, 'jan.kaczmarek@example.edu',     'student',  'Jan Kaczmarek'),
  ('e0000000-0000-4000-8001-000000000006'::uuid, 'aleksandra.wojcik@example.edu', 'student',  'Aleksandra Wójcik'),
  ('e0000000-0000-4000-8001-000000000007'::uuid, 'michal.kaminski@example.edu',   'student',  'Michał Kamiński'),
  ('e0000000-0000-4000-8001-000000000008'::uuid, 'natalia.lewandowska@example.edu', 'student', 'Natalia Lewandowska'),
  ('e0000000-0000-4000-8001-000000000009'::uuid, 'tomasz.zielinski@example.edu',  'student',  'Tomasz Zieliński'),
  ('e0000000-0000-4000-8001-00000000000A'::uuid, 'karolina.szymanska@example.edu', 'student', 'Karolina Szymańska'),
  ('e0000000-0000-4000-8001-00000000000B'::uuid, 'pawel.dabrowski@example.edu',   'student',  'Paweł Dąbrowski')
) AS u(id, email, account_type, full_name)
ON CONFLICT DO NOTHING;

INSERT INTO auth.identities (
  id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
SELECT
  pg_temp.demo_uuid('demo-pl:identity:' || u.id::text),
  u.id::text,
  u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true, 'phone_verified', false),
  'email',
  now() - interval '1 day',
  now() - interval '60 days',
  now() - interval '1 day'
FROM auth.users u
WHERE u.id::text LIKE 'e0000000-0000-4000-8001-%'
ON CONFLICT DO NOTHING;

-- handle_new_user already inserted the profiles; this keeps the seed readable
-- on its own and pins the demo plan for the two accounts the shots use.
INSERT INTO public.profiles (id, email, full_name)
SELECT u.id, u.email, u.raw_user_meta_data->>'name'
FROM auth.users u
WHERE u.id::text LIKE 'e0000000-0000-4000-8001-%'
ON CONFLICT (id) DO NOTHING;

-- The members list renders `profiles.created_at` as the join date, so it has to
-- agree with `org_members.joined_at` instead of the moment the seed ran.
UPDATE public.profiles p
SET created_at = now() - (v.days || ' days')::interval
FROM (VALUES
  ('e0000000-0000-4000-8001-000000000001'::uuid, 56),
  ('e0000000-0000-4000-8001-000000000002'::uuid, 54),
  ('e0000000-0000-4000-8001-000000000003'::uuid, 52),
  ('e0000000-0000-4000-8001-000000000004'::uuid, 45),
  ('e0000000-0000-4000-8001-000000000005'::uuid, 44),
  ('e0000000-0000-4000-8001-000000000006'::uuid, 43),
  ('e0000000-0000-4000-8001-000000000007'::uuid, 41),
  ('e0000000-0000-4000-8001-000000000008'::uuid, 38),
  ('e0000000-0000-4000-8001-000000000009'::uuid, 33),
  ('e0000000-0000-4000-8001-00000000000A'::uuid, 26),
  ('e0000000-0000-4000-8001-00000000000B'::uuid, 19)
) AS v(id, days)
WHERE p.id = v.id;

-- Zofia płaci za StudiQ Pro sama; pozostali korzystają z miejsc uczelni.
UPDATE public.profiles SET personal_plan_key = 'pro' WHERE id = 'e0000000-0000-4000-8001-000000000004';

-- ----------------------------------------------------------
-- 2. Organization, roles, groups
--
-- Inserting the org fires `handle_new_organization`, which creates the
-- admin/teacher/member roles, their permissions and the role feature rows for
-- the plan — the subselects below can rely on that.
-- ----------------------------------------------------------
INSERT INTO public.organizations (id, name, plan, created_at)
VALUES (
  'e0000000-0000-4000-8000-000000000001',
  'Uniwersytet Medyczny w Krakowie',
  'campus',
  now() - interval '400 days'
);

-- `handle_new_organization` seeds the role display names in English ('Admin',
-- 'Teacher'); this tenant is Polish, and the members table renders that column
-- verbatim, so they are translated here.
UPDATE public.org_roles
SET display_name = CASE name
    WHEN 'admin'   THEN 'Administrator'
    WHEN 'teacher' THEN 'Nauczyciel'
    ELSE 'Student'
  END
WHERE organization_id = 'e0000000-0000-4000-8000-000000000001';

-- Roles are created by `handle_new_organization` with English display names
-- ('Admin', 'Teacher', 'Student'). This tenant is Polish, and the members table
-- and org switcher render `display_name`, so translate it here.
UPDATE public.org_roles
SET display_name = CASE name
  WHEN 'admin'   THEN 'Administrator'
  WHEN 'teacher' THEN 'Nauczyciel'
  ELSE 'Student'
END
WHERE organization_id = 'e0000000-0000-4000-8000-000000000001';

INSERT INTO public.org_members (id, organization_id, user_id, org_role_id, joined_at)
SELECT
  pg_temp.demo_uuid('demo-pl:member:' || m.id::text),
  'e0000000-0000-4000-8000-000000000001',
  m.id,
  (SELECT r.id FROM public.org_roles r
    WHERE r.organization_id = 'e0000000-0000-4000-8000-000000000001' AND r.name = m.org_role),
  now() - (m.joined_days || ' days')::interval
FROM (VALUES
  ('e0000000-0000-4000-8001-000000000001'::uuid, 'admin',   56),
  ('e0000000-0000-4000-8001-000000000002'::uuid, 'teacher', 54),
  ('e0000000-0000-4000-8001-000000000003'::uuid, 'teacher', 52),
  ('e0000000-0000-4000-8001-000000000004'::uuid, 'member',  45),
  ('e0000000-0000-4000-8001-000000000005'::uuid, 'member',  44),
  ('e0000000-0000-4000-8001-000000000006'::uuid, 'member',  43),
  ('e0000000-0000-4000-8001-000000000007'::uuid, 'member',  41),
  ('e0000000-0000-4000-8001-000000000008'::uuid, 'member',  38),
  ('e0000000-0000-4000-8001-000000000009'::uuid, 'member',  33),
  ('e0000000-0000-4000-8001-00000000000A'::uuid, 'member',  26),
  ('e0000000-0000-4000-8001-00000000000B'::uuid, 'member',  19)
) AS m(id, org_role, joined_days);

INSERT INTO public.groups (id, organization_id, name, description, is_default, created_by, created_at)
VALUES
  ('e0000000-0000-4000-8003-000000000001', 'e0000000-0000-4000-8000-000000000001',
   'Farmakologia 2024/25', 'Semestr zimowy — kurs farmakologii', true,
   'e0000000-0000-4000-8001-000000000002', now() - interval '53 days'),
  ('e0000000-0000-4000-8003-000000000002', 'e0000000-0000-4000-8000-000000000001',
   'Fizjologia człowieka', 'Semestr zimowy — kurs fizjologii', false,
   'e0000000-0000-4000-8001-000000000003', now() - interval '53 days');

-- Zofia uczestniczy w obu ścieżkach; każdy prowadzący uczy własnej.
INSERT INTO public.group_members (id, group_id, user_id, role, joined_at)
SELECT
  pg_temp.demo_uuid('demo-pl:gm:' || g.group_id::text || ':' || g.user_id::text),
  g.group_id,
  g.user_id,
  g.role,
  now() - (g.joined_days || ' days')::interval
FROM (VALUES
  ('e0000000-0000-4000-8003-000000000001'::uuid, 'e0000000-0000-4000-8001-000000000002'::uuid, 'teacher', 53),
  ('e0000000-0000-4000-8003-000000000001'::uuid, 'e0000000-0000-4000-8001-000000000004'::uuid, 'member',  45),
  ('e0000000-0000-4000-8003-000000000001'::uuid, 'e0000000-0000-4000-8001-000000000005'::uuid, 'member',  44),
  ('e0000000-0000-4000-8003-000000000001'::uuid, 'e0000000-0000-4000-8001-000000000006'::uuid, 'member',  43),
  ('e0000000-0000-4000-8003-000000000001'::uuid, 'e0000000-0000-4000-8001-000000000007'::uuid, 'member',  41),
  ('e0000000-0000-4000-8003-000000000001'::uuid, 'e0000000-0000-4000-8001-000000000008'::uuid, 'member',  38),
  ('e0000000-0000-4000-8003-000000000002'::uuid, 'e0000000-0000-4000-8001-000000000003'::uuid, 'teacher', 52),
  ('e0000000-0000-4000-8003-000000000002'::uuid, 'e0000000-0000-4000-8001-000000000004'::uuid, 'member',  45),
  ('e0000000-0000-4000-8003-000000000002'::uuid, 'e0000000-0000-4000-8001-000000000009'::uuid, 'member',  33),
  ('e0000000-0000-4000-8003-000000000002'::uuid, 'e0000000-0000-4000-8001-00000000000A'::uuid, 'member',  26),
  ('e0000000-0000-4000-8003-000000000002'::uuid, 'e0000000-0000-4000-8001-00000000000B'::uuid, 'member',  19)
) AS g(group_id, user_id, role, joined_days);

INSERT INTO public.topics (id, organization_id, created_by, name, visibility, created_at)
VALUES
  ('e0000000-0000-4000-8004-000000000001', 'e0000000-0000-4000-8000-000000000001',
   'e0000000-0000-4000-8001-000000000002', 'Farmakologia', 'group', now() - interval '52 days'),
  ('e0000000-0000-4000-8004-000000000002', 'e0000000-0000-4000-8000-000000000001',
   'e0000000-0000-4000-8001-000000000003', 'Fizjologia', 'group', now() - interval '52 days'),
  ('e0000000-0000-4000-8004-000000000003', 'e0000000-0000-4000-8000-000000000001',
   'e0000000-0000-4000-8001-000000000002', 'Praktyka kliniczna', 'group', now() - interval '40 days');

INSERT INTO public.topic_groups (topic_id, group_id)
VALUES
  ('e0000000-0000-4000-8004-000000000001', 'e0000000-0000-4000-8003-000000000001'),
  ('e0000000-0000-4000-8004-000000000002', 'e0000000-0000-4000-8003-000000000002'),
  ('e0000000-0000-4000-8004-000000000003', 'e0000000-0000-4000-8003-000000000001'),
  ('e0000000-0000-4000-8004-000000000003', 'e0000000-0000-4000-8003-000000000002');

-- ----------------------------------------------------------
-- 3. Decks and flashcards
--
-- 80 curated cards (40 pharmacology, 40 physiology) distributed over five
-- decks of 44. Decks of one topic overlap deliberately — the same card can be
-- taught in two pharmacology modules — while every deck is internally distinct.
-- ----------------------------------------------------------
CREATE TEMP TABLE demo_card_pool (genre text, ord int, front text, back text) ON COMMIT DROP;

INSERT INTO demo_card_pool (genre, ord, front, back) VALUES
  ('pharm', 1,  'Jaki jest mechanizm działania aspiryny?', 'Nieodwracalnie acetyluje COX-1 i COX-2, zmniejszając syntezę tromboksanu A2 i prostaglandyn.'),
  ('pharm', 2,  'Który enzym przekształca angiotensynę I w angiotensynę II?', 'Konwertaza angiotensyny (ACE) — cel działania inhibitorów ACE.'),
  ('pharm', 3,  'Lek pierwszego wyboru w napadzie astmy?', 'Wziewny krótko działający agonista receptora beta-2 (salbutamol) oraz glikokortykosteroidy ogólnoustrojowe.'),
  ('pharm', 4,  'Jakie jest antidotum w zatruciu paracetamolem?', 'N-acetylocysteina, najskuteczniejsza w ciągu ośmiu godzin od przyjęcia.'),
  ('pharm', 5,  'Co łączy nazwy leków zakończone na „-pril”?', 'To inhibitory ACE: ramipryl, enalapryl, lizynopryl.'),
  ('pharm', 6,  'Co łączy nazwy leków zakończone na „-olol”?', 'To antagoniści receptorów beta-adrenergicznych: metoprolol, bisoprolol, atenolol.'),
  ('pharm', 7,  'Dlaczego omeprazol przyjmuje się przed posiłkiem?', 'Inhibitor pompy protonowej blokuje tylko aktywnie wydzielające pompy, więc dawka 30–60 minut przed posiłkiem daje największy efekt.'),
  ('pharm', 8,  'Niedobór której witaminy powoduje metotreksat?', 'Kwasu foliowego (witaminy B9) — dlatego podaje się go profilaktycznie.'),
  ('pharm', 9,  'Jakie jest antidotum w zatruciu opioidami?', 'Nalokson, konkurencyjny antagonista receptora opioidowego.'),
  ('pharm', 10, 'Który lek przeciwkrzepliwy monitoruje się za pomocą INR?', 'Warfarynę; docelowe INR wynosi zwykle 2,0–3,0 w migotaniu przedsionków.'),
  ('pharm', 11, 'Jaki jest mechanizm działania heparyny?', 'Aktywuje antytrombinę III, która unieczynnia trombinę i czynnik Xa.'),
  ('pharm', 12, 'Które antybiotyki działają na podjednostkę 30S rybosomu?', 'Aminoglikozydy (gentamycyna, amikacyna) oraz tetracykliny.'),
  ('pharm', 13, 'Która grupa leków często powoduje suchy kaszel?', 'Inhibitory ACE — wskutek gromadzenia bradykininy w drogach oddechowych.'),
  ('pharm', 14, 'Który lek jest pierwszego wyboru w nadciśnieniu u młodego pacjenta?', 'Inhibitor ACE lub sartan, albo antagonista wapnia, na przykład amlodypina.'),
  ('pharm', 15, 'Co hamuje statyna?', 'Reduktazę HMG-CoA, enzym limitujący syntezę cholesterolu.'),
  ('pharm', 16, 'Jakie działania niepożądane są typowe dla aminoglikozydów?', 'Nefrotoksyczność i ototoksyczność — dlatego monitoruje się ich stężenia.'),
  ('pharm', 17, 'Jakie jest antidotum w zatruciu benzodiazepinami?', 'Flumazenil, konkurencyjny antagonista miejsca benzodiazepinowego receptora GABA-A.'),
  ('pharm', 18, 'Który lek moczopędny działa na pętlę Henlego?', 'Furosemid, który hamuje kotransporter Na-K-2Cl.'),
  ('pharm', 19, 'Który lek moczopędny oszczędza potas?', 'Spironolakton, antagonista receptora aldosteronowego.'),
  ('pharm', 20, 'Co to jest indeks terapeutyczny?', 'Stosunek dawki toksycznej do dawki skutecznej — wąski indeks wymaga monitorowania.'),
  ('pharm', 21, 'Co oznacza metabolizm pierwszego przejścia?', 'Lek wchłonięty z przewodu pokarmowego jest metabolizowany w wątrobie, zanim dotrze do krążenia ogólnego.'),
  ('pharm', 22, 'Która rodzina enzymów metabolizuje większość leków?', 'Cytochrom P450, przede wszystkim CYP3A4.'),
  ('pharm', 23, 'Dlaczego ryfampicyna osłabia działanie tabletek antykoncepcyjnych?', 'Indukuje CYP3A4 i przyspiesza metabolizm estrogenów — indukcja enzymatyczna.'),
  ('pharm', 24, 'Dlaczego jednoczesne stosowanie warfaryny i NLPZ jest niebezpieczne?', 'Oba zaburzają hemostazę: NLPZ dodatkowo hamuje płytki i zwiększa ryzyko krwawienia z przewodu pokarmowego, podnosząc INR.'),
  ('pharm', 25, 'Który beta-adrenolityk jest kardioselektywny?', 'Bisoprolol, selektywny wobec receptora beta-1, w przeciwieństwie do propranololu.'),
  ('pharm', 26, 'Jaki jest mechanizm działania metforminy?', 'Zmniejsza glukoneogenezę w wątrobie i poprawia wrażliwość tkanek na insulinę.'),
  ('pharm', 27, 'Które leki przeciwcukrzycowe mogą powodować hipoglikemię?', 'Pochodne sulfonylomocznika, na przykład gliklazyd, oraz insulina.'),
  ('pharm', 28, 'Jaki jest mechanizm działania morfiny?', 'Agonizm receptora mu-opioidowego w ośrodkowym układzie nerwowym, który zmniejsza przewodzenie i odczuwanie bólu.'),
  ('pharm', 29, 'Który lek odwraca działanie heparyny?', 'Protamina, która tworzy z heparyną nieaktywny kompleks.'),
  ('pharm', 30, 'Po co podaje się dawkę nasycającą?', 'Aby szybko osiągnąć stężenie terapeutyczne, gdy okres półtrwania leku jest długi.'),
  ('pharm', 31, 'Która grupa leków obniża stężenie LDL i śmiertelność sercowo-naczyniową?', 'Statyny, poprzez hamowanie reduktazy HMG-CoA.'),
  ('pharm', 32, 'Których antybiotyków nie stosuje się w ciąży?', 'Tetracyklin — chelatują wapń i odkładają się w zębach oraz kościach płodu.'),
  ('pharm', 33, 'Jaki jest mechanizm działania antybiotyków beta-laktamowych?', 'Hamują syntezę ściany komórkowej bakterii, wiążąc białka wiążące penicylinę.'),
  ('pharm', 34, 'Które leki przeciwgrzybicze hamują syntezę ergosterolu?', 'Azole, na przykład flukonazol, inhibitor 14-alfa-demetylazy.'),
  ('pharm', 35, 'Jak sok grejpfrutowy wpływa na stężenie symwastatyny?', 'Hamuje jelitowy CYP3A4, podnosząc stężenie leku i ryzyko miopatii.'),
  ('pharm', 36, 'Które objawy sugerują zatrucie digoksyną?', 'Nudności, zaburzenia widzenia (żółto-zielone aureole) oraz bradyarytmie.'),
  ('pharm', 37, 'Jaki jest mechanizm działania salbutamolu?', 'Agonizm receptora beta-2, który powoduje rozkurcz oskrzeli.'),
  ('pharm', 38, 'Które leki zapobiegają migrenie, blokując CGRP?', 'Przeciwciała monoklonalne przeciw CGRP, na przykład erenumab.'),
  ('pharm', 39, 'Kiedy konieczne jest monitorowanie stężenia leku we krwi?', 'Przy wąskim indeksie terapeutycznym — digoksyna, lit, wankomycyna, gentamycyna.'),
  ('pharm', 40, 'Jakie jest antidotum w zatruciu żelazem?', 'Deferoksamina, chelator żelaza.'),
  ('phys', 1,  'Jaka jest główna funkcja pętli Henlego?', 'Wytwarza gradient osmotyczny rdzenia nerki, który umożliwia wchłanianie wody i zagęszczanie moczu.'),
  ('phys', 2,  'Który hormon zwiększa wchłanianie wody w kanaliku zbiorczym?', 'Wazopresyna (ADH), działająca przez kanały akwaporyny-2.'),
  ('phys', 3,  'Jaka jest prawidłowa spoczynkowa pojemność minutowa serca?', 'Około 5 l/min — objętość wyrzutowa 70 ml przy 70 uderzeniach na minutę.'),
  ('phys', 4,  'Co dzieje się w czasie rozkurczu serca?', 'Komory rozkurczają się i napełniają, a przepływ wieńcowy odbywa się głównie w tej fazie.'),
  ('phys', 5,  'Co opisuje prawo Franka-Starlinga?', 'Większe napełnienie komór rozciąga mięsień sercowy i zwiększa siłę skurczu, do granicy fizjologicznej.'),
  ('phys', 6,  'Które komórki produkują insulinę?', 'Komórki beta wysp trzustkowych Langerhansa.'),
  ('phys', 7,  'Jaki jest główny układ buforowy osocza?', 'Układ wodorowęglanowy (H2CO3 / HCO3).'),
  ('phys', 8,  'Jaki jest prawidłowy zakres pH krwi tętniczej?', '7,35–7,45.'),
  ('phys', 9,  'Który mięsień jest głównym mięśniem wdechowym?', 'Przepona, wspomagana przez mięśnie międzyżebrowe zewnętrzne.'),
  ('phys', 10, 'Co to jest objętość oddechowa?', 'Objętość powietrza wciąganego lub wydychanego podczas spokojnego oddechu — około 500 ml.'),
  ('phys', 11, 'Co to jest przestrzeń martwa fizjologiczna?', 'Część oddechu, która wentyluje drogi oddechowe bez perfuzji pęcherzyków, więc nie bierze udziału w wymianie gazowej.'),
  ('phys', 12, 'Gdzie zachodzi wymiana gazowa?', 'W pęcherzykach płucnych, przez błonę pęcherzykowo-włośniczkową.'),
  ('phys', 13, 'Co transportuje większość tlenu we krwi?', 'Hemoglobina; tylko niewielka część tlenu jest rozpuszczona w osoczu.'),
  ('phys', 14, 'Co przesuwa krzywą dysocjacji hemoglobiny w prawo?', 'Wzrost stężenia CO2, kwasicy, temperatury oraz 2,3-DPG — efekt Bohra.'),
  ('phys', 15, 'Który nerw przewodzi przywspółczulne unerwienie serca?', 'Nerw błędny, czyli X nerw czaszkowy.'),
  ('phys', 16, 'Jak pobudzenie współczulne wpływa na częstość serca?', 'Zwiększa ją przez receptory beta-1 — dodatni efekt chronotropowy.'),
  ('phys', 17, 'Jaka jest rola węzła zatokowo-przedsionkowego?', 'Jest rozrusznikiem serca i depolaryzuje się samoistnie 60–100 razy na minutę.'),
  ('phys', 18, 'Jaki jest prawidłowy wskaźnik filtracji kłębuszkowej?', 'Około 125 ml/min, czyli około 180 litrów przesączu na dobę.'),
  ('phys', 19, 'Gdzie wchłania się większość przefiltrowanej glukozy?', 'W kanaliku krętym bliższym, przez kotransportery SGLT2.'),
  ('phys', 20, 'Jaki jest próg nerkowy dla glukozy?', 'Około 10 mmol/l; powyżej niego glukoza pojawia się w moczu.'),
  ('phys', 21, 'Który hormon podnosi stężenie wapnia, nasilając resorpcję kości?', 'Parathormon (PTH).'),
  ('phys', 22, 'Który hormon obniża stężenie wapnia we krwi?', 'Kalcytonina, wydzielana przez komórki C tarczycy.'),
  ('phys', 23, 'Który narząd wydziela erytropoetynę?', 'Nerki, w odpowiedzi na niedotlenienie tkanek.'),
  ('phys', 24, 'Jaką rolę pełni układ renina–angiotensyna–aldosteron?', 'Utrzymuje ciśnienie krwi oraz równowagę sodową.'),
  ('phys', 25, 'Co robi aldosteron?', 'Zwiększa wchłanianie sodu i wydalanie potasu w dystalnym nefronie.'),
  ('phys', 26, 'Jaka jest główna funkcja jelita grubego?', 'Wchłanianie wody i elektrolitów oraz formowanie kału.'),
  ('phys', 27, 'Który enzym rozpoczyna trawienie białek w żołądku?', 'Pepsyna, aktywowana z pepsynogenu przez kwas żołądkowy.'),
  ('phys', 28, 'Gdzie kończy się wchłanianie większości składników odżywczych?', 'W jelicie cienkim, głównie w jelicie czczym.'),
  ('phys', 29, 'Jaka jest rola soli żółciowych?', 'Emulgują tłuszcze pokarmowe, umożliwiając działanie lipazy trzustkowej.'),
  ('phys', 30, 'Który hormon pobudza wydzielanie kwasu żołądkowego?', 'Gastryna, wydzielana przez komórki G w części odźwiernikowej żołądka.'),
  ('phys', 31, 'Jaki jest prawidłowy poziom glukozy na czczo?', 'Około 3,9–5,5 mmol/l.'),
  ('phys', 32, 'Jaka jest reakcja organizmu na hipoglikemię?', 'Wydzielanie glukagonu i adrenaliny, glikogenoliza oraz glukoneogeneza.'),
  ('phys', 33, 'Które hormony wydziela tylny płat przysadki?', 'Oksytocynę i wazopresynę.'),
  ('phys', 34, 'Co robi kortyzol?', 'Podnosi stężenie glukozy, hamuje stan zapalny i utrzymuje napięcie naczyń.'),
  ('phys', 35, 'Która część mózgu reguluje temperaturę ciała?', 'Podwzgórze.'),
  ('phys', 36, 'Jaka jest funkcja osłonki mielinowej?', 'Zwiększa szybkość przewodzenia przez przewodzenie skokowe między przewężeniami Ranviera.'),
  ('phys', 37, 'Jaki jest spoczynkowy potencjał błonowy neuronu?', 'Około -70 mV, ustalany głównie przez przepuszczalność błony dla potasu.'),
  ('phys', 38, 'Który neuroprzekaźnik jest uwalniany w płytce nerwowo-mięśniowej?', 'Acetylocholina, działająca na receptory nikotynowe.'),
  ('phys', 39, 'Jaka jest rola surfaktantu w pęcherzykach płucnych?', 'Obniża napięcie powierzchniowe i zapobiega zapadaniu się pęcherzyków.'),
  ('phys', 40, 'Co dzieje się w czasie skurczu serca?', 'Komory kurczą się i wyrzucają krew do aorty oraz tętnicy płucnej.');

INSERT INTO public.flashcard_decks (id, organization_id, created_by, name, description, visibility, created_at, updated_at)
VALUES
  ('e0000000-0000-4000-8006-000000000001', 'e0000000-0000-4000-8000-000000000001',
   'e0000000-0000-4000-8001-000000000002', 'Farmakokinetyka i zasady farmakoterapii',
   'Wchłanianie, dystrybucja i eliminacja leków oraz podstawowe pojęcia recepty.',
   'group', now() - interval '50 days', now() - interval '9 days'),
  ('e0000000-0000-4000-8006-000000000002', 'e0000000-0000-4000-8000-000000000001',
   'e0000000-0000-4000-8001-000000000002', 'Farmakologia układu krążenia',
   'Leki przeciwnadciśnieniowe, przeciwkrzepliwe i stosowane w niewydolności serca.',
   'group', now() - interval '46 days', now() - interval '6 days'),
  ('e0000000-0000-4000-8006-000000000003', 'e0000000-0000-4000-8000-000000000001',
   'e0000000-0000-4000-8001-000000000002', 'Antybiotykoterapia i leki endokrynologiczne',
   'Klasy antybiotyków, leki przeciwgrzybicze oraz farmakologia cukrzycy i tarczycy.',
   'group', now() - interval '41 days', now() - interval '4 days'),
  ('e0000000-0000-4000-8006-000000000004', 'e0000000-0000-4000-8000-000000000001',
   'e0000000-0000-4000-8001-000000000003', 'Fizjologia nerek i równowaga kwasowo-zasadowa',
   'Filtracja, transport kanalikowy i obrona pH przez nerki.',
   'group', now() - interval '48 days', now() - interval '7 days'),
  ('e0000000-0000-4000-8006-000000000005', 'e0000000-0000-4000-8000-000000000001',
   'e0000000-0000-4000-8001-000000000003', 'Fizjologia układu krążenia i oddychania',
   'Cykl pracy serca, wymiana gazowa oraz kontrola oddychania i ciśnienia.',
   'group', now() - interval '44 days', now() - interval '3 days');

INSERT INTO public.deck_groups (deck_id, group_id)
VALUES
  ('e0000000-0000-4000-8006-000000000001', 'e0000000-0000-4000-8003-000000000001'),
  ('e0000000-0000-4000-8006-000000000002', 'e0000000-0000-4000-8003-000000000001'),
  ('e0000000-0000-4000-8006-000000000003', 'e0000000-0000-4000-8003-000000000001'),
  ('e0000000-0000-4000-8006-000000000004', 'e0000000-0000-4000-8003-000000000002'),
  ('e0000000-0000-4000-8006-000000000005', 'e0000000-0000-4000-8003-000000000002');

INSERT INTO public.flashcards (id, organization_id, created_by, front, back, visibility, deck_id, created_at)
SELECT
  pg_temp.demo_uuid('demo-pl:card:' || d.deck_id::text || ':' || g.n),
  'e0000000-0000-4000-8000-000000000001',
  d.author,
  p.front,
  p.back,
  'group',
  d.deck_id,
  now() - interval '49 days' + ((g.n * 40) || ' minutes')::interval
FROM (VALUES
  ('e0000000-0000-4000-8006-000000000001'::uuid, 'pharm', 0,  'e0000000-0000-4000-8001-000000000002'::uuid),
  ('e0000000-0000-4000-8006-000000000002'::uuid, 'pharm', 12, 'e0000000-0000-4000-8001-000000000002'::uuid),
  ('e0000000-0000-4000-8006-000000000003'::uuid, 'pharm', 24, 'e0000000-0000-4000-8001-000000000002'::uuid),
  ('e0000000-0000-4000-8006-000000000004'::uuid, 'phys',  0,  'e0000000-0000-4000-8001-000000000003'::uuid),
  ('e0000000-0000-4000-8006-000000000005'::uuid, 'phys',  14, 'e0000000-0000-4000-8001-000000000003'::uuid)
) AS d(deck_id, genre, win_start, author)
CROSS JOIN LATERAL generate_series(1, 44) AS g(n)
JOIN demo_card_pool p
  ON p.genre = d.genre
 AND p.ord = ((d.win_start + g.n - 1) % 40) + 1;

-- Every card belongs to its deck's topic; the third topic is taught through
-- the clinical question bank only.
INSERT INTO public.flashcard_topic_assignments (flashcard_id, topic_id)
SELECT f.id,
       CASE f.deck_id
         WHEN 'e0000000-0000-4000-8006-000000000001'::uuid THEN 'e0000000-0000-4000-8004-000000000001'::uuid
         WHEN 'e0000000-0000-4000-8006-000000000002'::uuid THEN 'e0000000-0000-4000-8004-000000000001'::uuid
         WHEN 'e0000000-0000-4000-8006-000000000003'::uuid THEN 'e0000000-0000-4000-8004-000000000001'::uuid
         WHEN 'e0000000-0000-4000-8006-000000000004'::uuid THEN 'e0000000-0000-4000-8004-000000000002'::uuid
         ELSE 'e0000000-0000-4000-8004-000000000002'::uuid
       END
FROM public.flashcards f
WHERE f.organization_id = 'e0000000-0000-4000-8000-000000000001';

-- ----------------------------------------------------------
-- 4. Question banks, questions and options
--
-- 72 curated stems in six-item cycles (true/false, four multiple choice, one
-- open answer), three banks of 44 windows over that pool. Options are written
-- only for the closed types; open questions are graded by the educator.
-- ----------------------------------------------------------
CREATE TEMP TABLE demo_question_pool (
  ord int PRIMARY KEY,
  genre text NOT NULL,
  qtype text NOT NULL,
  content text NOT NULL,
  explanation text,
  opt_a text,
  opt_b text,
  opt_c text,
  opt_d text,
  correct int
) ON COMMIT DROP;

INSERT INTO demo_question_pool (ord, genre, qtype, content, explanation, opt_a, opt_b, opt_c, opt_d, correct) VALUES
  -- Cykl 1 — farmakokinetyka
  (1,  'pharm', 'true_false', 'Biodostępność leku podanego dożylnie wynosi 100%.', 'Podanie dożylne omija wchłanianie i metabolizm pierwszego przejścia.', 'Prawda', 'Fałsz', NULL, NULL, 0),
  (2,  'pharm', 'mcq', 'Która droga podania omija metabolizm pierwszego przejścia?', 'Podanie dożylne wprowadza lek wprost do krążenia ogólnego.', 'Doustna', 'Dożylna', 'Doodbytnicza', 'Podskórna', 1),
  (3,  'pharm', 'mcq', 'Co opisuje okres półtrwania leku?', 'Okres półtrwania to czas, w którym stężenie w osoczu maleje o połowę.', 'Czas do osiągnięcia stężenia maksymalnego', 'Czas, w którym stężenie w osoczu maleje o połowę', 'Czas wydalenia całej dawki', 'Czas do wystąpienia efektu klinicznego', 1),
  (4,  'pharm', 'open', 'Wyjaśnij, dlaczego lek o dużym efekcie pierwszego przejścia wymaga większej dawki doustnej niż dożylnej.', 'Krew z jelit trafia przez żyłę wrotną do wątroby, która metabolizuje część dawki, zanim dotrze ona do krążenia ogólnego.', NULL, NULL, NULL, NULL, NULL),
  (5,  'pharm', 'mcq', 'Który parametr opisuje objętość, w której pozornie rozmieszcza się lek?', 'Objętość dystrybucji wiąże ilość leku w organizmie z jego stężeniem w osoczu.', 'Klirens', 'Objętość dystrybucji', 'Okres półtrwania', 'Pole pod krzywą', 1),
  (6,  'pharm', 'mcq', 'Lek jest w 95% związany z białkami osocza. Co to oznacza?', 'Działanie farmakologiczne wywiera wyłącznie wolna frakcja leku.', 'Niewiele wolnego leku jest dostępnych do działania', 'Lek jest szybko wydalany przez nerki', 'Lek nie wchodzi w interakcje z innymi lekami', 'Lek ma bardzo wysoki klirens wątrobowy', 0),
  -- Cykl 2 — farmakodynamika i działania niepożądane
  (7,  'pharm', 'true_false', 'Działanie antagonisty kompetycyjnego można przezwyciężyć, zwiększając stężenie agonisty.', 'Oba leki konkurują o to samo miejsce wiązania, więc nadmiar agonisty przywraca odpowiedź.', 'Prawda', 'Fałsz', NULL, NULL, 0),
  (8,  'pharm', 'mcq', 'Czym jest skuteczność (efektywność) leku?', 'Skuteczność to maksymalna odpowiedź, jaką lek może wywołać.', 'Dawka potrzebna do uzyskania połowy efektu', 'Maksymalna odpowiedź, jaką lek może wywołać', 'Okres półtrwania leku', 'Powinowactwo do receptora', 1),
  (9,  'pharm', 'mcq', 'Który receptor jest kanałem jonowym bramkowanym ligandem?', 'Receptor nikotynowy acetylocholiny otwiera kanał jonowy bezpośrednio po związaniu agonisty.', 'Receptor sprzężony z białkiem G', 'Receptor nikotynowy acetylocholiny', 'Receptor kinazy tyrozynowej', 'Receptor jądrowy', 1),
  (10, 'pharm', 'open', 'Wyjaśnij różnicę między siłą działania a skutecznością leku, podając przykład kliniczny.', 'Siła działania to dawka potrzebna do uzyskania efektu (fentanyl i morfina), a skuteczność to pułap efektu (morfina i paracetamol).', NULL, NULL, NULL, NULL, NULL),
  (11, 'pharm', 'mcq', 'Który narząd jest głównym miejscem metabolizmu leków?', 'Większość leków jest metabolizowana przez enzymy cytochromu P450 w wątrobie.', 'Nerki', 'Wątroba', 'Płuca', 'Skóra', 1),
  (12, 'pharm', 'mcq', 'Czym jest niepożądane działanie typu A?', 'Działania typu A są zależne od dawki i przewidywalne z mechanizmu działania leku.', 'Działanie zależne od dawki i przewidywalne', 'Działanie idiosynkratyczne i immunologiczne', 'Działanie rakotwórcze po długim stosowaniu', 'Reakcja z odstawienia', 0),
  -- Cykl 3 — leki układu krążenia
  (13, 'pharm', 'true_false', 'Inhibitory ACE mogą powodować hiperkaliemię u pacjentów z niewydolnością nerek.', 'Zmniejszone wydzielanie aldosteronu ogranicza wydalanie potasu.', 'Prawda', 'Fałsz', NULL, NULL, 0),
  (14, 'pharm', 'mcq', 'Który doustny lek przeciwkrzepliwy bezpośrednio hamuje czynnik Xa?', 'Apiksaban jest bezpośrednim inhibitorem czynnika Xa i nie wymaga rutynowego monitorowania INR.', 'Warfaryna', 'Apiksaban', 'Klopidogrel', 'Heparyna', 1),
  (15, 'pharm', 'mcq', 'Jaki jest mechanizm działania klopidogrelu?', 'Klopidogrel blokuje płytkowy receptor P2Y12 dla ADP.', 'Hamowanie cyklooksygenazy', 'Antagonizm receptora P2Y12', 'Blokada glikoproteiny IIb/IIIa', 'Antagonizm witaminy K', 1),
  (16, 'pharm', 'open', 'Dlaczego beta-adrenolityk należy włączać ostrożnie w niewydolności serca?', 'Ujemny efekt inotropowy może pogorszyć pracę niewydolnego serca, dlatego zaczyna się od małej dawki i stopniowo ją zwiększa.', NULL, NULL, NULL, NULL, NULL),
  (17, 'pharm', 'mcq', 'Który lek podaje się dożylnie w przełomie nadciśnieniowym z obrzękiem płuc?', 'Nitrogliceryna szybko zmniejsza obciążenie wstępne i następcze, a jej działanie można dostroić.', 'Ramipryl doustnie', 'Nitrogliceryna dożylnie', 'Amlodypina doustnie', 'Bisoprolol doustnie', 1),
  (18, 'pharm', 'mcq', 'Jaki jest charakterystyczny objaw niepożądany amlodypiny?', 'Rozszerzenie tętniczek powoduje zależny obrzęk kostek.', 'Obrzęk kostek', 'Bradykardia', 'Suchy kaszel', 'Hiperkaliemia', 0),
  -- Cykl 4 — antybiotyki
  (19, 'pharm', 'true_false', 'Aminoglikozydy są bardzo skuteczne wobec bakterii beztlenowych.', 'Transport aminoglikozydów do komórki zależy od tlenu, więc beztlenowce są oporne.', 'Prawda', 'Fałsz', NULL, NULL, 1),
  (20, 'pharm', 'mcq', 'Który antybiotyk hamuje bakteryjną reduktazę dihydrofolianową?', 'Trimetoprim blokuje syntezę folianów, często stosowany z sulfametoksazolem.', 'Trimetoprim', 'Amoksycylina', 'Azytromycyna', 'Wankomycyna', 0),
  (21, 'pharm', 'mcq', 'Który antybiotyk jest zarezerwowany dla zakażeń MRSA?', 'Wankomycyna wiąże D-Ala-D-Ala i pozostaje standardem w leczeniu MRSA.', 'Wankomycyna', 'Penicylina G', 'Doksycyklina', 'Nitrofurantoina', 0),
  (22, 'pharm', 'open', 'Wyjaśnij w dwóch zdaniach, na czym polega racjonalna antybiotykoterapia.', 'Dobór leku, dawki i czasu leczenia do patogenu; najwęższe możliwe spektrum, gdy pozwalają na to wyniki posiewu, ogranicza oporność.', NULL, NULL, NULL, NULL, NULL),
  (23, 'pharm', 'mcq', 'Jaki jest mechanizm działania wankomycyny?', 'Wiąże koniec D-Ala-D-Ala i blokuje syntezę ściany komórkowej.', 'Wiąże D-Ala-D-Ala i blokuje syntezę ściany komórkowej', 'Hamuje rybosom 30S', 'Blokuje gyrazę DNA', 'Uszkadza błonę cytoplazmatyczną', 0),
  (24, 'pharm', 'mcq', 'Która grupa antybiotyków jest związana z uszkodzeniem ścięgien?', 'Fluorochinolony, na przykład cyprofloksacyna, mają ostrzeżenie o zerwaniu ścięgna.', 'Fluorochinolony', 'Penicyliny', 'Aminoglikozydy', 'Nitroimidazole', 0),
  -- Cykl 5 — leki endokrynologiczne
  (25, 'pharm', 'true_false', 'Metforminę należy odstawić na czas ostrej choroby z odwodnieniem.', 'Takie połączenie zwiększa ryzyko kwasicy mleczanowej związanej z metforminą.', 'Prawda', 'Fałsz', NULL, NULL, 0),
  (26, 'pharm', 'mcq', 'Która insulina działa szybko?', 'Insulina aspart to szybko działający analog podawany z posiłkami.', 'Insulina glargina', 'Insulina aspart', 'Insulina NPH', 'Insulina detemir', 1),
  (27, 'pharm', 'mcq', 'Jaki jest mechanizm działania inhibitorów SGLT2?', 'Blokują zwrotne wchłanianie glukozy w kanaliku bliższym nerki.', 'Zwiększają wydzielanie insuliny', 'Blokują zwrotne wchłanianie glukozy w nerce', 'Hamują wchłanianie glukozy z jelita', 'Zwiększają wrażliwość tkanek na insulinę', 1),
  (28, 'pharm', 'open', 'Opisz rozpoznanie i leczenie hipoglikemii u przytomnego pacjenta.', 'Oznaczyć glikemię, podać 15–20 g szybko przyswajalnych węglowodanów i powtórzyć pomiar po 15 minutach.', NULL, NULL, NULL, NULL, NULL),
  (29, 'pharm', 'mcq', 'Który lek leczy tyreotoksykozę, hamując peroksydazę tarczycową?', 'Tiamazol zmniejsza syntezę hormonów tarczycy.', 'Lewotyroksyna', 'Tiamazol', 'Liotyronina', 'Jod doustny', 1),
  (30, 'pharm', 'mcq', 'Jakie jest główne ryzyko rozpoczęcia insulinoterapii u osłabionego pacjenta w podeszłym wieku?', 'Ścisła kontrola glikemii u osoby osłabionej znacznie zwiększa ryzyko hipoglikemii.', 'Hipoglikemia', 'Hipernatremia', 'Hiperkalcemia', 'Zasadowica metaboliczna', 0),
  -- Cykl 6 — leki przeciwbólowe i ratunkowe
  (31, 'pharm', 'true_false', 'Paracetamol działa przeciwzapalnie podobnie jak ibuprofen.', 'Paracetamol ma znikome obwodowe działanie przeciwzapalne.', 'Prawda', 'Fałsz', NULL, NULL, 1),
  (32, 'pharm', 'mcq', 'Który lek przeciwbólowy może wywołać skurcz oskrzeli u pacjenta z astmą aspirynową?', 'NLPZ przesuwają metabolizm kwasu arachidonowego w stronę leukotrienów.', 'Aspiryna', 'Paracetamol', 'Tramadol', 'Kodeina', 0),
  (33, 'pharm', 'mcq', 'Jaki jest lek pierwszego wyboru w anafilaksji?', 'Adrenalinę podaje się natychmiast domięśniowo w przednio-boczną powierzchnię uda.', 'Adrenalina dożylna', 'Adrenalina domięśniowa', 'Lek przeciwhistaminowy doustnie', 'Salbutamol wziewny', 1),
  (34, 'pharm', 'open', 'Przedstaw drabinę analgetyczną WHO.', 'Stopień 1 — leki nieopioidowe, stopień 2 — słabe opioidy, stopień 3 — silne opioidy, na każdym stopniu leki wspomagające.', NULL, NULL, NULL, NULL, NULL),
  (35, 'pharm', 'mcq', 'Który lek odwraca depresję oddechową wywołaną opioidami?', 'Nalokson wypiera opioid z receptora.', 'Flumazenil', 'Nalokson', 'Atropina', 'Protamina', 1),
  (36, 'pharm', 'mcq', 'Jaka jest maksymalna dobowa dawka paracetamolu u zdrowego dorosłego?', 'Powyżej 4 g na dobę ryzyko uszkodzenia wątroby gwałtownie rośnie.', '2 g', '4 g', '6 g', '8 g', 1),
  -- Cykl 7 — fizjologia nerek
  (37, 'phys', 'true_false', 'Nerka wchłania zwrotnie około 99% przesączonego sodu.', 'Niemal cały przesączony sód wraca do krwi, głównie w kanaliku bliższym.', 'Prawda', 'Fałsz', NULL, NULL, 0),
  (38, 'phys', 'mcq', 'Który odcinek nefronu jest nieprzepuszczalny dla wody?', 'Grube ramię wstępujące jest nieprzepuszczalne dla wody i rozcieńcza płyn kanalikowy.', 'Kanalik kręty bliższy', 'Ramię zstępujące pętli Henlego', 'Ramię wstępujące pętli Henlego', 'Kanalik zbiorczy', 2),
  (39, 'phys', 'mcq', 'Gdzie wytwarzana jest renina?', 'Komórki przykłębuszkowe tętnicy doprowadzającej wydzielają reninę.', 'Komórki przykłębuszkowe', 'Plamka gęsta', 'Podocyty', 'Komórki mezangium', 0),
  (40, 'phys', 'open', 'Wyjaśnij, w jaki sposób nerka zagęszcza mocz.', 'Pętla Henlego buduje gradient osmotyczny rdzenia, a wazopresyna czyni kanalik zbiorczy przepuszczalnym dla wody.', NULL, NULL, NULL, NULL, NULL),
  (41, 'phys', 'mcq', 'Jaka jest główna siła napędowa filtracji kłębuszkowej?', 'Ciśnienie hydrostatyczne w naczyniu kłębuszka przewyższa przeciwstawne ciśnienie onkotyczne.', 'Ciśnienie onkotyczne osocza', 'Ciśnienie hydrostatyczne w naczyniu kłębuszka', 'Sekrecja kanalikowa', 'Przepływ limfy', 1),
  (42, 'phys', 'mcq', 'Który hormon wydziela się w odpowiedzi na wzrost osmolalności osocza?', 'Osmoreceptory podwzgórza pobudzają wydzielanie wazopresyny z tylnego płata przysadki.', 'Aldosteron', 'Wazopresyna', 'Przedsionkowy peptyd natriuretyczny', 'Renina', 1),
  -- Cykl 8 — równowaga kwasowo-zasadowa
  (43, 'phys', 'true_false', 'Kwasicę metaboliczną wyrównuje hiperwentylacja.', 'Obniżenie pCO2 usuwa kwas i podnosi pH w stronę prawidłowego.', 'Prawda', 'Fałsz', NULL, NULL, 0),
  (44, 'phys', 'mcq', 'Jaki jest prawidłowy poziom wodorowęglanów w osoczu?', 'Wodorowęglany mieszczą się zwykle w granicach 22–26 mmol/l.', '12–16 mmol/l', '22–26 mmol/l', '30–34 mmol/l', '36–40 mmol/l', 1),
  (45, 'phys', 'mcq', 'Co wywołuje zasadowicę oddechową?', 'Hiperwentylacja na dużej wysokości usuwa nadmiar dwutlenku węgla.', 'Przedawkowanie opioidów', 'Hiperwentylacja na dużej wysokości', 'Ciężka przewlekła obturacyjna choroba płuc', 'Kwasica ketonowa', 1),
  (46, 'phys', 'open', 'Zinterpretuj gazometrię: pH 7,25; pCO2 30 mmHg; HCO3 13 mmol/l.', 'Kwasica metaboliczna z oddechową kompensacją.', NULL, NULL, NULL, NULL, NULL),
  (47, 'phys', 'mcq', 'Który płyn infuzyjny jest izotoniczny?', '0,9% chlorek sodu jest izotoniczny wobec osocza.', '0,9% chlorek sodu', '0,45% chlorek sodu', '5% glukoza', 'Woda jałowa', 0),
  (48, 'phys', 'mcq', 'Co dzieje się z potasem w kwasicy?', 'Jony wodorowe wchodzą do komórek, a potas wychodzi z nich, aby zachować elektroobojętność.', 'Wchodzi do komórek', 'Wychodzi z komórek', 'Pozostaje bez zmian', 'Jest wydalany w niezmienionej ilości', 1),
  -- Cykl 9 — fizjologia serca
  (49, 'phys', 'true_false', 'Pierwszy ton serca powstaje w wyniku zamknięcia zastawek przedsionkowo-komorowych.', 'Zamknięcie zastawki mitralnej i trójdzielnej rozpoczyna skurcz.', 'Prawda', 'Fałsz', NULL, NULL, 0),
  (50, 'phys', 'mcq', 'Które naczynie prowadzi krew odtlenowaną?', 'Tętnica płucna prowadzi krew odtlenowaną do płuc.', 'Aorta', 'Tętnica płucna', 'Żyła płucna', 'Tętnica wieńcowa', 1),
  (51, 'phys', 'mcq', 'Co przedstawia zespół QRS w zapisie EKG?', 'Zespół QRS odzwierciedla depolaryzację komór.', 'Depolaryzację przedsionków', 'Depolaryzację komór', 'Repolaryzację komór', 'Repolaryzację przedsionków', 1),
  (52, 'phys', 'open', 'Opisz odruch z baroreceptorów przy spadku ciśnienia tętniczego.', 'Mniejsze rozciągnięcie naczyń zmniejsza napięcie błędne i zwiększa współczulne: rosną częstość serca, kurczliwość i opór naczyń.', NULL, NULL, NULL, NULL, NULL),
  (53, 'phys', 'mcq', 'Która zastawka rozdziela lewy przedsionek i lewą komorę?', 'Zastawka mitralna (dwudzielna) leży między lewym przedsionkiem a lewą komorą.', 'Zastawka trójdzielna', 'Zastawka mitralna', 'Zastawka płucna', 'Zastawka aortalna', 1),
  (54, 'phys', 'mcq', 'Jaka jest prawidłowa frakcja wyrzutowa lewej komory?', 'Zakres 55–70% jest typowy w badaniu echokardiograficznym.', '20–35%', '40–50%', '55–70%', '75–90%', 2),
  -- Cykl 10 — fizjologia oddychania
  (55, 'phys', 'true_false', 'Ciśnienie parcjalne tlenu w pęcherzykach płucnych jest wyższe niż w krwi żylnej mieszanej.', 'Tlen dyfunduje wzdłuż tego gradientu do krwi włośniczkowej.', 'Prawda', 'Fałsz', NULL, NULL, 0),
  (56, 'phys', 'mcq', 'Której objętości płuc nie zmierzy spirometria?', 'Objętość zalegającą oznacza się metodą rozcieńczania gazów lub pletyzmografią.', 'Objętości oddechowej', 'Objętości zalegającej', 'Objętości zapasowej wdechowej', 'Pojemności życiowej', 1),
  (57, 'phys', 'mcq', 'Jaki jest główny bodziec dla ośrodka oddechowego?', 'Ośrodkowe chemoreceptory reagują na wzrost stężenia dwutlenku węgla we krwi.', 'Ciśnienie tlenu we krwi', 'Ciśnienie dwutlenku węgla we krwi', 'Wyłącznie pH krwi', 'Stężenie glukozy', 1),
  (58, 'phys', 'open', 'Opisz transport tlenu od pęcherzyka płucnego do tkanki.', 'Dyfuzja do krwi włośniczkowej, związanie z hemoglobiną, transport i dysocjacja w miejscu niskiego pO2.', NULL, NULL, NULL, NULL, NULL),
  (59, 'phys', 'mcq', 'Które mięśnie dominują w wymuszonym wydechu?', 'Mięśnie brzucha i międzyżebrowe wewnętrzne zwiększają ciśnienie w jamie brzusznej.', 'Przepona i mięśnie międzyżebrowe zewnętrzne', 'Mięśnie brzucha i międzyżebrowe wewnętrzne', 'Mięsień mostkowo-obojczykowo-sutkowy', 'Mięśnie pochyłe', 1),
  (60, 'phys', 'mcq', 'Jaka jest prawidłowa częstość oddechów u dorosłego w spoczynku?', '12–20 oddechów na minutę to przyjęty zakres spoczynkowy.', '4–8 na minutę', '12–20 na minutę', '22–28 na minutę', '30–36 na minutę', 1),
  -- Cykl 11 — neurofizjologia
  (61, 'phys', 'true_false', 'Depolaryzacja neuronu wynika głównie z napływu sodu.', 'Bramkowane napięciem kanały sodowe otwierają się i sód wpływa do aksonu.', 'Prawda', 'Fałsz', NULL, NULL, 0),
  (62, 'phys', 'mcq', 'W którym płacie znajduje się pierwszorzędowa kora ruchowa?', 'Zakręt przedśrodkowy płata czołowego steruje ruchami dowolnymi.', 'W płacie czołowym', 'W płacie ciemieniowym', 'W płacie skroniowym', 'W płacie potylicznym', 0),
  (63, 'phys', 'mcq', 'Niedobór którego neuroprzekaźnika występuje w chorobie Parkinsona?', 'Utrata neuronów dopaminergicznych istoty czarnej obniża stężenie dopaminy w prążkowiu.', 'Serotoniny', 'Dopaminy', 'Acetylocholiny', 'GABA', 1),
  (64, 'phys', 'open', 'Wyjaśnij, na czym polega przewodzenie skokowe.', 'Potencjały czynnościowe przeskakują między węzłami Ranviera, co znacznie zwiększa szybkość przewodzenia we włóknach mielinowych.', NULL, NULL, NULL, NULL, NULL),
  (65, 'phys', 'mcq', 'Czym głównie zajmuje się móżdżek?', 'Dostraja ruchy, postawę ciała i równowagę.', 'Wydzielaniem hormonów', 'Koordynacją ruchów i równowagą', 'Regulacją temperatury ciała', 'Produkcją mowy', 1),
  (66, 'phys', 'mcq', 'Który nerw czaszkowy steruje większością ruchów gałki ocznej?', 'Nerw okoruchowy unerwia większość mięśni zewnątrzgałkowych.', 'Nerw wzrokowy', 'Nerw okoruchowy', 'Nerw twarzowy', 'Nerw błędny', 1),
  -- Cykl 12 — praktyka kliniczna
  (67, 'clin', 'true_false', 'U pacjenta z podejrzeniem udaru należy oznaczyć glikemię przed trombolizą.', 'Hipoglikemia może naśladować udar i musi zostać wykluczona w pierwszej kolejności.', 'Prawda', 'Fałsz', NULL, NULL, 0),
  (68, 'clin', 'mcq', 'Które objawy sugerują wstrząs hipowolemiczny?', 'Chłodne obwody i tachykardia wyrównawcza są typowe dla wstrząsu.', 'Ciepłe obwody i bradykardia', 'Chłodne obwody i tachykardia', 'Nadciśnienie z bradykardią', 'Falujące tętno na obwodzie', 1),
  (69, 'clin', 'mcq', 'Jaki jest pierwszy krok w napadzie drgawkowym trwającym ponad pięć minut?', 'Benzodiazepina przerywa napad, a diagnostyka rozpoczyna się po jego opanowaniu.', 'Doustny lek przeciwpadaczkowy', 'Dożylna benzodiazepina', 'Tomografia komputerowa głowy', 'Punkcja lędźwiowa', 1),
  (70, 'clin', 'open', 'Wymień trzy objawy alarmowe u pacjenta z ostrym bólem w klatce piersiowej.', 'Ból promieniujący do ramienia lub żuchwy, poty, duszność, omdlenie, ból spoczynkowy.', NULL, NULL, NULL, NULL, NULL),
  (71, 'clin', 'mcq', 'Która skala ocenia prawdopodobieństwo zatorowości płucnej?', 'Skala Wellsa stratyfikuje prawdopodobieństwo zatorowości przed badaniami obrazowymi.', 'Skala Glasgow', 'Skala Wellsa', 'CURB-65', 'APACHE II', 1),
  (72, 'clin', 'mcq', 'Które zaburzenie elektrolitowe daje wysokie, spiczaste załamki T w EKG?', 'Hiperkaliemia poszerza zespół QRS i zaostrza załamek T.', 'Hipokaliemia', 'Hiperkaliemia', 'Hipokalcemia', 'Hiponatremia', 1);

INSERT INTO public.question_banks (id, organization_id, created_by, name, description, visibility, created_at, updated_at)
VALUES
  ('e0000000-0000-4000-8020-000000000001', 'e0000000-0000-4000-8000-000000000001',
   'e0000000-0000-4000-8001-000000000002', 'Bank pytań — farmakologia',
   'Pytania egzaminacyjne z farmakokinetyki, kardiologii i antybiotykoterapii.',
   'group', now() - interval '47 days', now() - interval '5 days'),
  ('e0000000-0000-4000-8020-000000000002', 'e0000000-0000-4000-8000-000000000001',
   'e0000000-0000-4000-8001-000000000003', 'Bank pytań — fizjologia',
   'Nerki, równowaga kwasowo-zasadowa, krążenie i oddychanie; pytania różnego typu.',
   'group', now() - interval '45 days', now() - interval '4 days'),
  ('e0000000-0000-4000-8020-000000000003', 'e0000000-0000-4000-8000-000000000001',
   'e0000000-0000-4000-8001-000000000002', 'Bank przypadków klinicznych',
   'Pytania stosowane prowadzone z dr. Lewandowskim na zajęciach klinicznych.',
   'group', now() - interval '38 days', now() - interval '2 days');

INSERT INTO public.bank_groups (bank_id, group_id)
VALUES
  ('e0000000-0000-4000-8020-000000000001', 'e0000000-0000-4000-8003-000000000001'),
  ('e0000000-0000-4000-8020-000000000002', 'e0000000-0000-4000-8003-000000000002'),
  ('e0000000-0000-4000-8020-000000000003', 'e0000000-0000-4000-8003-000000000001'),
  ('e0000000-0000-4000-8020-000000000003', 'e0000000-0000-4000-8003-000000000002');

-- bank → question map: 44 slots starting at a different point of the pool, so
-- the three banks overlap but are not identical.
CREATE TEMP TABLE demo_q_map ON COMMIT DROP AS
SELECT
  b.bank_id,
  g.n AS slot,
  ((b.start_ord + g.n - 1) % 72) + 1 AS ord,
  pg_temp.demo_uuid('demo-pl:q:' || b.bank_id::text || ':' || g.n) AS question_id,
  b.author
FROM (VALUES
  ('e0000000-0000-4000-8020-000000000001'::uuid, 1,  'e0000000-0000-4000-8001-000000000002'::uuid),
  ('e0000000-0000-4000-8020-000000000002'::uuid, 15, 'e0000000-0000-4000-8001-000000000003'::uuid),
  ('e0000000-0000-4000-8020-000000000003'::uuid, 29, 'e0000000-0000-4000-8001-000000000002'::uuid)
) AS b(bank_id, start_ord, author)
CROSS JOIN LATERAL generate_series(1, 44) AS g(n);

INSERT INTO public.questions (id, organization_id, created_by, type, content, explanation, visibility, bank_id, created_at)
SELECT
  m.question_id,
  'e0000000-0000-4000-8000-000000000001',
  m.author,
  p.qtype::public.question_type,
  p.content,
  p.explanation,
  'group',
  m.bank_id,
  now() - ((m.slot / 3) || ' days')::interval
FROM demo_q_map m
JOIN demo_question_pool p ON p.ord = m.ord;

INSERT INTO public.question_options (id, question_id, content, is_correct, order_index)
SELECT
  pg_temp.demo_uuid('demo-pl:opt:' || m.question_id::text || ':' || o.i),
  m.question_id,
  o.content,
  o.i = p.correct,
  o.i
FROM demo_q_map m
JOIN demo_question_pool p ON p.ord = m.ord
CROSS JOIN LATERAL (VALUES (0, p.opt_a), (1, p.opt_b), (2, p.opt_c), (3, p.opt_d)) AS o(i, content)
WHERE p.qtype <> 'open'
  AND o.content IS NOT NULL;

INSERT INTO public.question_topic_assignments (question_id, topic_id)
SELECT m.question_id,
       CASE p.genre
         WHEN 'pharm' THEN 'e0000000-0000-4000-8004-000000000001'::uuid
         WHEN 'phys'  THEN 'e0000000-0000-4000-8004-000000000002'::uuid
         ELSE 'e0000000-0000-4000-8004-000000000003'::uuid
       END
FROM demo_q_map m
JOIN demo_question_pool p ON p.ord = m.ord;

-- ----------------------------------------------------------
-- 5. Quizzes and assignments
-- ----------------------------------------------------------
INSERT INTO public.quizzes (id, organization_id, created_by, name, description, created_at, updated_at)
VALUES
  ('e0000000-0000-4000-8007-000000000001', 'e0000000-0000-4000-8000-000000000001',
   'e0000000-0000-4000-8001-000000000002', 'Kolokwium z farmakologii — blok 2',
   'Farmakokinetyka i leki układu krążenia. Bez materiałów, 10 pytań.', now() - interval '30 days', now() - interval '12 days'),
  ('e0000000-0000-4000-8007-000000000002', 'e0000000-0000-4000-8000-000000000001',
   'e0000000-0000-4000-8001-000000000002', 'Kartkówka — farmakologia układu krążenia',
   'Osiem pytań o leczenie przeciwkrzepliwe i niewydolność serca.', now() - interval '25 days', now() - interval '11 days'),
  ('e0000000-0000-4000-8007-000000000003', 'e0000000-0000-4000-8000-000000000001',
   'e0000000-0000-4000-8001-000000000003', 'Kartkówka — nerki i równowaga kwasowo-zasadowa',
   'Osiem pytań o filtrację, transport kanalikowy i gazometrię.', now() - interval '22 days', now() - interval '9 days'),
  ('e0000000-0000-4000-8007-000000000004', 'e0000000-0000-4000-8000-000000000001',
   'e0000000-0000-4000-8001-000000000003', 'Egzamin próbny — fizjologia',
   'Dziesięć pytań stosowanych z banku fizjologii i przypadków klinicznych.', now() - interval '18 days', now() - interval '8 days');

INSERT INTO public.quiz_questions (quiz_id, question_id, order_index, points)
SELECT
  q.quiz_id,
  m.question_id,
  s.k - 1,
  1
FROM (VALUES
  ('e0000000-0000-4000-8007-000000000001'::uuid, 'e0000000-0000-4000-8020-000000000001'::uuid, 1,  10),
  ('e0000000-0000-4000-8007-000000000002'::uuid, 'e0000000-0000-4000-8020-000000000001'::uuid, 12, 8),
  ('e0000000-0000-4000-8007-000000000003'::uuid, 'e0000000-0000-4000-8020-000000000002'::uuid, 20, 8),
  ('e0000000-0000-4000-8007-000000000004'::uuid, 'e0000000-0000-4000-8020-000000000003'::uuid, 30, 10)
) AS q(quiz_id, bank_id, start_slot, question_total)
CROSS JOIN LATERAL generate_series(1, q.question_total) AS s(k)
JOIN demo_q_map m
  ON m.bank_id = q.bank_id
 AND m.slot = q.start_slot + s.k - 1;

INSERT INTO public.teacher_assignments (
  id, organization_id, created_by, quiz_id, title, description, status,
  deadline, start_time, time_limit_min, shuffle_questions, shuffle_answers,
  show_results, max_attempts, passing_score, question_count, total_points, created_at, updated_at
)
VALUES
  ('e0000000-0000-4000-8008-000000000001', 'e0000000-0000-4000-8000-000000000001',
   'e0000000-0000-4000-8001-000000000002', 'e0000000-0000-4000-8007-000000000001',
   'Kolokwium z farmakologii — blok 2',
   'Zakres tygodni 1–6. Wyniki udostępniane po seminarium powtórkowym.',
   'published', now() + interval '5 days', now() - interval '3 days', 30, true, true,
   false, 2, 60, 10, 10, now() - interval '12 days', now() - interval '3 days'),
  ('e0000000-0000-4000-8008-000000000002', 'e0000000-0000-4000-8000-000000000001',
   'e0000000-0000-4000-8001-000000000002', 'e0000000-0000-4000-8007-000000000002',
   'Kartkówka — farmakologia układu krążenia',
   'Krótka kartkówka formatywna po seminarium o leczeniu przeciwkrzepliwym.',
   'published', now() + interval '12 days', now() - interval '1 day', 15, true, true,
   true, 3, 50, 8, 8, now() - interval '11 days', now() - interval '1 day'),
  ('e0000000-0000-4000-8008-000000000003', 'e0000000-0000-4000-8000-000000000001',
   'e0000000-0000-4000-8001-000000000003', 'e0000000-0000-4000-8007-000000000003',
   'Kartkówka — nerki i równowaga kwasowo-zasadowa',
   'Kartkówka z transportu kanalikowego i interpretacji gazometrii.',
   'published', now() - interval '2 days', now() - interval '9 days', 20, true, true,
   true, 1, 50, 8, 8, now() - interval '9 days', now() - interval '9 days');

INSERT INTO public.assignment_questions (id, assignment_id, question_id, order_index, points)
SELECT
  pg_temp.demo_uuid('demo-pl:aq:' || qq.quiz_id::text || ':' || qq.question_id::text),
  a.assignment_id,
  qq.question_id,
  qq.order_index,
  1
FROM public.quiz_questions qq
JOIN (VALUES
  ('e0000000-0000-4000-8008-000000000001'::uuid, 'e0000000-0000-4000-8007-000000000001'::uuid),
  ('e0000000-0000-4000-8008-000000000002'::uuid, 'e0000000-0000-4000-8007-000000000002'::uuid),
  ('e0000000-0000-4000-8008-000000000003'::uuid, 'e0000000-0000-4000-8007-000000000003'::uuid)
) AS a(assignment_id, quiz_id) ON a.quiz_id = qq.quiz_id;

INSERT INTO public.assignment_targets (id, assignment_id, group_id, assigned_at)
VALUES
  (pg_temp.demo_uuid('demo-pl:target:1'), 'e0000000-0000-4000-8008-000000000001', 'e0000000-0000-4000-8003-000000000001', now() - interval '12 days'),
  (pg_temp.demo_uuid('demo-pl:target:2'), 'e0000000-0000-4000-8008-000000000002', 'e0000000-0000-4000-8003-000000000001', now() - interval '11 days'),
  (pg_temp.demo_uuid('demo-pl:target:3'), 'e0000000-0000-4000-8008-000000000003', 'e0000000-0000-4000-8003-000000000002', now() - interval '9 days');

-- ----------------------------------------------------------
-- 6. Seats — 11 of 24 seats in use across three pools.
--    `org_seat_pools.assigned` is maintained by the
--    `maintain_seat_counts` trigger, so pools start at 0.
-- ----------------------------------------------------------
INSERT INTO public.org_seat_pools (id, organization_id, plan_key, total, assigned, created_at)
VALUES
  ('e0000000-0000-4000-8009-000000000001', 'e0000000-0000-4000-8000-000000000001', 'campus', 2,  0, now() - interval '56 days'),
  ('e0000000-0000-4000-8009-000000000002', 'e0000000-0000-4000-8000-000000000001', 'master', 2,  0, now() - interval '54 days'),
  ('e0000000-0000-4000-8009-000000000003', 'e0000000-0000-4000-8000-000000000001', 'ace',    20, 0, now() - interval '54 days');

INSERT INTO public.org_seat_assignments (id, organization_id, pool_id, user_id, assigned_at)
SELECT
  pg_temp.demo_uuid('demo-pl:seat:' || s.user_id::text),
  'e0000000-0000-4000-8000-000000000001',
  s.pool_id,
  s.user_id,
  now() - (s.days_ago || ' days')::interval
FROM (VALUES
  ('e0000000-0000-4000-8009-000000000001'::uuid, 'e0000000-0000-4000-8001-000000000001'::uuid, 56),
  ('e0000000-0000-4000-8009-000000000002'::uuid, 'e0000000-0000-4000-8001-000000000002'::uuid, 54),
  ('e0000000-0000-4000-8009-000000000002'::uuid, 'e0000000-0000-4000-8001-000000000003'::uuid, 52),
  ('e0000000-0000-4000-8009-000000000003'::uuid, 'e0000000-0000-4000-8001-000000000004'::uuid, 45),
  ('e0000000-0000-4000-8009-000000000003'::uuid, 'e0000000-0000-4000-8001-000000000005'::uuid, 44),
  ('e0000000-0000-4000-8009-000000000003'::uuid, 'e0000000-0000-4000-8001-000000000006'::uuid, 43),
  ('e0000000-0000-4000-8009-000000000003'::uuid, 'e0000000-0000-4000-8001-000000000007'::uuid, 41),
  ('e0000000-0000-4000-8009-000000000003'::uuid, 'e0000000-0000-4000-8001-000000000008'::uuid, 38),
  ('e0000000-0000-4000-8009-000000000003'::uuid, 'e0000000-0000-4000-8001-000000000009'::uuid, 33),
  ('e0000000-0000-4000-8009-000000000003'::uuid, 'e0000000-0000-4000-8001-00000000000A'::uuid, 26),
  ('e0000000-0000-4000-8009-000000000003'::uuid, 'e0000000-0000-4000-8001-00000000000B'::uuid, 19)
) AS s(pool_id, user_id, days_ago);

-- ----------------------------------------------------------
-- 7. Historia nauki Zofii — osiem tygodni powtórek
--
-- 120 cards, each reviewed on a spaced schedule (same day, +1, +3, +7, +14,
-- +28, +45 days), so the activity chart, the streak, the retention curve and
-- the review-state table all have a real shape. Day positions are relative to
-- `now()`, so the screenshots stay current whenever the seed is applied.
-- ----------------------------------------------------------
INSERT INTO public.user_study_settings (user_id, new_cards_per_day, daily_review_goal, new_cards_introduced, daily_reset_date)
SELECT u.id, 20, 40, 0, CURRENT_DATE
FROM auth.users u
WHERE u.id::text LIKE 'e0000000-0000-4000-8001-%'
  AND u.raw_app_meta_data->>'account_type' = 'student'
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.flashcard_practice (
  id, user_id, flashcard_id, was_correct, practiced_at,
  response_time_ms, confidence_level, session_id, organization_id
)
WITH cards AS (
  SELECT id, row_number() OVER (ORDER BY id) AS n
  FROM public.flashcards
  WHERE organization_id = 'e0000000-0000-4000-8000-000000000001'
  ORDER BY id
  LIMIT 120
),
schedule AS (
  SELECT c.id AS flashcard_id, c.n, o.off, o.extra,
         (56 - (c.n % 12)) - o.off + o.extra * 0 AS day_ago
  FROM cards c
  CROSS JOIN (VALUES (0, 0), (1, 0), (3, 0), (7, 0), (14, 0), (28, 0), (45, 0), (0, 1)) AS o(off, extra)
  WHERE (o.extra = 0 OR c.n % 5 = 0)
)
SELECT
  pg_temp.demo_uuid('demo-pl:practice:' || s.flashcard_id::text || ':' || s.off || ':' || s.extra || ':' || s.n),
  'e0000000-0000-4000-8001-000000000004',
  s.flashcard_id,
  -- Recall accuracy: a per-card difficulty offset, a small penalty for a longer
  -- gap, so recent weeks sit near 80% instead of collapsing to the tail of the
  -- schedule.
  random() < 0.96 - s.off * 0.004 - (s.n % 7) * 0.02,
  date_trunc('day', now())
    - (s.day_ago || ' days')::interval
    + ((18 + (s.n % 3)) || ' hours')::interval
    + (((s.n * 7) % 50 + s.extra * 90 + s.off * 4) || ' minutes')::interval,
  (2400 + random() * 6200)::int,
  1 + (s.off % 5),
  pg_temp.demo_uuid('demo-pl:session:' || s.day_ago),
  'e0000000-0000-4000-8000-000000000001'
FROM schedule s
WHERE s.day_ago >= 1;

-- Jedna sesja na dzień nauki, zsumowana z powtórek tego dnia.
INSERT INTO public.flashcard_study_sessions (
  id, user_id, started_at, completed_at, duration_ms, cards_studied, cards_correct, deck_ids, mode
)
SELECT
  p.session_id,
  p.user_id,
  min(p.practiced_at),
  max(p.practiced_at) + interval '80 seconds',
  (180000 + EXTRACT(EPOCH FROM (max(p.practiced_at) - min(p.practiced_at))) * 1000)::int,
  count(*),
  count(*) FILTER (WHERE p.was_correct),
  ARRAY[
    'e0000000-0000-4000-8006-000000000001'::uuid,
    'e0000000-0000-4000-8006-000000000002'::uuid,
    'e0000000-0000-4000-8006-000000000004'::uuid
  ],
  'review'
FROM public.flashcard_practice p
WHERE p.user_id = 'e0000000-0000-4000-8001-000000000004'
GROUP BY p.session_id, p.user_id;

-- Stan SM-2 dla każdej powtórzonej fiszki: przeważnie karty utrwalone,
-- kilka w trakcie nauki i pojedyncza karta oporna, aby kolumna stanu nie była
-- jedną powtarzaną wartością.
INSERT INTO public.flashcard_review_state (
  user_id, flashcard_id, easiness_factor, interval_days, interval_unit, repetitions,
  next_review_at, last_reviewed_at, last_quality, learning_state, learning_step,
  sm2_lapse_count, is_leech
)
SELECT
  'e0000000-0000-4000-8001-000000000004',
  agg.flashcard_id,
  agg.ef,
  CASE
    WHEN agg.n % 53 = 0 THEN 10
    WHEN agg.n % 11 = 0 THEN 1
    WHEN agg.n % 7 = 0  THEN 10
    ELSE 2 + (agg.n % 24)
  END,
  CASE WHEN agg.n % 11 = 0 OR agg.n % 7 = 0 THEN 'minutes' ELSE 'days' END,
  agg.reps,
  agg.last_reviewed_at + CASE
    WHEN agg.n % 53 = 0 THEN interval '4 days'
    WHEN agg.n % 11 = 0 THEN interval '5 minutes'
    WHEN agg.n % 7 = 0  THEN interval '1 day'
    ELSE ((2 + (agg.n % 13)) || ' days')::interval
  END,
  agg.last_reviewed_at,
  CASE WHEN agg.correct_rate >= 80 THEN 5 WHEN agg.correct_rate >= 60 THEN 4 ELSE 3 END,
  CASE
    WHEN agg.n % 53 = 0 THEN 'relearning'
    WHEN agg.n % 11 = 0 THEN 'relearning'
    WHEN agg.n % 7 = 0  THEN 'learning'
    ELSE 'review'
  END,
  CASE WHEN agg.n % 11 = 0 OR agg.n % 7 = 0 THEN 1 ELSE 0 END,
  CASE WHEN agg.n % 53 = 0 THEN 9 WHEN agg.n % 11 = 0 THEN 3 ELSE 0 END,
  (agg.n % 53 = 0)
FROM (
  SELECT
    p.flashcard_id,
    (SELECT c.n FROM (
       SELECT id, row_number() OVER (ORDER BY id) AS n
       FROM public.flashcards
       WHERE organization_id = 'e0000000-0000-4000-8000-000000000001'
       ORDER BY id LIMIT 120
     ) c WHERE c.id = p.flashcard_id) AS n,
    2.15 + random() * 0.6 AS ef,
    count(*) AS reps,
    max(p.practiced_at) AS last_reviewed_at,
    (100.0 * count(*) FILTER (WHERE p.was_correct) / count(*)) AS correct_rate
  FROM public.flashcard_practice p
  WHERE p.user_id = 'e0000000-0000-4000-8001-000000000004'
  GROUP BY p.flashcard_id
) agg;

-- ----------------------------------------------------------
-- 8. Practice quiz attempts — 30 over eight weeks, 55% → 98%
-- ----------------------------------------------------------
CREATE TEMP TABLE demo_attempt_plan (
  n serial PRIMARY KEY,
  user_id uuid NOT NULL,
  day_ago int NOT NULL,
  pct int NOT NULL,
  bank_id uuid NOT NULL
) ON COMMIT DROP;

-- Zofia: 16 podejść, co trzeci dzień, od 56% do 97%.
INSERT INTO demo_attempt_plan (user_id, day_ago, pct, bank_id)
SELECT 'e0000000-0000-4000-8001-000000000004',
       51 - (g * 3),
       LEAST(97, 56 + (g * 2.6)::int + (g % 3)),
       CASE WHEN g % 2 = 0
            THEN 'e0000000-0000-4000-8020-000000000001'::uuid
            ELSE 'e0000000-0000-4000-8020-000000000002'::uuid END
FROM generate_series(1, 16) AS g;

-- Pozostałych siedmioro studentów: po dwa podejścia, rzadziej i nieregularnie.
INSERT INTO demo_attempt_plan (user_id, day_ago, pct, bank_id)
SELECT
  s.id,
  6 + ((s.k * 7 + j * 11) % 43),
  58 + ((s.k * 5 + j * 9) % 32),
  CASE WHEN (s.k + j) % 2 = 0
       THEN 'e0000000-0000-4000-8020-000000000001'::uuid
       ELSE 'e0000000-0000-4000-8020-000000000002'::uuid END
FROM (VALUES
  ('e0000000-0000-4000-8001-000000000005'::uuid, 1),
  ('e0000000-0000-4000-8001-000000000006'::uuid, 2),
  ('e0000000-0000-4000-8001-000000000007'::uuid, 3),
  ('e0000000-0000-4000-8001-000000000008'::uuid, 4),
  ('e0000000-0000-4000-8001-000000000009'::uuid, 5),
  ('e0000000-0000-4000-8001-00000000000A'::uuid, 6),
  ('e0000000-0000-4000-8001-00000000000B'::uuid, 7)
) AS s(id, k)
CROSS JOIN generate_series(1, 2) AS j;

DO $$
DECLARE
  r record;
  v_attempt uuid;
  v_started timestamptz;
  v_score int;
  v_qids uuid[];
  v_qid uuid;
  v_idx int;
  v_opt uuid;
  v_type public.question_type;
BEGIN
  FOR r IN SELECT * FROM demo_attempt_plan ORDER BY n LOOP
    v_attempt := pg_temp.demo_uuid('demo-pl:attempt:' || r.n || ':' || r.user_id::text);
    v_score := GREATEST(1, LEAST(8, round(r.pct * 8.0 / 100)));
    v_started := date_trunc('day', now())
      - (r.day_ago || ' days')::interval
      + interval '17 hours'
      + ((r.n * 13) % 60 || ' minutes')::interval;

    SELECT array_agg(x.question_id ORDER BY x.slot) INTO v_qids
    FROM (
      SELECT m.question_id, m.slot
      FROM demo_q_map m
      JOIN public.questions q ON q.id = m.question_id AND q.type <> 'open'
      WHERE m.bank_id = r.bank_id
      ORDER BY m.slot
      LIMIT 8
    ) x;

    INSERT INTO public.quiz_attempts (
      id, user_id, score, total_questions, total_points, config,
      started_at, completed_at, organization_id
    )
    VALUES (
      v_attempt, r.user_id, v_score, 8, 8,
      jsonb_build_object('questionCount', 8, 'questionTypes', jsonb_build_array('mcq', 'true_false')),
      v_started, v_started + ((9 + r.n % 6) || ' minutes')::interval,
      'e0000000-0000-4000-8000-000000000001'
    );

    FOR v_idx IN 1..8 LOOP
      v_qid := v_qids[v_idx];
      SELECT type INTO v_type FROM public.questions WHERE id = v_qid;

      INSERT INTO public.quiz_attempt_questions (attempt_id, question_id, order_index)
      VALUES (v_attempt, v_qid, v_idx - 1);

      IF v_idx <= v_score THEN
        SELECT id INTO v_opt FROM public.question_options WHERE question_id = v_qid AND is_correct LIMIT 1;
      ELSE
        SELECT id INTO v_opt FROM public.question_options WHERE question_id = v_qid AND NOT is_correct LIMIT 1;
      END IF;

      INSERT INTO public.student_answers (
        id, attempt_id, question_id, question_type, selected_option_id,
        is_correct, points_earned, created_at
      )
      VALUES (
        pg_temp.demo_uuid('demo-pl:answer:' || v_attempt::text || ':' || v_qid::text),
        v_attempt, v_qid, v_type, v_opt,
        v_idx <= v_score,
        CASE WHEN v_idx <= v_score THEN 1 ELSE 0 END,
        v_started + (v_idx || ' minutes')::interval
      );
    END LOOP;
  END LOOP;
END $$;

-- ----------------------------------------------------------
-- 9. Assignment submissions — the midterm and the renal quiz
--    were sat by several students.
-- ----------------------------------------------------------
CREATE TEMP TABLE demo_assignment_plan (
  n serial PRIMARY KEY,
  assignment_id uuid NOT NULL,
  user_id uuid NOT NULL,
  day_ago int NOT NULL,
  points int NOT NULL
) ON COMMIT DROP;

INSERT INTO demo_assignment_plan (assignment_id, user_id, day_ago, points)
VALUES
  ('e0000000-0000-4000-8008-000000000001', 'e0000000-0000-4000-8001-000000000004', 9,  9),
  ('e0000000-0000-4000-8008-000000000001', 'e0000000-0000-4000-8001-000000000005', 8,  7),
  ('e0000000-0000-4000-8008-000000000001', 'e0000000-0000-4000-8001-000000000006', 8,  8),
  ('e0000000-0000-4000-8008-000000000001', 'e0000000-0000-4000-8001-000000000007', 7,  6),
  ('e0000000-0000-4000-8008-000000000002', 'e0000000-0000-4000-8001-000000000004', 4,  7),
  ('e0000000-0000-4000-8008-000000000002', 'e0000000-0000-4000-8001-000000000008', 3,  6),
  ('e0000000-0000-4000-8008-000000000003', 'e0000000-0000-4000-8001-000000000004', 3,  6),
  ('e0000000-0000-4000-8008-000000000003', 'e0000000-0000-4000-8001-000000000009', 2,  5),
  ('e0000000-0000-4000-8008-000000000003', 'e0000000-0000-4000-8001-00000000000A', 2,  7);

DO $$
DECLARE
  r record;
  v_attempt uuid;
  v_started timestamptz;
  v_total int;
  v_qids uuid[];
  v_qid uuid;
  v_idx int;
  v_opt uuid;
  v_type public.question_type;
  v_quiz uuid;
BEGIN
  FOR r IN SELECT * FROM demo_assignment_plan ORDER BY n LOOP
    v_attempt := pg_temp.demo_uuid('demo-pl:assignment:' || r.n || ':' || r.user_id::text);
    v_started := date_trunc('day', now())
      - (r.day_ago || ' days')::interval
      + interval '10 hours'
      + ((r.n * 17) % 45 || ' minutes')::interval;

    SELECT quiz_id INTO v_quiz FROM public.teacher_assignments WHERE id = r.assignment_id;

    SELECT array_agg(x.question_id ORDER BY x.order_index) INTO v_qids
    FROM (
      SELECT qq.question_id, qq.order_index
      FROM public.quiz_questions qq
      WHERE qq.quiz_id = v_quiz
      ORDER BY qq.order_index
      LIMIT 10
    ) x;

    v_total := array_length(v_qids, 1);

    INSERT INTO public.quiz_attempts (
      id, user_id, score, total_questions, total_points, config,
      started_at, completed_at, assignment_id, graded_at, organization_id
    )
    VALUES (
      v_attempt, r.user_id, r.points, v_total, v_total,
      jsonb_build_object('questionCount', v_total),
      v_started, v_started + interval '22 minutes',
      r.assignment_id, v_started + interval '1 day',
      'e0000000-0000-4000-8000-000000000001'
    );

    FOR v_idx IN 1..v_total LOOP
      v_qid := v_qids[v_idx];
      SELECT type INTO v_type FROM public.questions WHERE id = v_qid;

      INSERT INTO public.quiz_attempt_questions (attempt_id, question_id, order_index)
      VALUES (v_attempt, v_qid, v_idx - 1);

      IF v_idx <= r.points THEN
        SELECT id INTO v_opt FROM public.question_options WHERE question_id = v_qid AND is_correct LIMIT 1;
      ELSE
        SELECT id INTO v_opt FROM public.question_options WHERE question_id = v_qid AND NOT is_correct LIMIT 1;
      END IF;

      INSERT INTO public.student_answers (
        id, attempt_id, question_id, question_type, selected_option_id,
        is_correct, points_earned, created_at
      )
      VALUES (
        pg_temp.demo_uuid('demo-pl:asg-answer:' || v_attempt::text || ':' || v_qid::text),
        v_attempt, v_qid, v_type, v_opt,
        v_idx <= r.points,
        CASE WHEN v_idx <= r.points THEN 1 ELSE 0 END,
        v_started + (v_idx || ' minutes')::interval
      );
    END LOOP;
  END LOOP;
END $$;

-- ----------------------------------------------------------
-- 10. Jedna kartkówka w toku u Zofii
--
-- The taking screen is part of the product tour, and it only renders an
-- unfinished attempt. Two answers are already drafted, so the shot shows a
-- quiz under way rather than a blank first question.
-- ----------------------------------------------------------
INSERT INTO public.quiz_attempts (
  id, user_id, score, total_questions, total_points, config,
  draft_answers, started_at, completed_at, organization_id
)
VALUES (
  'e0000000-0000-4000-800b-000000000001',
  'e0000000-0000-4000-8001-000000000004',
  0, 8, 8,
  jsonb_build_object('questionCount', 8, 'topicIds', jsonb_build_array('e0000000-0000-4000-8004-000000000001')),
  '{}'::jsonb,
  now() - interval '9 minutes',
  NULL,
  'e0000000-0000-4000-8000-000000000001'
);

INSERT INTO public.quiz_attempt_questions (attempt_id, question_id, order_index)
SELECT 'e0000000-0000-4000-800b-000000000001', m.question_id, row_number() OVER (ORDER BY m.slot) - 1
FROM demo_q_map m
JOIN public.questions q ON q.id = m.question_id AND q.type <> 'open'
WHERE m.bank_id = 'e0000000-0000-4000-8020-000000000001'
  AND m.slot BETWEEN 5 AND 13;

COMMIT;
