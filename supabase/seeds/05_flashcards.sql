-- ==========================================================
-- Seeds: flashcards (05)
-- Depends on: 01_users.sql
-- ==========================================================

INSERT INTO "public"."flashcards" ("id", "university_id", "created_by", "front", "back", "created_at") VALUES
  ('00000000-0000-4000-8006-000000000001', NULL, '00000000-0000-4000-8001-000000000003', 'Co to jest closure?', 'Funkcja, która ma dostęp do zmiennych z zakresu, w którym została utworzona.', now()),
  ('00000000-0000-4000-8006-000000000002', NULL, '00000000-0000-4000-8001-000000000003', 'Różnica między let a var?', 'let ma zakres blokowy, var ma zakres funkcyjny.', now()),
  ('00000000-0000-4000-8006-000000000003', NULL, '00000000-0000-4000-8001-000000000003', 'Co to jest indeks w bazie danych?', 'Struktura przyspieszająca wyszukiwanie wierszy w tabeli.', now()),
  ('00000000-0000-4000-8006-000000000004', NULL, '00000000-0000-4000-8001-000000000003', 'Co to jest macierz?', 'Prostokątna tablica liczb zorganizowana w wiersze i kolumny.', now()),

  -- Politechnika Warszawska
  ('00000000-0000-4000-8006-000000000005', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8001-000000000008', 'Co to jest wzorzec MVC?', 'Model-View-Controller — separacja danych, widoku i logiki aplikacji.', now()),
  ('00000000-0000-4000-8006-000000000006', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8001-000000000008', 'Jaka jest różnica między TCP a UDP?', 'TCP jest połączeniowy i niezawodny, UDP jest bezpołączeniowy i szybszy.', now()),
  ('00000000-0000-4000-8006-000000000007', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8001-000000000008', 'Do czego służy protokół ARP?', 'ARP (Address Resolution Protocol) mapuje adres IP na adres MAC.', now()),
  ('00000000-0000-4000-8006-000000000008', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8001-000000000008', 'Co to jest refaktoryzacja kodu?', 'Zmiana struktury kodu bez zmiany jego zachowania zewnętrznego.', now()),

  -- Uniwersytet Jagielloński
  ('00000000-0000-4000-8006-000000000009', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8001-000000000011', 'Co to jest replikacja DNA?', 'Proces kopiowania cząsteczki DNA przed podziałem komórki.', now()),
  ('00000000-0000-4000-8006-000000000010', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8001-000000000011', 'Jaka jest funkcja rybosomów?', 'Rybosomy syntetyzują białka na podstawie mRNA.', now()),
  ('00000000-0000-4000-8006-000000000011', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8001-000000000011', 'Co to jest fotosynteza?', 'Proces przekształcania energii świetlnej w energię chemiczną.', now()),
  ('00000000-0000-4000-8006-000000000012', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8001-000000000011', 'Czym są przeciwciała?', 'Białka produkowane przez układ odpornościowy do neutralizacji patogenów.', now()),

  -- Politechnika Gdańska
  ('00000000-0000-4000-8006-000000000013', '00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8001-000000000015', 'Co to jest regulator PID?', 'Regulator z członem proporcjonalnym, całkującym i różniczkującym.', now()),
  ('00000000-0000-4000-8006-000000000014', '00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8001-000000000015', 'Różnica między czujnikiem a aktuatorem?', 'Czujnik mierzy wielkość fizyczną, aktuator wykonuje działanie.', now()),
  ('00000000-0000-4000-8006-000000000015', '00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8001-000000000015', 'Do czego służy dioda Zenera?', 'Do stabilizacji napięcia w obwodzie elektrycznym.', now()),
  ('00000000-0000-4000-8006-000000000016', '00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8001-000000000015', 'Co to jest transformator?', 'Urządzenie do przenoszenia energii elektrycznej między obwodami.', now()),

  -- Uniwersytet Wrocławski
  ('00000000-0000-4000-8006-000000000017', '00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8001-000000000019', 'Czym jest noumen według Kanta?', 'Rzecz sama w sobie — istnieje niezależnie od naszego postrzegania.', now()),
  ('00000000-0000-4000-8006-000000000018', '00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8001-000000000019', 'Co to jest sylogizm?', 'Wnioskowanie logiczne z dwóch przesłanek prowadzące do konkluzji.', now()),
  ('00000000-0000-4000-8006-000000000019', '00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8001-000000000019', 'Kto napisał "Utopię"?', 'Thomas More opisał idealne społeczeństwo w dziele "Utopia".', now()),
  ('00000000-0000-4000-8006-000000000020', '00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8001-000000000019', 'Czym jest paradoks kłamcy?', 'Zdanie "To zdanie jest fałszywe" prowadzi do sprzeczności logicznej.', now()),

  -- Akademia Górniczo-Hutnicza
  ('00000000-0000-4000-8006-000000000021', '00000000-0000-4000-8000-000000000006', '00000000-0000-4000-8001-000000000022', 'Co to jest moment bezwładności?', 'Miara oporu ciała przed zmianą ruchu obrotowego.', now()),
  ('00000000-0000-4000-8006-000000000022', '00000000-0000-4000-8000-000000000006', '00000000-0000-4000-8001-000000000022', 'Różnica między naprężeniem a odkształceniem?', 'Naprężenie to siła na jednostkę powierzchni, odkształcenie to względna zmiana wymiarów.', now()),
  ('00000000-0000-4000-8006-000000000023', '00000000-0000-4000-8000-000000000006', '00000000-0000-4000-8001-000000000022', 'Co to jest tarcie?', 'Siła oporu przy ruchu względnym dwóch stykających się powierzchni.', now()),
  ('00000000-0000-4000-8006-000000000024', '00000000-0000-4000-8000-000000000006', '00000000-0000-4000-8001-000000000022', 'Do czego służy termopara?', 'Do pomiaru temperatury wykorzystująca zjawisko Seebecka.', now())
ON CONFLICT DO NOTHING;
