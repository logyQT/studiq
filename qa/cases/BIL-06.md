# BIL-06 — Płatność bez zalogowania

- id: BIL-06
- priority: P1 krytyczny
- module: BIL – Plany, rozliczenia i płatność (symulowana)
- section: Zakup planu (checkout)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Brak sesji.

## Steps

1. Otwórz /checkout?plan_id=spark i spróbuj dokończyć.
2. Wywołaj POST /api/v1/stripe/webhook z JSON {"type":"checkout.session.completed","session_id":"x","plan_id":"pro","user_id":"<UUID student1>"} bez sesji (np. curl).

## Expected result

- Dokończenie bez sesji nie zmienia żadnego planu (przycisk nie wysyła, bo brak użytkownika).
- UWAGA BEZPIECZEŃSTWA DO ZGŁOSZENIA: endpoint webhooka jest publiczny i w symulacji nie weryfikuje podpisu – jeśli wywołanie bez sesji zmienia plan użytkownika (odpowiedź {"received":true}), każdy może nadać dowolny plan dowolnemu użytkownikowi. Dozwolone tylko w środowisku deweloperskim; przed produkcją wymaga podpisu.

## Seed (QA-suite tenant)

Automatyzacja nie używa kont z ręcznego seeda (`student1@dev.local`, hasło `pass`) ani
stałego UUID-u ofiary z treści przypadku — ofiarą jest uczeń własnego tenanta przypadku.
Przypadek nie potrzebuje żadnych treści poza kontami, więc używa profilu `content`
(organizacja, manager, nauczyciel, uczeń, grupa domyślna `G1`):

```bash
bun scripts/qa-tenant.ts BIL-06 --fresh
```

- Klucz tenanta: `BIL-06.md::BIL-06#<run>::qa-shared` —
  `tenantKey('qa/cases/BIL-06.md', 'BIL-06#<run>', 'qa-shared')` + `tenantId`, ten sam
  schemat co fixture'y e2e. `--fresh` nadaje nowy sufiks przebiegu, więc każdy niezależny
  przebieg dostaje świeże konto/organizację; identyfikatory są deterministyczne w obrębie
  przebiegu (bez losowych UUID).
- Użytkownicy: `manager` (org role `admin`), `teacher` (konto educator), `student`
  (konto student, członek `G1`), hasło `Seed4Test!`.
- Wędrówka po wspólnej aplikacji potwierdziła oczekiwane zachowanie: `/checkout` bez sesji
  przekierowuje na `/login?next=/checkout?plan_id=spark`, `POST /api/v1/stripe/webhook`
  bez sesji zwraca 401 `UNAUTHORIZED` i nie zmienia niczyjego planu, a wywołanie z sesją
  ucznia dla `user_id` innego użytkownika zwraca 403 `FORBIDDEN`. Endpoint jest publiczny
  tylko na poziomie proxy — uwierzytelnia wywołującego sam i działa wyłącznie na jego
  koncie, więc opisane nadanie planu dowolnemu użytkownikowi nie występuje.
- Spec (`qa/tests/BIL/BIL-06.spec.ts`) dodatkowo sprawdza ścieżkę kontrolną: właściciel
  sesji nadal może kupić plan dla siebie (200, `{"received":true}`).
- Żaden globalny wiersz (ustawienia admina, flagi funkcji, katalog planów, statystyki,
  singletony) nie jest zapisywany; specyfikacja dotyka wyłącznie wierszy własnego tenanta.
