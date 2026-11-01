# STU-33 — Edycja i usuwanie pytania / banku

- id: STU-33
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Pytania i banki (/app/questions)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Własny bank z pytaniami.

## Prereqs (tenant model)

The case was written against the legacy manual seed (`student1@dev.local`, password
`pass`). The suite version uses the case's own tenant and never the legacy accounts.

- Profile: `content` (`__tests__/qa/profiles/STU-33.json`) — one organization with its default
  group `G1`, and one account per account type: `manager` (org `admin`, `G1` teacher),
  `teacher` and the `student` under test (`student1` → the tenant `student`).
- Seed: `bun scripts/qa-tenant.ts STU-33 --fresh` — a fresh run suffix per independent run,
  so every run gets its own organization and users from
  `tenantKey('qa/cases/STU-33.md', 'STU-33#<suffix>', 'qa-shared')` + `tenantId(key, entity)`.
  The spec reads the ids through `loadTenant('STU-33')`; nothing global is read or written
  (no admin setting, feature flag, plan, platform stat, singleton row or another tenant).
- The spec starts by deleting the student's own banks through the product API (they all
  belong to this case; a bank delete cascades its questions and answers), so a CI retry or
  a `--repeat-each` pass on the same seeded tenant starts from the empty `/app/questions`
  list again.
- „Własny bank z pytaniami” → the student creates `STU-33 mój bank` (personal, in the tenant
  organization) with two MCQ questions through `POST /api/v1/questions/banks` and
  `POST /api/v1/questions`: `STU-33: Ile wynosi 2+2?` (answers `4` correct / `5`) is edited
  and deleted in steps 1–2; `STU-33: pytanie w usuwanym banku` (answers `tak` / `nie`)
  stays inside the bank until step 3 and proves the cascade.
- The bank is opened from its card in `/app/questions` with „Zarządzaj”; the question and
  bank menus are the same `Więcej akcji: <nazwa>` dropdowns a real student uses.

## Observed during the suite walk (shared app 3010 / DB 54421, pl, worker qa-env-2)

- Lista `/app/questions`: karta banku pokazuje nazwę, licznik „2 pytania” i akcję
  „Zarządzaj”. Menu „Więcej akcji: <nazwa banku>” zawiera „Edytuj”, „Zarządzaj”, „Usuń”.
- Szczegóły banku `/app/questions/<id>`: nagłówek z nazwą banku, „Utwórz pytanie” oraz tabela
  Pytanie / Typ / Tematy / Odpowiedzi / Akcje. Wiersz pytania ma ikony „Edytuj” i „Usuń”
  (oraz akcję zgłoszenia); typ MCQ renderuje się jako „Wielokrotnego wyboru”, liczba
  odpowiedzi jako `2`.
- Krok 1: „Edytuj” otwiera dialog **„Edytuj pytanie”** („Zaktualizuj szczegóły pytania”) z
  wypełnioną treścią i odpowiedziami; zapis „Aktualizuj” daje toast **„Pytanie
  zaktualizowane”**, a tabela i `GET /api/v1/questions/<id>` pokazują nową treść
  (`STU-33: Ile wynosi 3+3?`) i odpowiedzi `6` (poprawna) / `7`.
- Krok 2: kosz w wierszu otwiera okno **„Usunąć pytanie?”** z opisem „To trwale usunie to
  pytanie i wszystkie jego odpowiedzi. Tej akcji nie można cofnąć.” i przyciskami
  „Anuluj” / „Usuń”. Po potwierdzeniu pojawia się **„Pytanie usunięte”**, wiersz znika,
  a `GET /api/v1/questions/<id>` zwraca **404 NOT_FOUND**; drugie pytanie zostaje w banku.
- Krok 3: menu karty banku → „Edytuj” otwiera **„Edytuj bank”** z bieżącą nazwą; zapis
  „Aktualizuj” daje **„Bank pytań zaktualizowany”** i nową nazwę na karcie
  (`STU-33 mój bank (po edycji)`), a API nadal raportuje `question_count: 1`.
- Krok 3 (usuwanie): menu → „Usuń” otwiera **„Usunąć bank pytań?”** z opisem „To trwale
  usunie ten bank i wszystkie jego pytania. Tej akcji nie można cofnąć.”; potwierdzenie daje
  **„Bank pytań usunięty”**, karta znika, `GET /api/v1/questions/banks/<id>` → **404**,
  pytanie, które było w banku, również zwraca **404**, a lista pytań banku jest pusta —
  kaskada z bazy działa zgodnie z opisem okna.
- Wszystkie cztery toasty z oczekiwanego rezultatu występują dokładnie w podanej treści.

## Steps

1. Edytuj pytanie (treść, odpowiedzi), zapisz.
2. Usuń pytanie – okno „Usunąć pytanie?”.
3. Edytuj i usuń bank – okno „Usunąć bank pytań?”.

## Expected result

- Toasty „Pytanie zaktualizowane”, „Pytanie usunięte”, „Bank pytań zaktualizowany”, „Bank pytań usunięty”.
- Usunięcie banku usuwa jego pytania (zgodnie z opisem „To trwale usunie ten bank i wszystkie jego pytania.”).
