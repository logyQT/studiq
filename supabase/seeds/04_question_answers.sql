-- ==========================================================
-- Seeds: question_answers (04)
-- Depends on: 03_questions.sql
-- ==========================================================

-- Q1: typeof null
INSERT INTO "public"."question_answers" ("id", "question_id", "content", "is_correct", "order_index") VALUES
  ('00000000-0000-4000-8005-000000000001', '00000000-0000-4000-8004-000000000001', 'object', true, 0),
  ('00000000-0000-4000-8005-000000000002', '00000000-0000-4000-8004-000000000001', 'null', false, 1),
  ('00000000-0000-4000-8005-000000000003', '00000000-0000-4000-8004-000000000001', 'undefined', false, 2),
  ('00000000-0000-4000-8005-000000000004', '00000000-0000-4000-8004-000000000001', 'number', false, 3);

-- Q2: array method
INSERT INTO "public"."question_answers" ("id", "question_id", "content", "is_correct", "order_index") VALUES
  ('00000000-0000-4000-8005-000000000005', '00000000-0000-4000-8004-000000000002', 'map()', true, 0),
  ('00000000-0000-4000-8005-000000000006', '00000000-0000-4000-8004-000000000002', 'forEach()', false, 1),
  ('00000000-0000-4000-8005-000000000007', '00000000-0000-4000-8004-000000000002', 'push()', false, 2),
  ('00000000-0000-4000-8005-000000000008', '00000000-0000-4000-8004-000000000002', 'sort()', false, 3);

-- Q3: JS static typing (true_false)
INSERT INTO "public"."question_answers" ("id", "question_id", "content", "is_correct", "order_index") VALUES
  ('00000000-0000-4000-8005-000000000009', '00000000-0000-4000-8004-000000000003', 'Prawda', false, 0),
  ('00000000-0000-4000-8005-000000000010', '00000000-0000-4000-8004-000000000003', 'Fałsz', true, 1);

-- Q4: GROUP BY
INSERT INTO "public"."question_answers" ("id", "question_id", "content", "is_correct", "order_index") VALUES
  ('00000000-0000-4000-8005-000000000011', '00000000-0000-4000-8004-000000000004', 'Grupuje wiersze o tych samych wartościach', true, 0),
  ('00000000-0000-4000-8005-000000000012', '00000000-0000-4000-8004-000000000004', 'Sortuje wyniki', false, 1),
  ('00000000-0000-4000-8005-000000000013', '00000000-0000-4000-8004-000000000004', 'Filtruje wiersze', false, 2),
  ('00000000-0000-4000-8005-000000000014', '00000000-0000-4000-8004-000000000004', 'Łączy dwie tabele', false, 3);

-- Q5: LEFT JOIN
INSERT INTO "public"."question_answers" ("id", "question_id", "content", "is_correct", "order_index") VALUES
  ('00000000-0000-4000-8005-000000000015', '00000000-0000-4000-8004-000000000005', 'LEFT JOIN', true, 0),
  ('00000000-0000-4000-8005-000000000016', '00000000-0000-4000-8004-000000000005', 'INNER JOIN', false, 1),
  ('00000000-0000-4000-8005-000000000017', '00000000-0000-4000-8004-000000000005', 'RIGHT JOIN', false, 2),
  ('00000000-0000-4000-8005-000000000018', '00000000-0000-4000-8004-000000000005', 'CROSS JOIN', false, 3);

-- Q6: derivative
INSERT INTO "public"."question_answers" ("id", "question_id", "content", "is_correct", "order_index") VALUES
  ('00000000-0000-4000-8005-000000000019', '00000000-0000-4000-8004-000000000006', '2x', true, 0),
  ('00000000-0000-4000-8005-000000000020', '00000000-0000-4000-8004-000000000006', 'x', false, 1),
  ('00000000-0000-4000-8005-000000000021', '00000000-0000-4000-8004-000000000006', 'x²', false, 2),
  ('00000000-0000-4000-8005-000000000022', '00000000-0000-4000-8004-000000000006', '2', false, 3);

-- Q7: identity matrix (true_false)
INSERT INTO "public"."question_answers" ("id", "question_id", "content", "is_correct", "order_index") VALUES
  ('00000000-0000-4000-8005-000000000023', '00000000-0000-4000-8004-000000000007', 'Prawda', true, 0),
  ('00000000-0000-4000-8005-000000000024', '00000000-0000-4000-8004-000000000007', 'Fałsz', false, 1);

-- ==========================================================
-- Politechnika Warszawska
-- ==========================================================

-- Q8: model iteracyjny (MCQ)
INSERT INTO "public"."question_answers" ("id", "question_id", "content", "is_correct", "order_index") VALUES
  ('00000000-0000-4000-8005-000000000025', '00000000-0000-4000-8004-000000000008', 'Model kaskadowy', false, 0),
  ('00000000-0000-4000-8005-000000000026', '00000000-0000-4000-8004-000000000008', 'Model iteracyjny', true, 1),
  ('00000000-0000-4000-8005-000000000027', '00000000-0000-4000-8004-000000000008', 'Model V', false, 2),
  ('00000000-0000-4000-8005-000000000028', '00000000-0000-4000-8004-000000000008', 'Model spiralny', false, 3);

-- Q9: SOLID (MCQ)
INSERT INTO "public"."question_answers" ("id", "question_id", "content", "is_correct", "order_index") VALUES
  ('00000000-0000-4000-8005-000000000029', '00000000-0000-4000-8004-000000000009', 'Pięć zasad projektowania obiektowego', true, 0),
  ('00000000-0000-4000-8005-000000000030', '00000000-0000-4000-8004-000000000009', 'Wzorzec architektoniczny', false, 1),
  ('00000000-0000-4000-8005-000000000031', '00000000-0000-4000-8004-000000000009', 'Rodzaj bazy danych NoSQL', false, 2),
  ('00000000-0000-4000-8005-000000000032', '00000000-0000-4000-8004-000000000009', 'Protokół komunikacyjny', false, 3);

-- Q10: Scrum Agile (true_false)
INSERT INTO "public"."question_answers" ("id", "question_id", "content", "is_correct", "order_index") VALUES
  ('00000000-0000-4000-8005-000000000033', '00000000-0000-4000-8004-000000000010', 'Prawda', true, 0),
  ('00000000-0000-4000-8005-000000000034', '00000000-0000-4000-8004-000000000010', 'Fałsz', false, 1);

-- Q11: DNS (MCQ)
INSERT INTO "public"."question_answers" ("id", "question_id", "content", "is_correct", "order_index") VALUES
  ('00000000-0000-4000-8005-000000000035', '00000000-0000-4000-8004-000000000011', 'HTTP', false, 0),
  ('00000000-0000-4000-8005-000000000036', '00000000-0000-4000-8004-000000000011', 'DNS', true, 1),
  ('00000000-0000-4000-8005-000000000037', '00000000-0000-4000-8004-000000000011', 'FTP', false, 2),
  ('00000000-0000-4000-8005-000000000038', '00000000-0000-4000-8004-000000000011', 'SMTP', false, 3);

-- Q12: Ethernet ramka (MCQ)
INSERT INTO "public"."question_answers" ("id", "question_id", "content", "is_correct", "order_index") VALUES
  ('00000000-0000-4000-8005-000000000039', '00000000-0000-4000-8004-000000000012', '64 bajty', false, 0),
  ('00000000-0000-4000-8005-000000000040', '00000000-0000-4000-8004-000000000012', '1518 bajtów', true, 1),
  ('00000000-0000-4000-8005-000000000041', '00000000-0000-4000-8004-000000000012', '4096 bajtów', false, 2),
  ('00000000-0000-4000-8005-000000000042', '00000000-0000-4000-8004-000000000012', '256 bajtów', false, 3);

-- Q13: TCP (true_false)
INSERT INTO "public"."question_answers" ("id", "question_id", "content", "is_correct", "order_index") VALUES
  ('00000000-0000-4000-8005-000000000043', '00000000-0000-4000-8004-000000000013', 'Prawda', true, 0),
  ('00000000-0000-4000-8005-000000000044', '00000000-0000-4000-8004-000000000013', 'Fałsz', false, 1);

-- ==========================================================
-- Uniwersytet Jagielloński
-- ==========================================================

-- Q14: dziedziczenie dominujące (MCQ)
INSERT INTO "public"."question_answers" ("id", "question_id", "content", "is_correct", "order_index") VALUES
  ('00000000-0000-4000-8005-000000000045', '00000000-0000-4000-8004-000000000014', 'Dziedziczenie dominujące', true, 0),
  ('00000000-0000-4000-8005-000000000046', '00000000-0000-4000-8004-000000000014', 'Dziedziczenie recesywne', false, 1),
  ('00000000-0000-4000-8005-000000000047', '00000000-0000-4000-8004-000000000014', 'Dziedziczenie mitochondrialne', false, 2),
  ('00000000-0000-4000-8005-000000000048', '00000000-0000-4000-8004-000000000014', 'Dziedziczenie sprzężone z płcią', false, 3);

-- Q15: ekspresja genu (MCQ)
INSERT INTO "public"."question_answers" ("id", "question_id", "content", "is_correct", "order_index") VALUES
  ('00000000-0000-4000-8005-000000000049', '00000000-0000-4000-8004-000000000015', 'Proces przepisywania DNA na RNA', false, 0),
  ('00000000-0000-4000-8005-000000000050', '00000000-0000-4000-8004-000000000015', 'Proces syntezy białka', false, 1),
  ('00000000-0000-4000-8005-000000000051', '00000000-0000-4000-8004-000000000015', 'Proces przekształcania informacji genetycznej w produkty funkcjonalne', true, 2),
  ('00000000-0000-4000-8005-000000000052', '00000000-0000-4000-8004-000000000015', 'Proces replikacji DNA', false, 3);

-- Q16: mutacja punktowa (true_false)
INSERT INTO "public"."question_answers" ("id", "question_id", "content", "is_correct", "order_index") VALUES
  ('00000000-0000-4000-8005-000000000053', '00000000-0000-4000-8004-000000000016', 'Prawda', false, 0),
  ('00000000-0000-4000-8005-000000000054', '00000000-0000-4000-8004-000000000016', 'Fałsz', true, 1);

-- Q17: wiązanie peptydowe (MCQ)
INSERT INTO "public"."question_answers" ("id", "question_id", "content", "is_correct", "order_index") VALUES
  ('00000000-0000-4000-8005-000000000055', '00000000-0000-4000-8004-000000000017', 'Wiązanie wodorowe', false, 0),
  ('00000000-0000-4000-8005-000000000056', '00000000-0000-4000-8004-000000000017', 'Wiązanie peptydowe', true, 1),
  ('00000000-0000-4000-8005-000000000057', '00000000-0000-4000-8004-000000000017', 'Wiązanie jonowe', false, 2),
  ('00000000-0000-4000-8005-000000000058', '00000000-0000-4000-8004-000000000017', 'Wiązanie kowalencyjne', false, 3);

-- Q18: ATP (MCQ)
INSERT INTO "public"."question_answers" ("id", "question_id", "content", "is_correct", "order_index") VALUES
  ('00000000-0000-4000-8005-000000000059', '00000000-0000-4000-8004-000000000018', 'ATP', true, 0),
  ('00000000-0000-4000-8005-000000000060', '00000000-0000-4000-8004-000000000018', 'ADP', false, 1),
  ('00000000-0000-4000-8005-000000000061', '00000000-0000-4000-8004-000000000018', 'NADPH', false, 2),
  ('00000000-0000-4000-8005-000000000062', '00000000-0000-4000-8004-000000000018', 'GTP', false, 3);

-- Q19: enzymy (true_false)
INSERT INTO "public"."question_answers" ("id", "question_id", "content", "is_correct", "order_index") VALUES
  ('00000000-0000-4000-8005-000000000063', '00000000-0000-4000-8004-000000000019', 'Prawda', true, 0),
  ('00000000-0000-4000-8005-000000000064', '00000000-0000-4000-8004-000000000019', 'Fałsz', false, 1);

-- ==========================================================
-- Politechnika Gdańska
-- ==========================================================

-- Q20: sprzężenie zwrotne (MCQ)
INSERT INTO "public"."question_answers" ("id", "question_id", "content", "is_correct", "order_index") VALUES
  ('00000000-0000-4000-8005-000000000065', '00000000-0000-4000-8004-000000000020', 'Dodatnie sprzężenie zwrotne', false, 0),
  ('00000000-0000-4000-8005-000000000066', '00000000-0000-4000-8004-000000000020', 'Ujemne sprzężenie zwrotne', true, 1),
  ('00000000-0000-4000-8005-000000000067', '00000000-0000-4000-8004-000000000020', 'Brak sprzężenia zwrotnego', false, 2),
  ('00000000-0000-4000-8005-000000000068', '00000000-0000-4000-8004-000000000020', 'Sprzężenie kaskadowe', false, 3);

-- Q21: transmitancja (MCQ)
INSERT INTO "public"."question_answers" ("id", "question_id", "content", "is_correct", "order_index") VALUES
  ('00000000-0000-4000-8005-000000000069', '00000000-0000-4000-8004-000000000021', 'Stosunek wyjścia do wejścia w dziedzinie czasu', false, 0),
  ('00000000-0000-4000-8005-000000000070', '00000000-0000-4000-8004-000000000021', 'Stosunek transformaty Laplacea wyjścia do wejścia', true, 1),
  ('00000000-0000-4000-8005-000000000071', '00000000-0000-4000-8004-000000000021', 'Wzmocnienie układu w stanie ustalonym', false, 2),
  ('00000000-0000-4000-8005-000000000072', '00000000-0000-4000-8004-000000000021', 'Opóźnienie propagacji sygnału', false, 3);

-- Q22: PID (true_false)
INSERT INTO "public"."question_answers" ("id", "question_id", "content", "is_correct", "order_index") VALUES
  ('00000000-0000-4000-8005-000000000073', '00000000-0000-4000-8004-000000000022', 'Prawda', true, 0),
  ('00000000-0000-4000-8005-000000000074', '00000000-0000-4000-8004-000000000022', 'Fałsz', false, 1);

-- Q23: półprzewodnik (MCQ)
INSERT INTO "public"."question_answers" ("id", "question_id", "content", "is_correct", "order_index") VALUES
  ('00000000-0000-4000-8005-000000000075', '00000000-0000-4000-8004-000000000023', 'Miedź', false, 0),
  ('00000000-0000-4000-8005-000000000076', '00000000-0000-4000-8004-000000000023', 'Krzem', true, 1),
  ('00000000-0000-4000-8005-000000000077', '00000000-0000-4000-8004-000000000023', 'Aluminium', false, 2),
  ('00000000-0000-4000-8005-000000000078', '00000000-0000-4000-8004-000000000023', 'Srebro', false, 3);

-- Q24: bramka NAND (MCQ)
INSERT INTO "public"."question_answers" ("id", "question_id", "content", "is_correct", "order_index") VALUES
  ('00000000-0000-4000-8005-000000000079', '00000000-0000-4000-8004-000000000024', 'Gdy wszystkie wejścia są 0', false, 0),
  ('00000000-0000-4000-8005-000000000080', '00000000-0000-4000-8004-000000000024', 'Gdy wszystkie wejścia są 1', true, 1),
  ('00000000-0000-4000-8005-000000000081', '00000000-0000-4000-8004-000000000024', 'Gdy przynajmniej jedno wejście jest 0', false, 2),
  ('00000000-0000-4000-8005-000000000082', '00000000-0000-4000-8004-000000000024', 'Zawsze zwraca prawdę', false, 3);

-- Q25: prawo Moorea (true_false)
INSERT INTO "public"."question_answers" ("id", "question_id", "content", "is_correct", "order_index") VALUES
  ('00000000-0000-4000-8005-000000000083', '00000000-0000-4000-8004-000000000025', 'Prawda', true, 0),
  ('00000000-0000-4000-8005-000000000084', '00000000-0000-4000-8004-000000000025', 'Fałsz', false, 1);

-- ==========================================================
-- Uniwersytet Wrocławski
-- ==========================================================

-- Q26: Cogito ergo sum (MCQ)
INSERT INTO "public"."question_answers" ("id", "question_id", "content", "is_correct", "order_index") VALUES
  ('00000000-0000-4000-8005-000000000085', '00000000-0000-4000-8004-000000000026', 'Kartezjusz', true, 0),
  ('00000000-0000-4000-8005-000000000086', '00000000-0000-4000-8004-000000000026', 'Arystoteles', false, 1),
  ('00000000-0000-4000-8005-000000000087', '00000000-0000-4000-8004-000000000026', 'Nietzsche', false, 2),
  ('00000000-0000-4000-8005-000000000088', '00000000-0000-4000-8004-000000000026', 'Hume', false, 3);

-- Q27: Kant (MCQ)
INSERT INTO "public"."question_answers" ("id", "question_id", "content", "is_correct", "order_index") VALUES
  ('00000000-0000-4000-8005-000000000089', '00000000-0000-4000-8004-000000000027', 'Empiryzm', false, 0),
  ('00000000-0000-4000-8005-000000000090', '00000000-0000-4000-8004-000000000027', 'Idealizm transcendentalny', true, 1),
  ('00000000-0000-4000-8005-000000000091', '00000000-0000-4000-8004-000000000027', 'Materializm dialektyczny', false, 2),
  ('00000000-0000-4000-8005-000000000092', '00000000-0000-4000-8004-000000000027', 'Egzystencjalizm', false, 3);

-- Q28: Locke (true_false)
INSERT INTO "public"."question_answers" ("id", "question_id", "content", "is_correct", "order_index") VALUES
  ('00000000-0000-4000-8005-000000000093', '00000000-0000-4000-8004-000000000028', 'Prawda', true, 0),
  ('00000000-0000-4000-8005-000000000094', '00000000-0000-4000-8004-000000000028', 'Fałsz', false, 1);

-- Q29: prawo wyłączonego środka (MCQ)
INSERT INTO "public"."question_answers" ("id", "question_id", "content", "is_correct", "order_index") VALUES
  ('00000000-0000-4000-8005-000000000095', '00000000-0000-4000-8004-000000000029', 'Prawo wyłączonego środka', true, 0),
  ('00000000-0000-4000-8005-000000000096', '00000000-0000-4000-8004-000000000029', 'Prawo tożsamości', false, 1),
  ('00000000-0000-4000-8005-000000000097', '00000000-0000-4000-8004-000000000029', 'Prawo sprzeczności', false, 2),
  ('00000000-0000-4000-8005-000000000098', '00000000-0000-4000-8004-000000000029', 'Prawo transpozycji', false, 3);

-- Q30: kwantyfikator egzystencjalny (MCQ)
INSERT INTO "public"."question_answers" ("id", "question_id", "content", "is_correct", "order_index") VALUES
  ('00000000-0000-4000-8005-000000000099', '00000000-0000-4000-8004-000000000030', 'Stwierdza, że wszystkie obiekty spełniają warunek', false, 0),
  ('00000000-0000-4000-8005-000000000100', '00000000-0000-4000-8004-000000000030', 'Stwierdza, że istnieje obiekt spełniający warunek', true, 1),
  ('00000000-0000-4000-8005-000000000101', '00000000-0000-4000-8004-000000000030', 'Stwierdza, że nie istnieje obiekt spełniający warunek', false, 2),
  ('00000000-0000-4000-8005-000000000102', '00000000-0000-4000-8004-000000000030', 'Zaprzecza zdaniu', false, 3);

-- Q31: modus ponens (true_false)
INSERT INTO "public"."question_answers" ("id", "question_id", "content", "is_correct", "order_index") VALUES
  ('00000000-0000-4000-8005-000000000103', '00000000-0000-4000-8004-000000000031', 'Prawda', true, 0),
  ('00000000-0000-4000-8005-000000000104', '00000000-0000-4000-8004-000000000031', 'Fałsz', false, 1);

-- ==========================================================
-- Akademia Górniczo-Hutnicza
-- ==========================================================

-- Q32: jednostka siły (MCQ)
INSERT INTO "public"."question_answers" ("id", "question_id", "content", "is_correct", "order_index") VALUES
  ('00000000-0000-4000-8005-000000000105', '00000000-0000-4000-8004-000000000032', 'Wat', false, 0),
  ('00000000-0000-4000-8005-000000000106', '00000000-0000-4000-8004-000000000032', 'Niuton', true, 1),
  ('00000000-0000-4000-8005-000000000107', '00000000-0000-4000-8004-000000000032', 'Dżul', false, 2),
  ('00000000-0000-4000-8005-000000000108', '00000000-0000-4000-8004-000000000032', 'Paskal', false, 3);

-- Q33: zachowanie energii (MCQ)
INSERT INTO "public"."question_answers" ("id", "question_id", "content", "is_correct", "order_index") VALUES
  ('00000000-0000-4000-8005-000000000109', '00000000-0000-4000-8004-000000000033', 'Zanika w postaci ciepła', false, 0),
  ('00000000-0000-4000-8005-000000000110', '00000000-0000-4000-8004-000000000033', 'Nie może być stworzona ani zniszczona', true, 1),
  ('00000000-0000-4000-8005-000000000111', '00000000-0000-4000-8004-000000000033', 'Jest zawsze stała w układach otwartych', false, 2),
  ('00000000-0000-4000-8005-000000000112', '00000000-0000-4000-8004-000000000033', 'Rośnie liniowo z czasem', false, 3);

-- Q34: prędkość światła (true_false)
INSERT INTO "public"."question_answers" ("id", "question_id", "content", "is_correct", "order_index") VALUES
  ('00000000-0000-4000-8005-000000000113', '00000000-0000-4000-8004-000000000034', 'Prawda', true, 0),
  ('00000000-0000-4000-8005-000000000114', '00000000-0000-4000-8004-000000000034', 'Fałsz', false, 1);

-- Q35: naprężenie normalne (MCQ)
INSERT INTO "public"."question_answers" ("id", "question_id", "content", "is_correct", "order_index") VALUES
  ('00000000-0000-4000-8005-000000000115', '00000000-0000-4000-8004-000000000035', 'Siła prostopadła do przekroju przez pole przekroju', true, 0),
  ('00000000-0000-4000-8005-000000000116', '00000000-0000-4000-8004-000000000035', 'Siła styczna do przekroju przez pole przekroju', false, 1),
  ('00000000-0000-4000-8005-000000000117', '00000000-0000-4000-8004-000000000035', 'Moment zginający przez pole przekroju', false, 2),
  ('00000000-0000-4000-8005-000000000118', '00000000-0000-4000-8004-000000000035', 'Odkształcenie względne materiału', false, 3);

-- Q36: moduł Younga (MCQ)
INSERT INTO "public"."question_answers" ("id", "question_id", "content", "is_correct", "order_index") VALUES
  ('00000000-0000-4000-8005-000000000119', '00000000-0000-4000-8004-000000000036', 'Współczynnik Poissona', false, 0),
  ('00000000-0000-4000-8005-000000000120', '00000000-0000-4000-8004-000000000036', 'Moduł Younga (E)', true, 1),
  ('00000000-0000-4000-8005-000000000121', '00000000-0000-4000-8004-000000000036', 'Granica plastyczności', false, 2),
  ('00000000-0000-4000-8005-000000000122', '00000000-0000-4000-8004-000000000036', 'Naprężenie niszczące', false, 3);

-- Q37: prawo Hookea (true_false)
INSERT INTO "public"."question_answers" ("id", "question_id", "content", "is_correct", "order_index") VALUES
  ('00000000-0000-4000-8005-000000000123', '00000000-0000-4000-8004-000000000037', 'Prawda', false, 0),
  ('00000000-0000-4000-8005-000000000124', '00000000-0000-4000-8004-000000000037', 'Fałsz', true, 1);
