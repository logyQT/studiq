# EDU-ASG-02 — Dodawanie pytań – ręczny wybór

- id: EDU-ASG-02
- priority: P2 ważny
- module: EDU – Panel nauczyciela (/edu)
- section: Kartkówki (/edu/assignments)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Szkic kartkówki.

## Steps

1. W sekcji „Przeglądaj pytania” wybierz źródło: „Wszystkie pytania”, potem „Bank pytań” (wybierz bank) i „Temat”.
2. Zaznacz kilka pytań i kliknij „Dodaj wybrane”.
3. Użyj wyszukiwarki „Szukaj pytań…”.

## Expected result

- Lista pytań zmienia się zależnie od źródła; wybrane pytania dodają się do kartkówki.
- Sekcja „Pytania” pokazuje listę i „Suma punktów”.
- Pusta kartkówka: „Brak pytań – Dodaj pytania za pomocą przycisków poniżej”.

## QA tenant fixture (reconciled)

The case was written against the legacy manual seed (`teacher1@dev.local`, password `pass`,
organization WSB Merito, banks/topics `O1G1T1`). The suite version uses the case's own tenant
and never the legacy accounts.

- Profile: `content` (`qa/tests/profiles/EDU-ASG-02.json`) — one organization, one default
  group `G1`, and one account per account type: `manager` (org `admin`), `teacher` (account
  type `educator`), `student`. The case is about the educator's assignment editor, so it
  signs in as `teacher`.
- Seed: `bun scripts/qa-tenant.ts EDU-ASG-02 --fresh` — a fresh run suffix per independent
  run, so every run gets its own org/group/users from
  `tenantKey('qa/cases/EDU-ASG-02.md', 'EDU-ASG-02#<suffix>', 'qa-shared')` +
  `tenantId(key, entity)`. The spec reads the ids through `loadTenant('EDU-ASG-02')`.
- Prerequisite „Szkic kartkówki”: the spec creates a fresh draft assignment
  (`POST /api/v1/teacher/assignments`) owned by the tenant educator, so the empty-state
  assertions always start from zero questions.
- Content (created by the spec through the product API, idempotently, inside this tenant):
  - `EDU-ASG-02 Bank A` — an open question tagged with the topic and a true/false question
    without one;
  - `EDU-ASG-02 Bank B` — two open questions, one tagged with the topic;
  - `EDU-ASG-02 Temat` — the topic used by the „Temat” source.
    The two banks and the topic make the source filter observable: „Bank pytań” + Bank A shows
    two questions, „Temat” shows the two tagged questions, and „Wszystkie pytania” shows all
    four.
- Nothing global is read or written: no admin setting, feature flag, plan, platform stat or
  singleton row; no other worker's tenant is touched.
