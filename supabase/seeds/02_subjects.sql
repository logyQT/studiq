-- ==========================================================
-- Seeds: subjects (02)
-- Depends on: 01_users.sql
-- ==========================================================

INSERT INTO "public"."subjects" ("id", "organization_id", "name", "description", "created_by", "created_at") VALUES
  ('00000000-0000-4000-8003-000000000001', '00000000-0000-4000-8000-000000000001', 'Programowanie', 'Podstawy programowania w JavaScript', '00000000-0000-4000-8001-000000000003', now()),
  ('00000000-0000-4000-8003-000000000002', '00000000-0000-4000-8000-000000000001', 'Bazy Danych', 'SQL i projektowanie baz danych', '00000000-0000-4000-8001-000000000003', now()),
  ('00000000-0000-4000-8003-000000000003', NULL, 'Matematyka', 'Analiza i algebra liniowa', '00000000-0000-4000-8001-000000000006', now()),

  -- Politechnika Warszawska
  ('00000000-0000-4000-8003-000000000004', '00000000-0000-4000-8000-000000000002', 'Inżynieria Oprogramowania', 'Metodyki i narzędzia wytwarzania oprogramowania', '00000000-0000-4000-8001-000000000008', now()),
  ('00000000-0000-4000-8003-000000000005', '00000000-0000-4000-8000-000000000002', 'Sieci Komputerowe', 'Protokoły i architektura sieci', '00000000-0000-4000-8001-000000000008', now()),

  -- Uniwersytet Jagielloński
  ('00000000-0000-4000-8003-000000000006', '00000000-0000-4000-8000-000000000003', 'Genetyka', 'Dziedziczenie i ekspresja genów', '00000000-0000-4000-8001-000000000011', now()),
  ('00000000-0000-4000-8003-000000000007', '00000000-0000-4000-8000-000000000003', 'Biochemia', 'Struktura i funkcja biomolekuł', '00000000-0000-4000-8001-000000000011', now()),

  -- Politechnika Gdańska
  ('00000000-0000-4000-8003-000000000008', '00000000-0000-4000-8000-000000000004', 'Automatyka', 'Teoria sterowania i układy automatyki', '00000000-0000-4000-8001-000000000015', now()),
  ('00000000-0000-4000-8003-000000000009', '00000000-0000-4000-8000-000000000004', 'Mikroelektronika', 'Układy scalone i półprzewodniki', '00000000-0000-4000-8001-000000000015', now()),

  -- Uniwersytet Wrocławski
  ('00000000-0000-4000-8003-000000000010', '00000000-0000-4000-8000-000000000005', 'Filozofia Nowożytna', 'Myśl filozoficzna XVII–XIX wieku', '00000000-0000-4000-8001-000000000019', now()),
  ('00000000-0000-4000-8003-000000000011', '00000000-0000-4000-8000-000000000005', 'Logika', 'Rachunek zdań i predykatów', '00000000-0000-4000-8001-000000000019', now()),

  -- Akademia Górniczo-Hutnicza
  ('00000000-0000-4000-8003-000000000012', '00000000-0000-4000-8000-000000000006', 'Fizyka Techniczna', 'Zastosowania fizyki w inżynierii', '00000000-0000-4000-8001-000000000022', now()),
  ('00000000-0000-4000-8003-000000000013', '00000000-0000-4000-8000-000000000006', 'Wytrzymałość Materiałów', 'Analiza naprężeń i odkształceń', '00000000-0000-4000-8001-000000000022', now())
ON CONFLICT DO NOTHING;
