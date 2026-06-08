-- ==========================================================
-- Seeds: flashcards (05)
-- Depends on: 01_users.sql
-- ~50 flashcards owned by student@dev.local (user 00000000-0000-4000-8001-000000000004)
-- ==========================================================

INSERT INTO "public"."flashcards" ("id", "university_id", "created_by", "front", "back", "created_at") VALUES
  -- Deck 1: JavaScript Basics (10 cards)
  ('00000000-0000-4000-8006-000000000001', NULL, '00000000-0000-4000-8001-000000000004', 'Co to jest closure?', 'Funkcja, która ma dostęp do zmiennych z zakresu, w którym została utworzona.', now()),
  ('00000000-0000-4000-8006-000000000002', NULL, '00000000-0000-4000-8001-000000000004', 'Różnica między let a var?', 'let ma zakres blokowy, var ma zakres funkcyjny.', now()),
  ('00000000-0000-4000-8006-000000000003', NULL, '00000000-0000-4000-8001-000000000004', 'Co to jest hoisting?', 'Mechanizm przenoszenia deklaracji zmiennych i funkcji na górę zakresu.', now()),
  ('00000000-0000-4000-8006-000000000004', NULL, '00000000-0000-4000-8001-000000000004', 'Co to jest Promise?', 'Obiekt reprezentujący wynik operacji asynchronicznej.', now()),
  ('00000000-0000-4000-8006-000000000005', NULL, '00000000-0000-4000-8001-000000000004', 'Co robi metoda map()?', 'Tworzy nową tablicę z wynikami wywołania funkcji dla każdego elementu.', now()),
  ('00000000-0000-4000-8006-000000000006', NULL, '00000000-0000-4000-8001-000000000004', 'Co to jest event loop?', 'Mechanizm obsługujący zdarzenia i operacje asynchroniczne w JS.', now()),
  ('00000000-0000-4000-8006-000000000007', NULL, '00000000-0000-4000-8001-000000000004', 'Różnica między == a ===?', '== porównuje z konwersją typów, === porównuje bez konwersji.', now()),
  ('00000000-0000-4000-8006-000000000008', NULL, '00000000-0000-4000-8001-000000000004', 'Co to jest async/await?', 'Składnia do pracy z Promise w stylu synchronicznym.', now()),
  ('00000000-0000-4000-8006-000000000009', NULL, '00000000-0000-4000-8001-000000000004', 'Co to jest destructuring?', 'Rozpakowywanie wartości z tablic lub obiektów do zmiennych.', now()),
  ('00000000-0000-4000-8006-000000000010', NULL, '00000000-0000-4000-8001-000000000004', 'Co to jest spread operator?', 'Operator (...) rozszerza iterable w miejscu.', now()),

  -- Deck 2: Python Fundamentals (10 cards)
  ('00000000-0000-4000-8006-000000000011', NULL, '00000000-0000-4000-8001-000000000004', 'Co to jest list comprehension?', 'Zwięzły sposób tworzenia list w Pythonie: [x for x in iterable].', now()),
  ('00000000-0000-4000-8006-000000000012', NULL, '00000000-0000-4000-8001-000000000004', 'Różnica między list a tuple?', 'List jest mutowalny, tuple jest niemutowalny.', now()),
  ('00000000-0000-4000-8006-000000000013', NULL, '00000000-0000-4000-8001-000000000004', 'Co to jest decorator?', 'Funkcja modyfikująca zachowanie innej funkcji.', now()),
  ('00000000-0000-4000-8006-000000000014', NULL, '00000000-0000-4000-8001-000000000004', 'Co robi pass?', 'Pusta instrukcja — placeholder, który nic nie robi.', now()),
  ('00000000-0000-4000-8006-000000000015', NULL, '00000000-0000-4000-8001-000000000004', 'Co to jest GIL?', 'Global Interpreter Lock — blokada wątków w CPython.', now()),
  ('00000000-0000-4000-8006-000000000016', NULL, '00000000-0000-4000-8001-000000000004', 'Co to jest __init__?', 'Metoda konstruktora klasy w Pythonie.', now()),
  ('00000000-0000-4000-8006-000000000017', NULL, '00000000-0000-4000-8001-000000000004', 'Co to jest generator?', 'Funkcja używająca yield do zwracania wartości sekwencyjnie.', now()),
  ('00000000-0000-4000-8006-000000000018', NULL, '00000000-0000-4000-8001-000000000004', 'Różnica między is a ==?', 'is porównuje tożsamość obiektów, == porównuje wartości.', now()),
  ('00000000-0000-4000-8006-000000000019', NULL, '00000000-0000-4000-8001-000000000004', 'Co to jest virtualenv?', 'Izolowane środowisko Pythona z własnymi zależnościami.', now()),
  ('00000000-0000-4000-8006-000000000020', NULL, '00000000-0000-4000-8001-000000000004', 'Co to jest pip?', 'Menadżer pakietów Pythona do instalacji bibliotek.', now()),

  -- Deck 3: SQL & Databases (10 cards)
  ('00000000-0000-4000-8006-000000000021', NULL, '00000000-0000-4000-8001-000000000004', 'Co to jest indeks w bazie danych?', 'Struktura przyspieszająca wyszukiwanie wierszy w tabeli.', now()),
  ('00000000-0000-4000-8006-000000000022', NULL, '00000000-0000-4000-8001-000000000004', 'Różnica między INNER JOIN a LEFT JOIN?', 'INNER zwraca tylko pasujące wiersze, LEFT zwraca wszystkie z lewej tabeli.', now()),
  ('00000000-0000-4000-8006-000000000023', NULL, '00000000-0000-4000-8001-000000000004', 'Co to jest transakcja?', 'Grupa operacji wykonywana atomowo — wszystko albo nic.', now()),
  ('00000000-0000-4000-8006-000000000024', NULL, '00000000-0000-4000-8001-000000000004', 'Co to jest normalizacja?', 'Proces organizowania danych w celu redukcji redundancji.', now()),
  ('00000000-0000-4000-8006-000000000025', NULL, '00000000-0000-4000-8001-000000000004', 'Co to jest klucz obcy?', 'Kolumna odwołująca się do klucza głównego innej tabeli.', now()),
  ('00000000-0000-4000-8006-000000000026', NULL, '00000000-0000-4000-8001-000000000004', 'Co to jest ACID?', 'Atomicity, Consistency, Isolation, Durability — właściwości transakcji.', now()),
  ('00000000-0000-4000-8006-000000000027', NULL, '00000000-0000-4000-8001-000000000004', 'Co to jest SQL injection?', 'Atak polegający na wstrzyknięciu złośliwego kodu SQL.', now()),
  ('00000000-0000-4000-8006-000000000028', NULL, '00000000-0000-4000-8001-000000000004', 'Co robi GROUP BY?', 'Grupuje wiersze o tych samych wartościach w kolumnach.', now()),
  ('00000000-0000-4000-8006-000000000029', NULL, '00000000-0000-4000-8001-000000000004', 'Co to jest widok (VIEW)?', 'Wirtualna tabela oparta na wyniku zapytania SQL.', now()),
  ('00000000-0000-4000-8006-000000000030', NULL, '00000000-0000-4000-8001-000000000004', 'Różnica między DELETE a TRUNCATE?', 'DELETE usuwa wiersze pojedynczo, TRUNCATE resetuje całą tabelę.', now()),

  -- Deck 4: Mathematics (10 cards)
  ('00000000-0000-4000-8006-000000000031', NULL, '00000000-0000-4000-8001-000000000004', 'Co to jest macierz?', 'Prostokątna tablica liczb zorganizowana w wiersze i kolumny.', now()),
  ('00000000-0000-4000-8006-000000000032', NULL, '00000000-0000-4000-8001-000000000004', 'Co to jest pochodna?', 'Miara szybkości zmiany funkcji w danym punkcie.', now()),
  ('00000000-0000-4000-8006-000000000033', NULL, '00000000-0000-4000-8001-000000000004', 'Co to jest całka oznaczona?', 'Pole powierzchni pod wykresem funkcji w danym przedziale.', now()),
  ('00000000-0000-4000-8006-000000000034', NULL, '00000000-0000-4000-8001-000000000004', 'Co to jest wektor?', 'Obiekt mający kierunek i wartość (długość).', now()),
  ('00000000-0000-4000-8006-000000000035', NULL, '00000000-0000-4000-8001-000000000004', 'Co to jest iloczyn skalarny?', 'Operacja zwracająca liczbę z dwóch wektorów: a·b = |a||b|cos(θ).', now()),
  ('00000000-0000-4000-8006-000000000036', NULL, '00000000-0000-4000-8001-000000000004', 'Co to jest szereg geometryczny?', 'Suma wyrazów ciągu geometrycznego: a + ar + ar² + ...', now()),
  ('00000000-0000-4000-8006-000000000037', NULL, '00000000-0000-4000-8001-000000000004', 'Co to jest prawdopodobieństwo warunkowe?', 'P(A|B) = P(A∩B) / P(B) — prawdopodobieństwo A przy założeniu B.', now()),
  ('00000000-0000-4000-8006-000000000038', NULL, '00000000-0000-4000-8001-000000000004', 'Co to jest rozkład normalny?', 'Rozkład Gaussa — symetryczny, dzwonowy kształt.', now()),
  ('00000000-0000-4000-8006-000000000039', NULL, '00000000-0000-4000-8001-000000000004', 'Co to jest wyznacznik macierzy?', 'Skalar określający, czy macierz jest odwracalna.', now()),
  ('00000000-0000-4000-8006-000000000040', NULL, '00000000-0000-4000-8001-000000000004', 'Co to jest granica ciągu?', 'Wartość, do której dąży ciąg przy n→∞.', now()),

  -- Deck 5: Computer Science (12 cards)
  ('00000000-0000-4000-8006-000000000041', NULL, '00000000-0000-4000-8001-000000000004', 'Co to jest złożoność O(n)?', 'Liniowa złożoność czasowa — czas rośnie proporcjonalnie do danych.', now()),
  ('00000000-0000-4000-8006-000000000042', NULL, '00000000-0000-4000-8001-000000000004', 'Co to jest drzewo binarne?', 'Struktura danych, gdzie każdy węzeł ma max 2 dzieci.', now()),
  ('00000000-0000-4000-8006-000000000043', NULL, '00000000-0000-4000-8001-000000000004', 'Co to jest stos (stack)?', 'Struktura LIFO — ostatni wchodzi, pierwszy wychodzi.', now()),
  ('00000000-0000-4000-8006-000000000044', NULL, '00000000-0000-4000-8001-000000000004', 'Co to jest kolejka (queue)?', 'Struktura FIFO — pierwszy wchodzi, pierwszy wychodzi.', now()),
  ('00000000-0000-4000-8006-000000000045', NULL, '00000000-0000-4000-8001-000000000004', 'Co to jest hash table?', 'Struktura mapująca klucze na wartości za pomocą funkcji skrótu.', now()),
  ('00000000-0000-4000-8006-000000000046', NULL, '00000000-0000-4000-8001-000000000004', 'Co to jest algorytm Dijkstry?', 'Algorytm znajdowania najkrótszej ścieżki w grafie.', now()),
  ('00000000-0000-4000-8006-000000000047', NULL, '00000000-0000-4000-8001-000000000004', 'Co to jest sortowanie szybkie?', 'Quicksort — dzielenie i zwyciężanie, średnia O(n log n).', now()),
  ('00000000-0000-4000-8006-000000000048', NULL, '00000000-0000-4000-8001-000000000004', 'Co to jest rekurencja?', 'Funkcja wywołująca samą siebie.', now()),
  ('00000000-0000-4000-8006-000000000049', NULL, '00000000-0000-4000-8001-000000000004', 'Co to jest wzorzec MVC?', 'Model-View-Controller — separacja danych, widoku i logiki.', now()),
  ('00000000-0000-4000-8006-000000000050', NULL, '00000000-0000-4000-8001-000000000004', 'Co to jest REST API?', 'Architektura API oparta na metodach HTTP i zasobach.', now()),
  ('00000000-0000-4000-8006-000000000051', NULL, '00000000-0000-4000-8001-000000000004', 'Co to jest Docker?', 'Platforma konteneryzacji do izolacji aplikacji.', now()),
  ('00000000-0000-4000-8006-000000000052', NULL, '00000000-0000-4000-8001-000000000004', 'Co to jest Git?', 'System kontroli wersji do śledzenia zmian w kodzie.', now())
ON CONFLICT DO NOTHING;
