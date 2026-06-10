-- ==========================================================
-- Seeds: questions (03)
-- Depends on: 02_subjects.sql
-- ==========================================================

INSERT INTO "public"."questions" ("id", "subject_id", "university_id", "created_by", "type", "content", "explanation", "difficulty", "created_at", "updated_at") VALUES
  ('00000000-0000-4000-8004-000000000001', '00000000-0000-4000-8003-000000000001', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000003', 'mcq', 'Jaki jest wynik typeof null w JavaScript?', 'To znany bug w JavaScript — null jest typu object przez historyczny błąd.', 'easy', now(), now()),
  ('00000000-0000-4000-8004-000000000002', '00000000-0000-4000-8003-000000000001', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000003', 'mcq', 'Która metoda tablicy tworzy nową tablicę?', 'map() tworzy nową tablicę, forEach() modyfikuje w-place.', 'medium', now(), now()),
  ('00000000-0000-4000-8004-000000000003', '00000000-0000-4000-8003-000000000001', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000003', 'true_false', 'JavaScript jest językiem typowanym statycznie.', 'JavaScript jest językiem typowanym dynamicznie.', 'easy', now(), now()),
  ('00000000-0000-4000-8004-000000000004', '00000000-0000-4000-8003-000000000002', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000003', 'mcq', 'Co robi klauzula GROUP BY w SQL?', 'GROUP BY grupuje wiersze o tych samych wartościach w kolumnach.', 'medium', now(), now()),
  ('00000000-0000-4000-8004-000000000005', '00000000-0000-4000-8003-000000000002', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000003', 'mcq', 'Jaki typ JOIN zwraca wszystkie wiersze z lewej tabeli?', 'LEFT JOIN zwraca wszystkie wiersze z lewej tabeli + dopasowane z prawej.', 'easy', now(), now()),
  ('00000000-0000-4000-8004-000000000006', '00000000-0000-4000-8003-000000000003', null,'00000000-0000-4000-8001-000000000006', 'mcq', 'Jaka jest pochodna funkcji f(x) = x²?', 'Z reguły potęgowej: d/dx(x^n) = n*x^(n-1), więc d/dx(x²) = 2x.', 'medium', now(), now()),
  ('00000000-0000-4000-8004-000000000007', '00000000-0000-4000-8003-000000000003', null,'00000000-0000-4000-8001-000000000006', 'true_false', 'Macierz jednostkowa ma same jedynki na przekątnej.', 'Macierz jednostkowa ma 1 na przekątnej i 0 poza nią.', 'easy', now(), now()),

  -- ==========================================================
  -- Politechnika Warszawska — Inżynieria Oprogramowania
  -- ==========================================================
  ('00000000-0000-4000-8004-000000000008', '00000000-0000-4000-8003-000000000004', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8001-000000000008', 'mcq', 'Który model procesu wytwórczego zakłada iteracyjne cykle?', 'Model iteracyjny powtarza cykle analiza-projekt-kodowanie-testowanie.', 'medium', now(), now()),
  ('00000000-0000-4000-8004-000000000009', '00000000-0000-4000-8003-000000000004', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8001-000000000008', 'mcq', 'Co oznacza akronim SOLID?', 'Zbiór pięciu zasad projektowania obiektowego autorstwa R. Martina.', 'hard', now(), now()),
  ('00000000-0000-4000-8004-000000000010', '00000000-0000-4000-8003-000000000004', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8001-000000000008', 'true_false', 'Scrum należy do metodyk zwinnych (Agile).', 'Scrum to framework Agile bazujący na sprintach i iteracjach.', 'easy', now(), now()),

  -- PW — Sieci Komputerowe
  ('00000000-0000-4000-8004-000000000011', '00000000-0000-4000-8003-000000000005', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8001-000000000008', 'mcq', 'Który protokół tłumaczy nazwy domen na adresy IP?', 'DNS (Domain Name System) mapuje nazwy na adresy IP.', 'easy', now(), now()),
  ('00000000-0000-4000-8004-000000000012', '00000000-0000-4000-8003-000000000005', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8001-000000000008', 'mcq', 'Jaka jest maksymalna długość ramki Ethernet?', 'Standard Ethernet definiuje maksymalny rozmiar ramki na 1518 bajtów.', 'medium', now(), now()),
  ('00000000-0000-4000-8004-000000000013', '00000000-0000-4000-8003-000000000005', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8001-000000000008', 'true_false', 'Protokół TCP gwarantuje dostarczenie pakietów we właściwej kolejności.', 'TCP jest protokołem połączeniowym z kontrolą sekwencji.', 'easy', now(), now()),

  -- ==========================================================
  -- Uniwersytet Jagielloński — Genetyka
  -- ==========================================================
  ('00000000-0000-4000-8004-000000000014', '00000000-0000-4000-8003-000000000006', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8001-000000000011', 'mcq', 'Jaki model dziedziczenia opisuje maskowanie allelu recesywnego przez dominujący?', 'Dziedziczenie dominujące — allel dominujący maskuje recesywny.', 'medium', now(), now()),
  ('00000000-0000-4000-8004-000000000015', '00000000-0000-4000-8003-000000000006', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8001-000000000011', 'mcq', 'Czym jest ekspresja genu?', 'Proces przekształcania informacji genetycznej w funkcjonalne produkty (RNA/białka).', 'hard', now(), now()),
  ('00000000-0000-4000-8004-000000000016', '00000000-0000-4000-8003-000000000006', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8001-000000000011', 'true_false', 'Mutacja punktowa zawsze zmienia sekwencję aminokwasów.', 'Mutacje synonimiczne nie zmieniają kodowanego aminokwasu.', 'hard', now(), now()),

  -- UJ — Biochemia
  ('00000000-0000-4000-8004-000000000017', '00000000-0000-4000-8003-000000000007', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8001-000000000011', 'mcq', 'Które wiązanie łączy aminokwasy w łańcuch polipeptydowy?', 'Wiązanie peptydowe powstaje między grupą karboksylową a aminową.', 'medium', now(), now()),
  ('00000000-0000-4000-8004-000000000018', '00000000-0000-4000-8003-000000000007', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8001-000000000011', 'mcq', 'Jaka cząsteczka jest głównym nośnikiem energii w komórce?', 'ATP (adenozynotrifosforan) magazynuje i transportuje energię.', 'easy', now(), now()),
  ('00000000-0000-4000-8004-000000000019', '00000000-0000-4000-8003-000000000007', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8001-000000000011', 'true_false', 'Enzymy obniżają energię aktywacji reakcji chemicznych.', 'Działanie katalityczne enzymów polega na obniżaniu energii aktywacji.', 'medium', now(), now()),

  -- ==========================================================
  -- Politechnika Gdańska — Automatyka
  -- ==========================================================
  ('00000000-0000-4000-8004-000000000020', '00000000-0000-4000-8003-000000000008', '00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8001-000000000015', 'mcq', 'Jaki rodzaj sprzężenia zwrotnego stabilizuje układ automatyki?', 'Ujemne sprzężenie zwrotne redukuje odchyłkę i stabilizuje układ.', 'medium', now(), now()),
  ('00000000-0000-4000-8004-000000000021', '00000000-0000-4000-8003-000000000008', '00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8001-000000000015', 'mcq', 'Co opisuje transmitancja operatorowa?', 'Stosunek transformaty Laplace''a wyjścia do wejścia przy zerowych warunkach początkowych.', 'hard', now(), now()),
  ('00000000-0000-4000-8004-000000000022', '00000000-0000-4000-8003-000000000008', '00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8001-000000000015', 'true_false', 'Regulator PID zawiera człon proporcjonalny, całkujący i różniczkujący.', 'PID = Proportional-Integral-Derivative.', 'easy', now(), now()),

  -- PG — Mikroelektronika
  ('00000000-0000-4000-8004-000000000023', '00000000-0000-4000-8003-000000000009', '00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8001-000000000015', 'mcq', 'Jaki materiał jest najczęściej używany jako półprzewodnik w elektronice?', 'Krzem (Si) jest podstawowym materiałem półprzewodnikowym.', 'easy', now(), now()),
  ('00000000-0000-4000-8004-000000000024', '00000000-0000-4000-8003-000000000009', '00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8001-000000000015', 'mcq', 'Która bramka logiczna zwraca fałsz tylko gdy wszystkie wejścia są prawdziwe?', 'NAND zwraca fałsz tylko przy wszystkich wejściach = 1.', 'medium', now(), now()),
  ('00000000-0000-4000-8004-000000000025', '00000000-0000-4000-8003-000000000009', '00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8001-000000000015', 'true_false', 'Prawo Moore''a mówi o podwajaniu liczby tranzystorów co około 2 lata.', 'Gordon Moore przewidział wykładniczy wzrost gęstości tranzystorów.', 'medium', now(), now()),

  -- ==========================================================
  -- Uniwersytet Wrocławski — Filozofia Nowożytna
  -- ==========================================================
  ('00000000-0000-4000-8004-000000000026', '00000000-0000-4000-8003-000000000010', '00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8001-000000000019', 'mcq', 'Który filozof sformułował zasadę "Cogito, ergo sum"?', 'Kartezjusz (René Descartes) — fundament racjonalizmu.', 'easy', now(), now()),
  ('00000000-0000-4000-8004-000000000027', '00000000-0000-4000-8003-000000000010', '00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8001-000000000019', 'mcq', 'Immanuel Kant jest twórcą którego nurtu filozoficznego?', 'Kant stworzył idealizm transcendentalny — syntezę empiryzmu i racjonalizmu.', 'hard', now(), now()),
  ('00000000-0000-4000-8004-000000000028', '00000000-0000-4000-8003-000000000010', '00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8001-000000000019', 'true_false', 'John Locke głosił teorię państwa wynikającą z umowy społecznej.', 'Locke — ojciec liberalizmu, teoria umowy społecznej i praw naturalnych.', 'medium', now(), now()),

  -- UWr — Logika
  ('00000000-0000-4000-8004-000000000029', '00000000-0000-4000-8003-000000000011', '00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8001-000000000019', 'mcq', 'Które prawo logiki mówi, że zdanie p ∨ ¬p jest zawsze prawdziwe?', 'Prawo wyłączonego środka — jedno z fundamentalnych praw logiki klasycznej.', 'easy', now(), now()),
  ('00000000-0000-4000-8004-000000000030', '00000000-0000-4000-8003-000000000011', '00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8001-000000000019', 'mcq', 'Czym jest kwantyfikator egzystencjalny?', 'Kwantyfikator "istnieje" (∃) — stwierdza, że istnieje obiekt spełniający warunek.', 'medium', now(), now()),
  ('00000000-0000-4000-8004-000000000031', '00000000-0000-4000-8003-000000000011', '00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8001-000000000019', 'true_false', 'Modus ponens to schemat: jeśli p → q i p, to q.', 'Modus ponens jest podstawowym schematem wnioskowania dedukcyjnego.', 'medium', now(), now()),

  -- ==========================================================
  -- Akademia Górniczo-Hutnicza — Fizyka Techniczna
  -- ==========================================================
  ('00000000-0000-4000-8004-000000000032', '00000000-0000-4000-8003-000000000012', '00000000-0000-4000-8000-000000000006', '00000000-0000-4000-8001-000000000022', 'mcq', 'Jaka jest jednostka siły w układzie SI?', 'Niuton (N) = kg·m/s².', 'easy', now(), now()),
  ('00000000-0000-4000-8004-000000000033', '00000000-0000-4000-8003-000000000012', '00000000-0000-4000-8000-000000000006', '00000000-0000-4000-8001-000000000022', 'mcq', 'Zasada zachowania energii mówi, że energia:', 'Energia nie może być stworzona ani zniszczona, tylko przekształcana.', 'medium', now(), now()),
  ('00000000-0000-4000-8004-000000000034', '00000000-0000-4000-8003-000000000012', '00000000-0000-4000-8000-000000000006', '00000000-0000-4000-8001-000000000022', 'true_false', 'Prędkość światła w próżni jest stała we wszystkich układach inercjalnych.', 'Fundamentalny postulat szczególnej teorii względności Einsteina.', 'medium', now(), now()),

  -- AGH — Wytrzymałość Materiałów
  ('00000000-0000-4000-8004-000000000035', '00000000-0000-4000-8003-000000000013', '00000000-0000-4000-8000-000000000006', '00000000-0000-4000-8001-000000000022', 'mcq', 'Co to jest naprężenie normalne?', 'Naprężenie normalne to siła prostopadła do przekroju podzielona przez pole przekroju.', 'medium', now(), now()),
  ('00000000-0000-4000-8004-000000000036', '00000000-0000-4000-8003-000000000013', '00000000-0000-4000-8000-000000000006', '00000000-0000-4000-8001-000000000022', 'mcq', 'Która wielkość opisuje zdolność materiału do sprężystego odkształcania?', 'Moduł Younga (E) określa sztywność materiału w zakresie sprężystym.', 'hard', now(), now()),
  ('00000000-0000-4000-8004-000000000037', '00000000-0000-4000-8003-000000000013', '00000000-0000-4000-8000-000000000006', '00000000-0000-4000-8001-000000000022', 'true_false', 'Prawo Hooke''a obowiązuje w zakresie odkształceń plastycznych.', 'Prawo Hooke''a dotyczy tylko zakresu sprężystego, nie plastycznego.', 'medium', now(), now())
ON CONFLICT DO NOTHING;
