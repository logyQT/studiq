-- ==========================================================
-- Seed: demo-en — Northfield University (English demo tenant)
--
-- One half of the marketing demo pair; `demo-pl.sql` is the Polish twin with
-- the same shape (people, org, content and history), so the landing page can
-- show product imagery that matches the UI locale.
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
-- This tenant owns the `d0000000-…` id block and the `@example.edu` accounts
-- listed below; `demo-pl.sql` owns `e0000000-…`. Neither reset block can match
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
DELETE FROM public.organizations WHERE id = 'd0000000-0000-4000-8000-000000000001';
DELETE FROM auth.users WHERE id::text LIKE 'd0000000-0000-4000-8001-%';

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
  ('d0000000-0000-4000-8001-000000000001'::uuid, 'michael.brown@example.edu', 'manager',  'Michael Brown'),
  ('d0000000-0000-4000-8001-000000000002'::uuid, 'emily.carter@example.edu',  'educator', 'Dr. Emily Carter'),
  ('d0000000-0000-4000-8001-000000000003'::uuid, 'daniel.weber@example.edu',  'educator', 'Dr. Daniel Weber'),
  ('d0000000-0000-4000-8001-000000000004'::uuid, 'alice.jones@example.edu',   'student',  'Alice Jones'),
  ('d0000000-0000-4000-8001-000000000005'::uuid, 'john.smith@example.edu',    'student',  'John Smith'),
  ('d0000000-0000-4000-8001-000000000006'::uuid, 'jane.doe@example.edu',      'student',  'Jane Doe'),
  ('d0000000-0000-4000-8001-000000000007'::uuid, 'omar.haddad@example.edu',   'student',  'Omar Haddad'),
  ('d0000000-0000-4000-8001-000000000008'::uuid, 'sofia.rossi@example.edu',   'student',  'Sofia Rossi'),
  ('d0000000-0000-4000-8001-000000000009'::uuid, 'liam.oconnor@example.edu',  'student',  'Liam O''Connor'),
  ('d0000000-0000-4000-8001-00000000000A'::uuid, 'yuki.tanaka@example.edu',   'student',  'Yuki Tanaka'),
  ('d0000000-0000-4000-8001-00000000000B'::uuid, 'priya.patel@example.edu',   'student',  'Priya Patel')
) AS u(id, email, account_type, full_name)
ON CONFLICT DO NOTHING;

INSERT INTO auth.identities (
  id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
SELECT
  pg_temp.demo_uuid('demo:identity:' || u.id::text),
  u.id::text,
  u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true, 'phone_verified', false),
  'email',
  now() - interval '1 day',
  now() - interval '60 days',
  now() - interval '1 day'
FROM auth.users u
WHERE u.id::text LIKE 'd0000000-0000-4000-8001-%'
ON CONFLICT DO NOTHING;

-- handle_new_user already inserted the profiles; this keeps the seed readable
-- on its own and pins the demo plan for the two accounts the shots use.
INSERT INTO public.profiles (id, email, full_name)
SELECT u.id, u.email, u.raw_user_meta_data->>'name'
FROM auth.users u
WHERE u.id::text LIKE 'd0000000-0000-4000-8001-%'
ON CONFLICT (id) DO NOTHING;

-- The members list renders `profiles.created_at` as the join date, so it has to
-- agree with `org_members.joined_at` instead of the moment the seed ran.
UPDATE public.profiles p
SET created_at = now() - (v.days || ' days')::interval
FROM (VALUES
  ('d0000000-0000-4000-8001-000000000001'::uuid, 56),
  ('d0000000-0000-4000-8001-000000000002'::uuid, 54),
  ('d0000000-0000-4000-8001-000000000003'::uuid, 52),
  ('d0000000-0000-4000-8001-000000000004'::uuid, 45),
  ('d0000000-0000-4000-8001-000000000005'::uuid, 44),
  ('d0000000-0000-4000-8001-000000000006'::uuid, 43),
  ('d0000000-0000-4000-8001-000000000007'::uuid, 41),
  ('d0000000-0000-4000-8001-000000000008'::uuid, 38),
  ('d0000000-0000-4000-8001-000000000009'::uuid, 33),
  ('d0000000-0000-4000-8001-00000000000A'::uuid, 26),
  ('d0000000-0000-4000-8001-00000000000B'::uuid, 19)
) AS v(id, days)
WHERE p.id = v.id;

-- Alice pays for StudiQ Pro herself; the rest sit in the university's seats.
UPDATE public.profiles SET personal_plan_key = 'pro' WHERE id = 'd0000000-0000-4000-8001-000000000004';

-- ----------------------------------------------------------
-- 2. Organization, roles, groups
--
-- Inserting the org fires `handle_new_organization`, which creates the
-- admin/teacher/member roles, their permissions and the role feature rows for
-- the plan — the subselects below can rely on that.
-- ----------------------------------------------------------
INSERT INTO public.organizations (id, name, plan, created_at)
VALUES (
  'd0000000-0000-4000-8000-000000000001',
  'Northfield University',
  'campus',
  now() - interval '400 days'
);

INSERT INTO public.org_members (id, organization_id, user_id, org_role_id, joined_at)
SELECT
  pg_temp.demo_uuid('demo:member:' || m.id::text),
  'd0000000-0000-4000-8000-000000000001',
  m.id,
  (SELECT r.id FROM public.org_roles r
    WHERE r.organization_id = 'd0000000-0000-4000-8000-000000000001' AND r.name = m.org_role),
  now() - (m.joined_days || ' days')::interval
FROM (VALUES
  ('d0000000-0000-4000-8001-000000000001'::uuid, 'admin',   56),
  ('d0000000-0000-4000-8001-000000000002'::uuid, 'teacher', 54),
  ('d0000000-0000-4000-8001-000000000003'::uuid, 'teacher', 52),
  ('d0000000-0000-4000-8001-000000000004'::uuid, 'member',  45),
  ('d0000000-0000-4000-8001-000000000005'::uuid, 'member',  44),
  ('d0000000-0000-4000-8001-000000000006'::uuid, 'member',  43),
  ('d0000000-0000-4000-8001-000000000007'::uuid, 'member',  41),
  ('d0000000-0000-4000-8001-000000000008'::uuid, 'member',  38),
  ('d0000000-0000-4000-8001-000000000009'::uuid, 'member',  33),
  ('d0000000-0000-4000-8001-00000000000A'::uuid, 'member',  26),
  ('d0000000-0000-4000-8001-00000000000B'::uuid, 'member',  19)
) AS m(id, org_role, joined_days);

INSERT INTO public.groups (id, organization_id, name, description, is_default, created_by, created_at)
VALUES
  ('d0000000-0000-4000-8003-000000000001', 'd0000000-0000-4000-8000-000000000001',
   'MED-201 Pharmacology', 'Autumn term — pharmacology track', true,
   'd0000000-0000-4000-8001-000000000002', now() - interval '53 days'),
  ('d0000000-0000-4000-8003-000000000002', 'd0000000-0000-4000-8000-000000000001',
   'MED-201 Physiology', 'Autumn term — physiology track', false,
   'd0000000-0000-4000-8001-000000000003', now() - interval '53 days');

-- Alice sits in both tracks; each educator teaches their own.
INSERT INTO public.group_members (id, group_id, user_id, role, joined_at)
SELECT
  pg_temp.demo_uuid('demo:gm:' || g.group_id::text || ':' || g.user_id::text),
  g.group_id,
  g.user_id,
  g.role,
  now() - (g.joined_days || ' days')::interval
FROM (VALUES
  ('d0000000-0000-4000-8003-000000000001'::uuid, 'd0000000-0000-4000-8001-000000000002'::uuid, 'teacher', 53),
  ('d0000000-0000-4000-8003-000000000001'::uuid, 'd0000000-0000-4000-8001-000000000004'::uuid, 'member',  45),
  ('d0000000-0000-4000-8003-000000000001'::uuid, 'd0000000-0000-4000-8001-000000000005'::uuid, 'member',  44),
  ('d0000000-0000-4000-8003-000000000001'::uuid, 'd0000000-0000-4000-8001-000000000006'::uuid, 'member',  43),
  ('d0000000-0000-4000-8003-000000000001'::uuid, 'd0000000-0000-4000-8001-000000000007'::uuid, 'member',  41),
  ('d0000000-0000-4000-8003-000000000001'::uuid, 'd0000000-0000-4000-8001-000000000008'::uuid, 'member',  38),
  ('d0000000-0000-4000-8003-000000000002'::uuid, 'd0000000-0000-4000-8001-000000000003'::uuid, 'teacher', 52),
  ('d0000000-0000-4000-8003-000000000002'::uuid, 'd0000000-0000-4000-8001-000000000004'::uuid, 'member',  45),
  ('d0000000-0000-4000-8003-000000000002'::uuid, 'd0000000-0000-4000-8001-000000000009'::uuid, 'member',  33),
  ('d0000000-0000-4000-8003-000000000002'::uuid, 'd0000000-0000-4000-8001-00000000000A'::uuid, 'member',  26),
  ('d0000000-0000-4000-8003-000000000002'::uuid, 'd0000000-0000-4000-8001-00000000000B'::uuid, 'member',  19)
) AS g(group_id, user_id, role, joined_days);

INSERT INTO public.topics (id, organization_id, created_by, name, visibility, created_at)
VALUES
  ('d0000000-0000-4000-8004-000000000001', 'd0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8001-000000000002', 'Pharmacology', 'group', now() - interval '52 days'),
  ('d0000000-0000-4000-8004-000000000002', 'd0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8001-000000000003', 'Physiology', 'group', now() - interval '52 days'),
  ('d0000000-0000-4000-8004-000000000003', 'd0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8001-000000000002', 'Clinical Practice', 'group', now() - interval '40 days');

INSERT INTO public.topic_groups (topic_id, group_id)
VALUES
  ('d0000000-0000-4000-8004-000000000001', 'd0000000-0000-4000-8003-000000000001'),
  ('d0000000-0000-4000-8004-000000000002', 'd0000000-0000-4000-8003-000000000002'),
  ('d0000000-0000-4000-8004-000000000003', 'd0000000-0000-4000-8003-000000000001'),
  ('d0000000-0000-4000-8004-000000000003', 'd0000000-0000-4000-8003-000000000002');

-- ----------------------------------------------------------
-- 3. Decks and flashcards
--
-- 80 curated cards (40 pharmacology, 40 physiology) distributed over five
-- decks of 44. Decks of one topic overlap deliberately — the same card can be
-- taught in two pharmacology modules — while every deck is internally distinct.
-- ----------------------------------------------------------
CREATE TEMP TABLE demo_card_pool (genre text, ord int, front text, back text) ON COMMIT DROP;

INSERT INTO demo_card_pool (genre, ord, front, back) VALUES
  ('pharm', 1,  'What is the mechanism of action of aspirin?', 'Irreversibly acetylates COX-1 and COX-2, reducing thromboxane A2 and prostaglandin synthesis.'),
  ('pharm', 2,  'Which enzyme converts angiotensin I to angiotensin II?', 'Angiotensin-converting enzyme (ACE) — the target of ACE inhibitors.'),
  ('pharm', 3,  'First-line drug for an acute asthma attack?', 'An inhaled short-acting beta-2 agonist (salbutamol), plus systemic corticosteroids.'),
  ('pharm', 4,  'What is the antidote for paracetamol overdose?', 'N-acetylcysteine, most effective when started within 8 hours of ingestion.'),
  ('pharm', 5,  'What do drug names ending in "-pril" have in common?', 'They are ACE inhibitors: ramipril, enalapril, lisinopril.'),
  ('pharm', 6,  'What do drug names ending in "-olol" have in common?', 'They are beta-adrenoceptor antagonists: metoprolol, bisoprolol, atenolol.'),
  ('pharm', 7,  'Why is omeprazole taken before a meal?', 'A proton-pump inhibitor only blocks pumps that are actively secreting, so dosing 30–60 min before eating maximises effect.'),
  ('pharm', 8,  'Which vitamin deficiency does methotrexate cause?', 'Folate (vitamin B9) deficiency, which is why folic acid is co-prescribed.'),
  ('pharm', 9,  'What is the antidote for opioid overdose?', 'Naloxone, a competitive antagonist at opioid receptors.'),
  ('pharm', 10, 'Which anticoagulant is monitored with the INR?', 'Warfarin; the usual target is INR 2.0–3.0 in atrial fibrillation.'),
  ('pharm', 11, 'What is the mechanism of heparin?', 'It activates antithrombin III, which in turn inactivates thrombin and factor Xa.'),
  ('pharm', 12, 'Which antibiotic classes act on the 30S ribosomal subunit?', 'Aminoglycosides (gentamicin, amikacin) and tetracyclines.'),
  ('pharm', 13, 'Which drug class commonly causes a dry cough?', 'ACE inhibitors, through accumulation of bradykinin in the airways.'),
  ('pharm', 14, 'What is first-line therapy for hypertension in a young adult?', 'An ACE inhibitor or ARB, or a calcium-channel blocker such as amlodipine.'),
  ('pharm', 15, 'What does a statin inhibit?', 'HMG-CoA reductase, the rate-limiting enzyme of cholesterol synthesis.'),
  ('pharm', 16, 'Which adverse effects are characteristic of aminoglycosides?', 'Nephrotoxicity and ototoxicity, which is why levels are monitored.'),
  ('pharm', 17, 'What is the antidote for benzodiazepine overdose?', 'Flumazenil, a competitive antagonist at the benzodiazepine site of GABA-A receptors.'),
  ('pharm', 18, 'Which diuretic acts on the loop of Henle?', 'Loop diuretics such as furosemide, which inhibit the Na-K-2Cl cotransporter.'),
  ('pharm', 19, 'Which diuretic is potassium-sparing?', 'Spironolactone, an aldosterone receptor antagonist.'),
  ('pharm', 20, 'What is the therapeutic index?', 'The ratio between the toxic dose and the effective dose — a narrow index means careful monitoring.'),
  ('pharm', 21, 'What does first-pass metabolism mean?', 'Drug absorbed from the gut is metabolised by the liver before reaching the systemic circulation.'),
  ('pharm', 22, 'Which enzyme family metabolises most drugs?', 'Cytochrome P450, predominantly CYP3A4.'),
  ('pharm', 23, 'Why does rifampicin reduce the effect of oral contraceptives?', 'It induces CYP3A4, accelerating oestrogen metabolism — enzyme induction.'),
  ('pharm', 24, 'Why is warfarin combined with an NSAID risky?', 'Both impair haemostasis: the NSAID adds antiplatelet action and GI bleeding risk while raising the INR.'),
  ('pharm', 25, 'Which beta-blocker is cardioselective?', 'Bisoprolol, which is beta-1 selective, unlike propranolol.'),
  ('pharm', 26, 'What is the mechanism of metformin?', 'It reduces hepatic gluconeogenesis and improves peripheral insulin sensitivity.'),
  ('pharm', 27, 'Which antidiabetic drugs can cause hypoglycaemia?', 'Sulfonylureas such as gliclazide, and insulin.'),
  ('pharm', 28, 'What is the mechanism of action of morphine?', 'Agonist at mu-opioid receptors in the CNS, reducing pain transmission and perception.'),
  ('pharm', 29, 'Which drug reverses heparin?', 'Protamine sulfate, which binds heparin into an inactive complex.'),
  ('pharm', 30, 'What is a loading dose for?', 'Rapidly reaching a therapeutic plasma concentration when the elimination half-life is long.'),
  ('pharm', 31, 'Which drug class lowers both LDL cholesterol and cardiovascular mortality?', 'Statins, through HMG-CoA reductase inhibition.'),
  ('pharm', 32, 'Which antibiotic class is contraindicated in pregnancy?', 'Tetracyclines — they chelate calcium and discolour developing teeth and bone.'),
  ('pharm', 33, 'What is the mechanism of beta-lactam antibiotics?', 'They inhibit bacterial cell-wall synthesis by binding penicillin-binding proteins.'),
  ('pharm', 34, 'Which antifungal class targets ergosterol synthesis?', 'Azoles such as fluconazole, which inhibit 14-alpha-demethylase.'),
  ('pharm', 35, 'How does grapefruit juice change simvastatin exposure?', 'It inhibits intestinal CYP3A4, raising plasma levels and the risk of myopathy.'),
  ('pharm', 36, 'Which symptoms suggest digoxin toxicity?', 'Nausea, visual disturbance (yellow-green halos) and bradyarrhythmias.'),
  ('pharm', 37, 'What is the mechanism of salbutamol?', 'Beta-2 adrenoceptor agonism, producing bronchodilation.'),
  ('pharm', 38, 'Which drugs prevent migraine by blocking CGRP?', 'CGRP monoclonal antibodies such as erenumab.'),
  ('pharm', 39, 'When is therapeutic drug monitoring required?', 'For drugs with a narrow therapeutic index — digoxin, lithium, vancomycin, gentamicin.'),
  ('pharm', 40, 'What is the antidote for iron overdose?', 'Desferrioxamine, an iron chelator.'),
  ('phys', 1,  'What is the main function of the loop of Henle?', 'It builds the medullary osmotic gradient that allows water reabsorption and concentrated urine.'),
  ('phys', 2,  'Which hormone increases water reabsorption in the collecting duct?', 'Antidiuretic hormone (vasopressin), via aquaporin-2 channels.'),
  ('phys', 3,  'What is a normal resting cardiac output?', 'About 5 L/min — roughly 70 mL stroke volume at 70 beats per minute.'),
  ('phys', 4,  'What happens during cardiac diastole?', 'The ventricles relax and fill; coronary perfusion occurs mainly in this phase.'),
  ('phys', 5,  'What does the Frank-Starling law describe?', 'Greater ventricular filling stretches the myocardium and increases contractile force, up to a physiological limit.'),
  ('phys', 6,  'Which cells produce insulin?', 'Beta cells of the pancreatic islets of Langerhans.'),
  ('phys', 7,  'What is the main buffer system of plasma?', 'The bicarbonate system (H2CO3 / HCO3-).'),
  ('phys', 8,  'What is the normal pH range of arterial blood?', '7.35–7.45.'),
  ('phys', 9,  'Which muscle is the main muscle of inspiration?', 'The diaphragm, assisted by the external intercostals.'),
  ('phys', 10, 'What is tidal volume?', 'The volume moved in or out during a normal breath — about 500 mL.'),
  ('phys', 11, 'What is physiological dead space?', 'The part of each breath that ventilates airways without perfused alveoli, so no gas exchange occurs.'),
  ('phys', 12, 'Where does gas exchange take place?', 'Across the alveolar-capillary membrane in the alveoli.'),
  ('phys', 13, 'What carries most of the oxygen in blood?', 'Haemoglobin; only a small fraction is dissolved in plasma.'),
  ('phys', 14, 'What shifts the oxygen-haemoglobin curve to the right?', 'Raised CO2, acidity, temperature and 2,3-DPG — the Bohr effect.'),
  ('phys', 15, 'Which nerve carries parasympathetic outflow to the heart?', 'The vagus nerve (cranial nerve X).'),
  ('phys', 16, 'What does sympathetic stimulation do to heart rate?', 'It raises it through beta-1 adrenoceptors — positive chronotropy.'),
  ('phys', 17, 'What is the role of the sinoatrial node?', 'It is the heart''s pacemaker, depolarising spontaneously 60–100 times per minute.'),
  ('phys', 18, 'What is a normal glomerular filtration rate?', 'About 125 mL/min — roughly 180 litres filtered per day.'),
  ('phys', 19, 'Where is most filtered glucose reabsorbed?', 'In the proximal convoluted tubule, via SGLT2 cotransporters.'),
  ('phys', 20, 'What is the renal threshold for glucose?', 'About 10 mmol/L; above it, glucose spills into the urine.'),
  ('phys', 21, 'Which hormone raises blood calcium by increasing bone resorption?', 'Parathyroid hormone (PTH).'),
  ('phys', 22, 'Which hormone lowers blood calcium?', 'Calcitonin, secreted by thyroid C cells.'),
  ('phys', 23, 'Which organ secretes erythropoietin?', 'The kidney, in response to tissue hypoxia.'),
  ('phys', 24, 'What does the renin-angiotensin-aldosterone system do?', 'It maintains blood pressure and sodium balance.'),
  ('phys', 25, 'What does aldosterone do?', 'Increases sodium reabsorption and potassium excretion in the distal nephron.'),
  ('phys', 26, 'What is the main function of the large intestine?', 'Absorbing water and electrolytes and forming faeces.'),
  ('phys', 27, 'Which enzyme starts protein digestion in the stomach?', 'Pepsin, activated from pepsinogen by gastric acid.'),
  ('phys', 28, 'Where is most nutrient absorption completed?', 'In the small intestine, mainly the jejunum.'),
  ('phys', 29, 'What is the role of bile salts?', 'They emulsify dietary fats so pancreatic lipase can act.'),
  ('phys', 30, 'Which hormone stimulates gastric acid secretion?', 'Gastrin, from G cells of the gastric antrum.'),
  ('phys', 31, 'What is a normal fasting blood glucose?', 'About 3.9–5.5 mmol/L.'),
  ('phys', 32, 'What is the physiological response to hypoglycaemia?', 'Glucagon and adrenaline release, driving glycogenolysis and gluconeogenesis.'),
  ('phys', 33, 'Which hormones are released by the posterior pituitary?', 'Oxytocin and antidiuretic hormone.'),
  ('phys', 34, 'What does cortisol do?', 'Raises blood glucose, suppresses inflammation and maintains vascular tone.'),
  ('phys', 35, 'Which part of the brain regulates body temperature?', 'The hypothalamus.'),
  ('phys', 36, 'What is the function of the myelin sheath?', 'It speeds up conduction through saltatory propagation between nodes of Ranvier.'),
  ('phys', 37, 'What is the resting membrane potential of a neuron?', 'About -70 mV, set mainly by potassium permeability.'),
  ('phys', 38, 'Which neurotransmitter is released at the neuromuscular junction?', 'Acetylcholine, acting on nicotinic receptors of the motor end plate.'),
  ('phys', 39, 'What is the role of pulmonary surfactant?', 'It lowers alveolar surface tension and prevents collapse at end-expiration.'),
  ('phys', 40, 'What happens during cardiac systole?', 'The ventricles contract and eject blood into the aorta and pulmonary artery.');

INSERT INTO public.flashcard_decks (id, organization_id, created_by, name, description, visibility, created_at, updated_at)
VALUES
  ('d0000000-0000-4000-8006-000000000001', 'd0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8001-000000000002', 'Pharmacokinetics & Drug Principles',
   'How drugs are absorbed, distributed and cleared, and the vocabulary of prescribing.',
   'group', now() - interval '50 days', now() - interval '9 days'),
  ('d0000000-0000-4000-8006-000000000002', 'd0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8001-000000000002', 'Cardiovascular Pharmacology',
   'Antihypertensives, anticoagulants, antiplatelets and the drugs used in heart failure.',
   'group', now() - interval '46 days', now() - interval '6 days'),
  ('d0000000-0000-4000-8006-000000000003', 'd0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8001-000000000002', 'Antimicrobial & Endocrine Therapy',
   'Antibiotic classes, antifungals, and the pharmacology of diabetes and thyroid disease.',
   'group', now() - interval '41 days', now() - interval '4 days'),
  ('d0000000-0000-4000-8006-000000000004', 'd0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8001-000000000003', 'Renal & Acid-Base Physiology',
   'Filtration, tubular transport, and how the kidney defends pH and potassium.',
   'group', now() - interval '48 days', now() - interval '7 days'),
  ('d0000000-0000-4000-8006-000000000005', 'd0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8001-000000000003', 'Cardiovascular & Respiratory Physiology',
   'The cardiac cycle, gas exchange, and the control of breathing and blood pressure.',
   'group', now() - interval '44 days', now() - interval '3 days');

INSERT INTO public.deck_groups (deck_id, group_id)
VALUES
  ('d0000000-0000-4000-8006-000000000001', 'd0000000-0000-4000-8003-000000000001'),
  ('d0000000-0000-4000-8006-000000000002', 'd0000000-0000-4000-8003-000000000001'),
  ('d0000000-0000-4000-8006-000000000003', 'd0000000-0000-4000-8003-000000000001'),
  ('d0000000-0000-4000-8006-000000000004', 'd0000000-0000-4000-8003-000000000002'),
  ('d0000000-0000-4000-8006-000000000005', 'd0000000-0000-4000-8003-000000000002');

INSERT INTO public.flashcards (id, organization_id, created_by, front, back, visibility, deck_id, created_at)
SELECT
  pg_temp.demo_uuid('demo:card:' || d.deck_id::text || ':' || g.n),
  'd0000000-0000-4000-8000-000000000001',
  d.author,
  p.front,
  p.back,
  'group',
  d.deck_id,
  now() - interval '49 days' + ((g.n * 40) || ' minutes')::interval
FROM (VALUES
  ('d0000000-0000-4000-8006-000000000001'::uuid, 'pharm', 0,  'd0000000-0000-4000-8001-000000000002'::uuid),
  ('d0000000-0000-4000-8006-000000000002'::uuid, 'pharm', 12, 'd0000000-0000-4000-8001-000000000002'::uuid),
  ('d0000000-0000-4000-8006-000000000003'::uuid, 'pharm', 24, 'd0000000-0000-4000-8001-000000000002'::uuid),
  ('d0000000-0000-4000-8006-000000000004'::uuid, 'phys',  0,  'd0000000-0000-4000-8001-000000000003'::uuid),
  ('d0000000-0000-4000-8006-000000000005'::uuid, 'phys',  14, 'd0000000-0000-4000-8001-000000000003'::uuid)
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
         WHEN 'd0000000-0000-4000-8006-000000000001'::uuid THEN 'd0000000-0000-4000-8004-000000000001'::uuid
         WHEN 'd0000000-0000-4000-8006-000000000002'::uuid THEN 'd0000000-0000-4000-8004-000000000001'::uuid
         WHEN 'd0000000-0000-4000-8006-000000000003'::uuid THEN 'd0000000-0000-4000-8004-000000000001'::uuid
         WHEN 'd0000000-0000-4000-8006-000000000004'::uuid THEN 'd0000000-0000-4000-8004-000000000002'::uuid
         ELSE 'd0000000-0000-4000-8004-000000000002'::uuid
       END
FROM public.flashcards f
WHERE f.organization_id = 'd0000000-0000-4000-8000-000000000001';

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
  -- Cycle 1 — pharmacokinetics
  (1,  'pharm', 'true_false', 'The bioavailability of an intravenous drug is 100%.', 'Intravenous administration bypasses absorption and first-pass metabolism entirely.', 'True', 'False', NULL, NULL, 0),
  (2,  'pharm', 'mcq', 'Which route of administration avoids first-pass metabolism?', 'The intravenous route delivers drug directly into the systemic circulation.', 'Oral', 'Intravenous', 'Rectal', 'Subcutaneous', 2),
  (3,  'pharm', 'mcq', 'What does a drug''s half-life describe?', 'Half-life is the time for plasma concentration to fall by half.', 'Time to reach peak concentration', 'Time for plasma concentration to halve', 'Time to excrete a full dose', 'Time to clinical onset', 2),
  (4,  'pharm', 'open', 'Explain why a drug with a high first-pass effect needs a larger oral dose than intravenous dose.', 'Portal circulation metabolises part of the oral dose before it reaches systemic availability.', NULL, NULL, NULL, NULL, NULL),
  (5,  'pharm', 'mcq', 'Which parameter describes the volume into which a drug appears to distribute?', 'Vd relates the amount of drug in the body to its plasma concentration.', 'Clearance', 'Volume of distribution', 'Half-life', 'Area under the curve', 2),
  (6,  'pharm', 'mcq', 'A drug is 95% protein-bound. What does this imply?', 'Only the free fraction is pharmacologically active.', 'Little free drug is available for effect', 'It is excreted rapidly by the kidney', 'It cannot interact with other drugs', 'It has very high hepatic clearance', 1),
  -- Cycle 2 — pharmacodynamics and adverse reactions
  (7,  'pharm', 'true_false', 'A competitive antagonist can be overcome by raising the agonist concentration.', 'Both compete for the same binding site, so enough agonist restores the response.', 'True', 'False', NULL, NULL, 0),
  (8,  'pharm', 'mcq', 'What is the efficacy of a drug?', 'Efficacy is the maximal response a drug can produce.', 'The dose needed for half-maximal effect', 'The maximal response it can produce', 'Its plasma half-life', 'Its receptor affinity', 2),
  (9,  'pharm', 'mcq', 'Which receptor is a ligand-gated ion channel?', 'The nicotinic acetylcholine receptor opens an ion pore directly on binding.', 'G-protein coupled receptor', 'Nicotinic acetylcholine receptor', 'Tyrosine kinase receptor', 'Nuclear receptor', 2),
  (10, 'pharm', 'open', 'Distinguish between potency and efficacy, with one clinical example of each.', 'Potency is the dose required for a given effect; efficacy is the ceiling of effect.', NULL, NULL, NULL, NULL, NULL),
  (11, 'pharm', 'mcq', 'Which organ is the main site of drug metabolism?', 'Hepatic cytochrome P450 enzymes clear most drugs.', 'Kidney', 'Liver', 'Lung', 'Skin', 2),
  (12, 'pharm', 'mcq', 'What is a type A adverse drug reaction?', 'Type A reactions are dose-dependent and predictable from the drug''s pharmacology.', 'Dose-dependent and predictable', 'Idiosyncratic and immune-mediated', 'Carcinogenic after long exposure', 'A withdrawal reaction', 1),
  -- Cycle 3 — cardiovascular drugs
  (13, 'pharm', 'true_false', 'ACE inhibitors can cause hyperkalaemia in patients with renal impairment.', 'Reduced aldosterone secretion lowers potassium excretion.', 'True', 'False', NULL, NULL, 0),
  (14, 'pharm', 'mcq', 'Which oral anticoagulant directly inhibits factor Xa?', 'Apixaban is a direct factor Xa inhibitor and needs no routine INR monitoring.', 'Warfarin', 'Apixaban', 'Clopidogrel', 'Heparin', 2),
  (15, 'pharm', 'mcq', 'What is the mechanism of clopidogrel?', 'Clopidogrel blocks the platelet P2Y12 ADP receptor.', 'Cyclooxygenase inhibition', 'P2Y12 receptor antagonism', 'Glycoprotein IIb/IIIa blockade', 'Vitamin K antagonism', 2),
  (16, 'pharm', 'open', 'Why must a beta-blocker be introduced cautiously in heart failure?', 'Negative inotropy can decompensate a failing ventricle; start low and titrate.', NULL, NULL, NULL, NULL, NULL),
  (17, 'pharm', 'mcq', 'Which agent is used intravenously in hypertensive emergency with pulmonary oedema?', 'Nitroglycerin reduces preload and afterload rapidly and is titratable.', 'Oral ramipril', 'Intravenous nitroglycerin', 'Oral amlodipine', 'Oral bisoprolol', 2),
  (18, 'pharm', 'mcq', 'What is the characteristic adverse effect of amlodipine?', 'Arteriolar vasodilation causes dependent ankle oedema.', 'Ankle oedema', 'Bradycardia', 'Dry cough', 'Hyperkalaemia', 1),
  -- Cycle 4 — antimicrobials
  (19, 'pharm', 'true_false', 'Aminoglycosides are highly effective against anaerobic bacteria.', 'Aminoglycoside uptake is oxygen-dependent, so anaerobes are intrinsically resistant.', 'True', 'False', NULL, NULL, 1),
  (20, 'pharm', 'mcq', 'Which antibiotic inhibits bacterial dihydrofolate reductase?', 'Trimethoprim blocks folate synthesis, often with sulfamethoxazole.', 'Trimethoprim', 'Amoxicillin', 'Azithromycin', 'Vancomycin', 1),
  (21, 'pharm', 'mcq', 'Which antibiotic is reserved for MRSA?', 'Vancomycin binds D-Ala-D-Ala and remains the standard MRSA agent.', 'Vancomycin', 'Penicillin G', 'Doxycycline', 'Nitrofurantoin', 1),
  (22, 'pharm', 'open', 'Explain antibiotic stewardship in two sentences.', 'Right drug, dose and duration; narrow the spectrum when culture allows, to limit resistance.', NULL, NULL, NULL, NULL, NULL),
  (23, 'pharm', 'mcq', 'What is the mechanism of vancomycin?', 'It binds the D-Ala-D-Ala terminus and blocks cell-wall synthesis.', 'Binds D-Ala-D-Ala and blocks cell-wall synthesis', 'Inhibits the 30S ribosome', 'Blocks DNA gyrase', 'Disrupts the cytoplasmic membrane', 1),
  (24, 'pharm', 'mcq', 'Which antibiotic class is associated with tendinopathy?', 'Fluoroquinolones such as ciprofloxacin carry a tendon-rupture warning.', 'Fluoroquinolones', 'Penicillins', 'Aminoglycosides', 'Nitroimidazoles', 1),
  -- Cycle 5 — endocrine and diabetes drugs
  (25, 'pharm', 'true_false', 'Metformin should be paused during acute illness with dehydration.', 'That combination raises the risk of metformin-associated lactic acidosis.', 'True', 'False', NULL, NULL, 0),
  (26, 'pharm', 'mcq', 'Which insulin is rapid-acting?', 'Insulin aspart is a rapid-acting analogue given with meals.', 'Insulin glargine', 'Insulin aspart', 'NPH insulin', 'Insulin detemir', 2),
  (27, 'pharm', 'mcq', 'What is the mechanism of SGLT2 inhibitors?', 'They block renal glucose reabsorption in the proximal tubule.', 'They increase insulin secretion', 'They block renal glucose reabsorption', 'They slow gut glucose absorption', 'They increase insulin sensitivity', 2),
  (28, 'pharm', 'open', 'Describe how you would recognise and treat hypoglycaemia in a conscious patient.', 'Check capillary glucose, give 15–20 g fast-acting carbohydrate, recheck after 15 minutes.', NULL, NULL, NULL, NULL, NULL),
  (29, 'pharm', 'mcq', 'Which drug treats thyrotoxicosis by inhibiting thyroid peroxidase?', 'Carbimazole reduces thyroid hormone synthesis.', 'Levothyroxine', 'Carbimazole', 'Liothyronine', 'Potassium iodide alone', 2),
  (30, 'pharm', 'mcq', 'What is the main risk when starting insulin in a frail elderly patient?', 'Tight control in frailty markedly increases hypoglycaemia risk.', 'Hypoglycaemia', 'Hypernatraemia', 'Hypercalcaemia', 'Metabolic alkalosis', 1),
  -- Cycle 6 — analgesia and emergency drugs
  (31, 'pharm', 'true_false', 'Paracetamol has anti-inflammatory effects comparable to ibuprofen.', 'Paracetamol has minimal peripheral anti-inflammatory activity.', 'True', 'False', NULL, NULL, 1),
  (32, 'pharm', 'mcq', 'Which analgesic can precipitate bronchospasm in aspirin-sensitive asthma?', 'NSAIDs shift arachidonic acid metabolism towards leukotrienes.', 'Aspirin', 'Paracetamol', 'Tramadol', 'Codeine', 1),
  (33, 'pharm', 'mcq', 'What is the first-line treatment for anaphylaxis?', 'Intramuscular adrenaline is given immediately into the anterolateral thigh.', 'Intravenous adrenaline', 'Intramuscular adrenaline', 'Oral antihistamine', 'Inhaled salbutamol', 2),
  (34, 'pharm', 'open', 'Outline the WHO analgesic ladder.', 'Step 1 non-opioid, step 2 weak opioid, step 3 strong opioid, with adjuvants at each step.', NULL, NULL, NULL, NULL, NULL),
  (35, 'pharm', 'mcq', 'Which reversal agent is used for opioid-induced respiratory depression?', 'Naloxone competitively displaces opioids at the receptor.', 'Flumazenil', 'Naloxone', 'Atropine', 'Protamine sulfate', 2),
  (36, 'pharm', 'mcq', 'What is the maximum daily dose of paracetamol for a healthy adult?', 'Above 4 g per day the risk of hepatotoxicity rises steeply.', '2 g', '4 g', '6 g', '8 g', 2),
  -- Cycle 7 — renal physiology
  (37, 'phys', 'true_false', 'The kidney reabsorbs roughly 99% of the filtered sodium.', 'Almost all filtered sodium returns to the blood, mainly in the proximal tubule.', 'True', 'False', NULL, NULL, 0),
  (38, 'phys', 'mcq', 'Which nephron segment is impermeable to water?', 'The thick ascending limb is water-impermeable and dilutes tubular fluid.', 'Proximal tubule', 'Descending limb of the loop of Henle', 'Ascending limb of the loop of Henle', 'Collecting duct', 3),
  (39, 'phys', 'mcq', 'Where is renin produced?', 'Juxtaglomerular cells at the afferent arteriole secrete renin.', 'Juxtaglomerular cells', 'Macula densa', 'Podocytes', 'Mesangial cells', 1),
  (40, 'phys', 'open', 'Explain how the kidney concentrates urine.', 'The loop of Henle builds a medullary gradient; ADH makes the collecting duct water-permeable.', NULL, NULL, NULL, NULL, NULL),
  (41, 'phys', 'mcq', 'What is the main driving force of glomerular filtration?', 'Glomerular capillary hydrostatic pressure exceeds the opposing oncotic pressure.', 'Plasma oncotic pressure', 'Glomerular capillary hydrostatic pressure', 'Tubular secretion', 'Lymphatic flow', 2),
  (42, 'phys', 'mcq', 'Which hormone is released in response to raised plasma osmolarity?', 'Hypothalamic osmoreceptors trigger ADH release from the posterior pituitary.', 'Aldosterone', 'Antidiuretic hormone', 'Atrial natriuretic peptide', 'Renin', 2),
  -- Cycle 8 — acid-base and fluids
  (43, 'phys', 'true_false', 'Metabolic acidosis is compensated by hyperventilation.', 'Lowering pCO2 removes acid and raises pH towards normal.', 'True', 'False', NULL, NULL, 0),
  (44, 'phys', 'mcq', 'What is the normal plasma bicarbonate concentration?', 'Bicarbonate normally sits between 22 and 26 mmol/L.', '12–16 mmol/L', '22–26 mmol/L', '30–34 mmol/L', '36–40 mmol/L', 2),
  (45, 'phys', 'mcq', 'Which situation causes respiratory alkalosis?', 'Hyperventilation at altitude blows off CO2.', 'Opioid overdose', 'Hyperventilation at high altitude', 'Severe COPD', 'Diabetic ketoacidosis', 2),
  (46, 'phys', 'open', 'Interpret this blood gas: pH 7.25, pCO2 30 mmHg, HCO3 13 mmol/L.', 'Metabolic acidosis with respiratory compensation.', NULL, NULL, NULL, NULL, NULL),
  (47, 'phys', 'mcq', 'Which intravenous fluid is isotonic?', '0.9% sodium chloride is isotonic with plasma.', '0.9% sodium chloride', '0.45% sodium chloride', '5% glucose', 'Sterile water', 1),
  (48, 'phys', 'mcq', 'What happens to potassium during acidosis?', 'Hydrogen ions enter cells and potassium leaves to preserve electroneutrality.', 'It shifts into cells', 'It shifts out of cells', 'It is unchanged', 'It is excreted unchanged', 2),
  -- Cycle 9 — cardiac physiology
  (49, 'phys', 'true_false', 'The first heart sound is caused by closure of the atrioventricular valves.', 'Mitral and tricuspid closure marks the start of systole.', 'True', 'False', NULL, NULL, 0),
  (50, 'phys', 'mcq', 'Which vessel carries deoxygenated blood?', 'The pulmonary artery carries deoxygenated blood to the lungs.', 'Aorta', 'Pulmonary artery', 'Pulmonary vein', 'Coronary artery', 2),
  (51, 'phys', 'mcq', 'What does the QRS complex of an ECG represent?', 'The QRS reflects ventricular depolarisation.', 'Atrial depolarisation', 'Ventricular depolarisation', 'Ventricular repolarisation', 'Atrial repolarisation', 2),
  (52, 'phys', 'open', 'Explain the baroreceptor reflex when blood pressure falls.', 'Less stretch reduces vagal tone and raises sympathetic outflow: heart rate, contractility and vasoconstriction all rise.', NULL, NULL, NULL, NULL, NULL),
  (53, 'phys', 'mcq', 'Which valve lies between the left atrium and the left ventricle?', 'The mitral (bicuspid) valve separates left atrium from left ventricle.', 'Tricuspid valve', 'Mitral valve', 'Pulmonary valve', 'Aortic valve', 2),
  (54, 'phys', 'mcq', 'What is a normal left ventricular ejection fraction?', '55–70% is the usual echocardiographic range.', '20–35%', '40–50%', '55–70%', '75–90%', 3),
  -- Cycle 10 — respiratory physiology
  (55, 'phys', 'true_false', 'Alveolar oxygen partial pressure is higher than that of mixed venous blood.', 'Oxygen diffuses down that gradient into capillary blood.', 'True', 'False', NULL, NULL, 0),
  (56, 'phys', 'mcq', 'Which lung volume cannot be measured by spirometry?', 'Residual volume needs gas dilution or plethysmography.', 'Tidal volume', 'Residual volume', 'Inspiratory reserve volume', 'Vital capacity', 2),
  (57, 'phys', 'mcq', 'What is the main stimulus to the respiratory centre?', 'Central chemoreceptors respond to rising arterial CO2.', 'Arterial oxygen', 'Arterial carbon dioxide', 'Arterial pH alone', 'Blood glucose', 2),
  (58, 'phys', 'open', 'Describe oxygen transport from alveolus to tissue.', 'Diffusion into capillary blood, haemoglobin binding, delivery, and dissociation where pO2 is low.', NULL, NULL, NULL, NULL, NULL),
  (59, 'phys', 'mcq', 'Which muscles dominate forced expiration?', 'Abdominal and internal intercostal muscles raise intra-abdominal pressure.', 'Diaphragm and external intercostals', 'Abdominal and internal intercostal muscles', 'Sternocleidomastoid', 'Scalenes', 2),
  (60, 'phys', 'mcq', 'What is a normal resting respiratory rate for an adult?', '12–20 breaths per minute is the accepted resting range.', '4–8 per minute', '12–20 per minute', '22–28 per minute', '30–36 per minute', 2),
  -- Cycle 11 — neurophysiology
  (61, 'phys', 'true_false', 'Neuronal depolarisation is caused mainly by sodium influx.', 'Voltage-gated sodium channels open and sodium enters the axon.', 'True', 'False', NULL, NULL, 0),
  (62, 'phys', 'mcq', 'Which lobe contains the primary motor cortex?', 'The precentral gyrus of the frontal lobe drives voluntary movement.', 'Frontal lobe', 'Parietal lobe', 'Temporal lobe', 'Occipital lobe', 1),
  (63, 'phys', 'mcq', 'Which neurotransmitter is deficient in Parkinson''s disease?', 'Loss of substantia nigra dopaminergic neurons depletes striatal dopamine.', 'Serotonin', 'Dopamine', 'Acetylcholine', 'GABA', 2),
  (64, 'phys', 'open', 'Explain saltatory conduction.', 'Action potentials jump between nodes of Ranvier, greatly increasing conduction velocity in myelinated fibres.', NULL, NULL, NULL, NULL, NULL),
  (65, 'phys', 'mcq', 'What does the cerebellum mainly coordinate?', 'It fine-tunes movement, posture and balance.', 'Hormone release', 'Motor coordination and balance', 'Body temperature', 'Language production', 2),
  (66, 'phys', 'mcq', 'Which cranial nerve controls most eye movements?', 'The oculomotor nerve supplies most extraocular muscles.', 'Optic nerve', 'Oculomotor nerve', 'Facial nerve', 'Vagus nerve', 2),
  -- Cycle 12 — clinical practice
  (67, 'clin', 'true_false', 'A patient with suspected stroke should have blood glucose checked before thrombolysis.', 'Hypoglycaemia mimics stroke and must be excluded first.', 'True', 'False', NULL, NULL, 0),
  (68, 'clin', 'mcq', 'Which findings suggest hypovolaemic shock?', 'Cool peripheries with compensatory tachycardia are typical.', 'Warm peripheries and bradycardia', 'Cool peripheries and tachycardia', 'Hypertension with bradycardia', 'Bounding peripheral pulses', 2),
  (69, 'clin', 'mcq', 'What is the first step for a seizure lasting more than five minutes?', 'A benzodiazepine terminates the seizure; investigation follows.', 'Oral anticonvulsant', 'Intravenous benzodiazepine', 'CT of the head', 'Lumbar puncture', 2),
  (70, 'clin', 'open', 'List three red flags in a patient presenting with acute chest pain.', 'Pain radiating to arm or jaw, diaphoresis, dyspnoea, syncope, pain at rest.', NULL, NULL, NULL, NULL, NULL),
  (71, 'clin', 'mcq', 'Which score estimates the clinical probability of pulmonary embolism?', 'The Wells score stratifies PE probability before imaging.', 'Glasgow score', 'Wells score', 'CURB-65', 'APACHE II', 2),
  (72, 'clin', 'mcq', 'Which electrolyte disturbance produces peaked T waves on the ECG?', 'Hyperkalaemia widens the QRS and peaks the T wave.', 'Hypokalaemia', 'Hyperkalaemia', 'Hypocalcaemia', 'Hyponatraemia', 2);

INSERT INTO public.question_banks (id, organization_id, created_by, name, description, visibility, created_at, updated_at)
VALUES
  ('d0000000-0000-4000-8020-000000000001', 'd0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8001-000000000002', 'Pharmacology Question Bank',
   'Exam-style items across pharmacokinetics, cardiovascular and antimicrobial therapy.',
   'group', now() - interval '47 days', now() - interval '5 days'),
  ('d0000000-0000-4000-8020-000000000002', 'd0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8001-000000000003', 'Physiology Question Bank',
   'Renal, acid-base, cardiac and respiratory physiology, mixed item types.',
   'group', now() - interval '45 days', now() - interval '4 days'),
  ('d0000000-0000-4000-8020-000000000003', 'd0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8001-000000000002', 'Clinical Case Bank',
   'Applied items written with Dr. Weber for the integrated clinical sessions.',
   'group', now() - interval '38 days', now() - interval '2 days');

INSERT INTO public.bank_groups (bank_id, group_id)
VALUES
  ('d0000000-0000-4000-8020-000000000001', 'd0000000-0000-4000-8003-000000000001'),
  ('d0000000-0000-4000-8020-000000000002', 'd0000000-0000-4000-8003-000000000002'),
  ('d0000000-0000-4000-8020-000000000003', 'd0000000-0000-4000-8003-000000000001'),
  ('d0000000-0000-4000-8020-000000000003', 'd0000000-0000-4000-8003-000000000002');

-- bank → question map: 44 slots starting at a different point of the pool, so
-- the three banks overlap but are not identical.
CREATE TEMP TABLE demo_q_map ON COMMIT DROP AS
SELECT
  b.bank_id,
  g.n AS slot,
  ((b.start_ord + g.n - 1) % 72) + 1 AS ord,
  pg_temp.demo_uuid('demo:q:' || b.bank_id::text || ':' || g.n) AS question_id,
  b.author
FROM (VALUES
  ('d0000000-0000-4000-8020-000000000001'::uuid, 1,  'd0000000-0000-4000-8001-000000000002'::uuid),
  ('d0000000-0000-4000-8020-000000000002'::uuid, 15, 'd0000000-0000-4000-8001-000000000003'::uuid),
  ('d0000000-0000-4000-8020-000000000003'::uuid, 29, 'd0000000-0000-4000-8001-000000000002'::uuid)
) AS b(bank_id, start_ord, author)
CROSS JOIN LATERAL generate_series(1, 44) AS g(n);

INSERT INTO public.questions (id, organization_id, created_by, type, content, explanation, visibility, bank_id, created_at)
SELECT
  m.question_id,
  'd0000000-0000-4000-8000-000000000001',
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
  pg_temp.demo_uuid('demo:opt:' || m.question_id::text || ':' || o.i),
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
         WHEN 'pharm' THEN 'd0000000-0000-4000-8004-000000000001'::uuid
         WHEN 'phys'  THEN 'd0000000-0000-4000-8004-000000000002'::uuid
         ELSE 'd0000000-0000-4000-8004-000000000003'::uuid
       END
FROM demo_q_map m
JOIN demo_question_pool p ON p.ord = m.ord;

-- ----------------------------------------------------------
-- 5. Quizzes and assignments
-- ----------------------------------------------------------
INSERT INTO public.quizzes (id, organization_id, created_by, name, description, created_at, updated_at)
VALUES
  ('d0000000-0000-4000-8007-000000000001', 'd0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8001-000000000002', 'Pharmacology Midterm — Block 2',
   'Pharmacokinetics and cardiovascular drugs. Closed book, 10 items.', now() - interval '30 days', now() - interval '12 days'),
  ('d0000000-0000-4000-8007-000000000002', 'd0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8001-000000000002', 'Cardiovascular Pharmacology Quiz',
   'Eight items on anticoagulation and heart-failure therapy.', now() - interval '25 days', now() - interval '11 days'),
  ('d0000000-0000-4000-8007-000000000003', 'd0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8001-000000000003', 'Renal & Acid-Base Quiz',
   'Eight items covering filtration, tubular transport and blood gases.', now() - interval '22 days', now() - interval '9 days'),
  ('d0000000-0000-4000-8007-000000000004', 'd0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8001-000000000003', 'Integrated Physiology Final',
   'Ten applied items from the physiology and clinical banks.', now() - interval '18 days', now() - interval '8 days');

INSERT INTO public.quiz_questions (quiz_id, question_id, order_index, points)
SELECT
  q.quiz_id,
  m.question_id,
  s.k - 1,
  1
FROM (VALUES
  ('d0000000-0000-4000-8007-000000000001'::uuid, 'd0000000-0000-4000-8020-000000000001'::uuid, 1,  10),
  ('d0000000-0000-4000-8007-000000000002'::uuid, 'd0000000-0000-4000-8020-000000000001'::uuid, 12, 8),
  ('d0000000-0000-4000-8007-000000000003'::uuid, 'd0000000-0000-4000-8020-000000000002'::uuid, 20, 8),
  ('d0000000-0000-4000-8007-000000000004'::uuid, 'd0000000-0000-4000-8020-000000000003'::uuid, 30, 10)
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
  ('d0000000-0000-4000-8008-000000000001', 'd0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8001-000000000002', 'd0000000-0000-4000-8007-000000000001',
   'Pharmacology Midterm — Block 2',
   'Covers weeks 1–6. Results are released after the review seminar.',
   'published', now() + interval '5 days', now() - interval '3 days', 30, true, true,
   false, 2, 60, 10, 10, now() - interval '12 days', now() - interval '3 days'),
  ('d0000000-0000-4000-8008-000000000002', 'd0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8001-000000000002', 'd0000000-0000-4000-8007-000000000002',
   'Cardiovascular Pharmacology Quiz',
   'Short formative quiz after the anticoagulation seminar.',
   'published', now() + interval '12 days', now() - interval '1 day', 15, true, true,
   true, 3, 50, 8, 8, now() - interval '11 days', now() - interval '1 day'),
  ('d0000000-0000-4000-8008-000000000003', 'd0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8001-000000000003', 'd0000000-0000-4000-8007-000000000003',
   'Renal & Acid-Base Quiz',
   'Closed book quiz on renal transport and blood-gas interpretation.',
   'published', now() - interval '2 days', now() - interval '9 days', 20, true, true,
   true, 1, 50, 8, 8, now() - interval '9 days', now() - interval '9 days');

INSERT INTO public.assignment_questions (id, assignment_id, question_id, order_index, points)
SELECT
  pg_temp.demo_uuid('demo:aq:' || qq.quiz_id::text || ':' || qq.question_id::text),
  a.assignment_id,
  qq.question_id,
  qq.order_index,
  1
FROM public.quiz_questions qq
JOIN (VALUES
  ('d0000000-0000-4000-8008-000000000001'::uuid, 'd0000000-0000-4000-8007-000000000001'::uuid),
  ('d0000000-0000-4000-8008-000000000002'::uuid, 'd0000000-0000-4000-8007-000000000002'::uuid),
  ('d0000000-0000-4000-8008-000000000003'::uuid, 'd0000000-0000-4000-8007-000000000003'::uuid)
) AS a(assignment_id, quiz_id) ON a.quiz_id = qq.quiz_id;

INSERT INTO public.assignment_targets (id, assignment_id, group_id, assigned_at)
VALUES
  (pg_temp.demo_uuid('demo:target:1'), 'd0000000-0000-4000-8008-000000000001', 'd0000000-0000-4000-8003-000000000001', now() - interval '12 days'),
  (pg_temp.demo_uuid('demo:target:2'), 'd0000000-0000-4000-8008-000000000002', 'd0000000-0000-4000-8003-000000000001', now() - interval '11 days'),
  (pg_temp.demo_uuid('demo:target:3'), 'd0000000-0000-4000-8008-000000000003', 'd0000000-0000-4000-8003-000000000002', now() - interval '9 days');

-- ----------------------------------------------------------
-- 6. Seats — 11 of 24 seats in use across three pools.
--    `org_seat_pools.assigned` is maintained by the
--    `maintain_seat_counts` trigger, so pools start at 0.
-- ----------------------------------------------------------
INSERT INTO public.org_seat_pools (id, organization_id, plan_key, total, assigned, created_at)
VALUES
  ('d0000000-0000-4000-8009-000000000001', 'd0000000-0000-4000-8000-000000000001', 'campus', 2,  0, now() - interval '56 days'),
  ('d0000000-0000-4000-8009-000000000002', 'd0000000-0000-4000-8000-000000000001', 'master', 2,  0, now() - interval '54 days'),
  ('d0000000-0000-4000-8009-000000000003', 'd0000000-0000-4000-8000-000000000001', 'ace',    20, 0, now() - interval '54 days');

INSERT INTO public.org_seat_assignments (id, organization_id, pool_id, user_id, assigned_at)
SELECT
  pg_temp.demo_uuid('demo:seat:' || s.user_id::text),
  'd0000000-0000-4000-8000-000000000001',
  s.pool_id,
  s.user_id,
  now() - (s.days_ago || ' days')::interval
FROM (VALUES
  ('d0000000-0000-4000-8009-000000000001'::uuid, 'd0000000-0000-4000-8001-000000000001'::uuid, 56),
  ('d0000000-0000-4000-8009-000000000002'::uuid, 'd0000000-0000-4000-8001-000000000002'::uuid, 54),
  ('d0000000-0000-4000-8009-000000000002'::uuid, 'd0000000-0000-4000-8001-000000000003'::uuid, 52),
  ('d0000000-0000-4000-8009-000000000003'::uuid, 'd0000000-0000-4000-8001-000000000004'::uuid, 45),
  ('d0000000-0000-4000-8009-000000000003'::uuid, 'd0000000-0000-4000-8001-000000000005'::uuid, 44),
  ('d0000000-0000-4000-8009-000000000003'::uuid, 'd0000000-0000-4000-8001-000000000006'::uuid, 43),
  ('d0000000-0000-4000-8009-000000000003'::uuid, 'd0000000-0000-4000-8001-000000000007'::uuid, 41),
  ('d0000000-0000-4000-8009-000000000003'::uuid, 'd0000000-0000-4000-8001-000000000008'::uuid, 38),
  ('d0000000-0000-4000-8009-000000000003'::uuid, 'd0000000-0000-4000-8001-000000000009'::uuid, 33),
  ('d0000000-0000-4000-8009-000000000003'::uuid, 'd0000000-0000-4000-8001-00000000000A'::uuid, 26),
  ('d0000000-0000-4000-8009-000000000003'::uuid, 'd0000000-0000-4000-8001-00000000000B'::uuid, 19)
) AS s(pool_id, user_id, days_ago);

-- ----------------------------------------------------------
-- 7. Alice's study history — eight weeks of reviews
--
-- 120 cards, each reviewed on a spaced schedule (same day, +1, +3, +7, +14,
-- +28, +45 days), so the activity chart, the streak, the retention curve and
-- the review-state table all have a real shape. Day positions are relative to
-- `now()`, so the screenshots stay current whenever the seed is applied.
-- ----------------------------------------------------------
INSERT INTO public.user_study_settings (user_id, new_cards_per_day, daily_review_goal, new_cards_introduced, daily_reset_date)
SELECT u.id, 20, 40, 0, CURRENT_DATE
FROM auth.users u
WHERE u.id::text LIKE 'd0000000-0000-4000-8001-%'
  AND u.raw_app_meta_data->>'account_type' = 'student'
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.flashcard_practice (
  id, user_id, flashcard_id, was_correct, practiced_at,
  response_time_ms, confidence_level, session_id, organization_id
)
WITH cards AS (
  SELECT id, row_number() OVER (ORDER BY id) AS n
  FROM public.flashcards
  WHERE organization_id = 'd0000000-0000-4000-8000-000000000001'
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
  pg_temp.demo_uuid('demo:practice:' || s.flashcard_id::text || ':' || s.off || ':' || s.extra || ':' || s.n),
  'd0000000-0000-4000-8001-000000000004',
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
  pg_temp.demo_uuid('demo:session:' || s.day_ago),
  'd0000000-0000-4000-8000-000000000001'
FROM schedule s
WHERE s.day_ago >= 1;

-- One session per study day, aggregated from the reviews of that day.
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
    'd0000000-0000-4000-8006-000000000001'::uuid,
    'd0000000-0000-4000-8006-000000000002'::uuid,
    'd0000000-0000-4000-8006-000000000004'::uuid
  ],
  'review'
FROM public.flashcard_practice p
WHERE p.user_id = 'd0000000-0000-4000-8001-000000000004'
GROUP BY p.session_id, p.user_id;

-- SM-2 state per reviewed card: mostly graduated reviews, with a few cards
-- still learning and a single suspended leech, so the state column is not one
-- repeated value.
INSERT INTO public.flashcard_review_state (
  user_id, flashcard_id, easiness_factor, interval_days, interval_unit, repetitions,
  next_review_at, last_reviewed_at, last_quality, learning_state, learning_step,
  sm2_lapse_count, is_leech
)
SELECT
  'd0000000-0000-4000-8001-000000000004',
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
       WHERE organization_id = 'd0000000-0000-4000-8000-000000000001'
       ORDER BY id LIMIT 120
     ) c WHERE c.id = p.flashcard_id) AS n,
    2.15 + random() * 0.6 AS ef,
    count(*) AS reps,
    max(p.practiced_at) AS last_reviewed_at,
    (100.0 * count(*) FILTER (WHERE p.was_correct) / count(*)) AS correct_rate
  FROM public.flashcard_practice p
  WHERE p.user_id = 'd0000000-0000-4000-8001-000000000004'
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

-- Alice: 16 attempts, every third day, climbing from 56% to 97%.
INSERT INTO demo_attempt_plan (user_id, day_ago, pct, bank_id)
SELECT 'd0000000-0000-4000-8001-000000000004',
       51 - (g * 3),
       LEAST(97, 56 + (g * 2.6)::int + (g % 3)),
       CASE WHEN g % 2 = 0
            THEN 'd0000000-0000-4000-8020-000000000001'::uuid
            ELSE 'd0000000-0000-4000-8020-000000000002'::uuid END
FROM generate_series(1, 16) AS g;

-- The other seven students: two attempts each, lighter and more scattered.
INSERT INTO demo_attempt_plan (user_id, day_ago, pct, bank_id)
SELECT
  s.id,
  6 + ((s.k * 7 + j * 11) % 43),
  58 + ((s.k * 5 + j * 9) % 32),
  CASE WHEN (s.k + j) % 2 = 0
       THEN 'd0000000-0000-4000-8020-000000000001'::uuid
       ELSE 'd0000000-0000-4000-8020-000000000002'::uuid END
FROM (VALUES
  ('d0000000-0000-4000-8001-000000000005'::uuid, 1),
  ('d0000000-0000-4000-8001-000000000006'::uuid, 2),
  ('d0000000-0000-4000-8001-000000000007'::uuid, 3),
  ('d0000000-0000-4000-8001-000000000008'::uuid, 4),
  ('d0000000-0000-4000-8001-000000000009'::uuid, 5),
  ('d0000000-0000-4000-8001-00000000000A'::uuid, 6),
  ('d0000000-0000-4000-8001-00000000000B'::uuid, 7)
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
    v_attempt := pg_temp.demo_uuid('demo:attempt:' || r.n || ':' || r.user_id::text);
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
      'd0000000-0000-4000-8000-000000000001'
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
        pg_temp.demo_uuid('demo:answer:' || v_attempt::text || ':' || v_qid::text),
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
  ('d0000000-0000-4000-8008-000000000001', 'd0000000-0000-4000-8001-000000000004', 9,  9),
  ('d0000000-0000-4000-8008-000000000001', 'd0000000-0000-4000-8001-000000000005', 8,  7),
  ('d0000000-0000-4000-8008-000000000001', 'd0000000-0000-4000-8001-000000000006', 8,  8),
  ('d0000000-0000-4000-8008-000000000001', 'd0000000-0000-4000-8001-000000000007', 7,  6),
  ('d0000000-0000-4000-8008-000000000002', 'd0000000-0000-4000-8001-000000000004', 4,  7),
  ('d0000000-0000-4000-8008-000000000002', 'd0000000-0000-4000-8001-000000000008', 3,  6),
  ('d0000000-0000-4000-8008-000000000003', 'd0000000-0000-4000-8001-000000000004', 3,  6),
  ('d0000000-0000-4000-8008-000000000003', 'd0000000-0000-4000-8001-000000000009', 2,  5),
  ('d0000000-0000-4000-8008-000000000003', 'd0000000-0000-4000-8001-00000000000A', 2,  7);

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
    v_attempt := pg_temp.demo_uuid('demo:assignment:' || r.n || ':' || r.user_id::text);
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
      'd0000000-0000-4000-8000-000000000001'
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
        pg_temp.demo_uuid('demo:asg-answer:' || v_attempt::text || ':' || v_qid::text),
        v_attempt, v_qid, v_type, v_opt,
        v_idx <= r.points,
        CASE WHEN v_idx <= r.points THEN 1 ELSE 0 END,
        v_started + (v_idx || ' minutes')::interval
      );
    END LOOP;
  END LOOP;
END $$;

-- ----------------------------------------------------------
-- 10. One quiz in progress for Alice
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
  'd0000000-0000-4000-800b-000000000001',
  'd0000000-0000-4000-8001-000000000004',
  0, 8, 8,
  jsonb_build_object('questionCount', 8, 'topicIds', jsonb_build_array('d0000000-0000-4000-8004-000000000001')),
  '{}'::jsonb,
  now() - interval '9 minutes',
  NULL,
  'd0000000-0000-4000-8000-000000000001'
);

INSERT INTO public.quiz_attempt_questions (attempt_id, question_id, order_index)
SELECT 'd0000000-0000-4000-800b-000000000001', m.question_id, row_number() OVER (ORDER BY m.slot) - 1
FROM demo_q_map m
JOIN public.questions q ON q.id = m.question_id AND q.type <> 'open'
WHERE m.bank_id = 'd0000000-0000-4000-8020-000000000001'
  AND m.slot BETWEEN 5 AND 13;

COMMIT;
