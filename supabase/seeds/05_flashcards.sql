-- ==========================================================
-- Seeds: flashcards (05)
-- Depends on: 01_users.sql
-- ==========================================================

INSERT INTO "public"."flashcards" ("id", "created_by", "front", "back", "created_at") VALUES
  ('00000000-0000-0000-0006-000000000001', '00000000-0000-0000-0001-000000000003', 'Co to jest closure?', 'Funkcja, która ma dostęp do zmiennych z zakresu, w którym została utworzona.', now()),
  ('00000000-0000-0000-0006-000000000002', '00000000-0000-0000-0001-000000000003', 'Różnica między let a var?', 'let ma zakres blokowy, var ma zakres funkcyjny.', now()),
  ('00000000-0000-0000-0006-000000000003', '00000000-0000-0000-0001-000000000003', 'Co to jest indeks w bazie danych?', 'Struktura przyspieszająca wyszukiwanie wierszy w tabeli.', now()),
  ('00000000-0000-0000-0006-000000000004', '00000000-0000-0000-0001-000000000003', 'Co to jest macierz?', 'Prostokątna tablica liczb zorganizowana w wiersze i kolumny.', now())
ON CONFLICT DO NOTHING;
