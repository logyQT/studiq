-- ==========================================================
-- Seeds: questions (03)
-- Depends on: 02_subjects.sql
-- ==========================================================

INSERT INTO "public"."questions" ("id", "subject_id", "created_by", "type", "content", "explanation", "difficulty", "created_at", "updated_at") VALUES
  ('00000000-0000-0000-0004-000000000001', '00000000-0000-0000-0003-000000000001', '00000000-0000-0000-0001-000000000003', 'mcq', 'Jaki jest wynik typeof null w JavaScript?', 'To znany bug w JavaScript — null jest typu object przez historyczny błąd.', 'easy', now(), now()),
  ('00000000-0000-0000-0004-000000000002', '00000000-0000-0000-0003-000000000001', '00000000-0000-0000-0001-000000000003', 'mcq', 'Która metoda tablicy tworzy nową tablicę?', 'map() tworzy nową tablicę, forEach() modyfikuje w-place.', 'medium', now(), now()),
  ('00000000-0000-0000-0004-000000000003', '00000000-0000-0000-0003-000000000001', '00000000-0000-0000-0001-000000000003', 'true_false', 'JavaScript jest językiem typowanym statycznie.', 'JavaScript jest językiem typowanym dynamicznie.', 'easy', now(), now()),
  ('00000000-0000-0000-0004-000000000004', '00000000-0000-0000-0003-000000000002', '00000000-0000-0000-0001-000000000003', 'mcq', 'Co robi klauzula GROUP BY w SQL?', 'GROUP BY grupuje wiersze o tych samych wartościach w kolumnach.', 'medium', now(), now()),
  ('00000000-0000-0000-0004-000000000005', '00000000-0000-0000-0003-000000000002', '00000000-0000-0000-0001-000000000003', 'mcq', 'Jaki typ JOIN zwraca wszystkie wiersze z lewej tabeli?', 'LEFT JOIN zwraca wszystkie wiersze z lewej tabeli + dopasowane z prawej.', 'easy', now(), now()),
  ('00000000-0000-0000-0004-000000000006', '00000000-0000-0000-0003-000000000003', '00000000-0000-0000-0001-000000000006', 'mcq', 'Jaka jest pochodna funkcji f(x) = x²?', 'Z reguły potęgowej: d/dx(x^n) = n*x^(n-1), więc d/dx(x²) = 2x.', 'medium', now(), now()),
  ('00000000-0000-0000-0004-000000000007', '00000000-0000-0000-0003-000000000003', '00000000-0000-0000-0001-000000000006', 'true_false', 'Macierz jednostkowa ma same jedynki na przekątnej.', 'Macierz jednostkowa ma 1 na przekątnej i 0 poza nią.', 'easy', now(), now())
ON CONFLICT DO NOTHING;
