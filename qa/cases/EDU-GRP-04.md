# EDU-GRP-04 — Limit grup (plan organizacji Launch: 3)

- id: EDU-GRP-04
- priority: P2 ważny
- module: EDU – Panel nauczyciela (/edu)
- section: Grupy nauczyciela (/edu/groups)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

WSB Merito ma 2 grupy (O1G1, O1G2). Aktywna organizacja: WSB Merito.

## Steps

1. Utwórz 3. grupę.
2. Spróbuj utworzyć 4. grupę.

## Expected result

- 3. grupa powstaje.
- 4. jest odrzucona (USAGE_LIMIT_EXCEEDED) z czytelnym komunikatem „Nie udało się utworzyć grupy” lub komunikatem o limicie.

## Seed (QA-suite tenant)

Automatyzacja nie używa kont z ręcznego seeda (`teacher1@dev.local`, `pass`). Przypadek
wymaga konta **edukatora** (tylko ten typ konta wchodzi na `/edu`) z rolą organizacyjną
**teacher** (tylko ta rola dostaje `group.manage`, czyli przycisk „Nowa grupa”), w
organizacji na planie **Launch** (`plan_limits.max_groups = 3`).

```bash
bun scripts/qa-tenant.ts EDU-GRP-04 --fresh
```

- Profil w `qa/tests/profiles/EDU-GRP-04.json`: `{"profile":"org-limit","plan":"launch"}`.
  Profil `content` nie wystarcza: enroluje konto edukatora z rolą org `member`, więc
  `/edu/groups` nie pokazuje akcji zapisu. `org-limit` jako jedyny nadaje kontu `teacher`
  rolę organizacyjną `teacher` (i ma o jednego członka mniej niż limit planu — dla licznika
  grup to bez znaczenia).
- Klucz tenanta: `tenantKey('qa/cases/EDU-GRP-04.md', 'EDU-GRP-04#<run>', 'qa-shared')` +
  `tenantId` dla org/członkowie/grupy, ten sam schemat co fixture'y e2e. `--fresh` daje
  każdemu niezależnemu przebiegowi świeżą organizację, a identyfikatory pozostają
  deterministyczne w obrębie przebiegu.
- Mapowanie starego seeda: T1 → `users.teacher` (konto edukatora, rola org `teacher`,
  właściciel tworzonych grup); `users.manager` jest adminem organizacji, a
  `users.teacher2`/`users.student` to dodatkowe etaty, których licznik grup nie dotyczy.
- Organizacja: plan `launch` (`max_groups = 3`), domyślna grupa `G1` (4 członków,
  1 nauczyciel). Przypadek mówi o dwóch istniejących grupach (O1G1, O1G2); seeder tworzy
  dokładnie jedną grupę domyślną, więc `G1` odpowiada pierwszej z nich, a drugą tworzy
  spec — dzięki temu trzecia grupa mieści się w limicie, a czwarta jest odrzucana.
- Spec: `qa/tests/EDU/EDU-GRP-04.spec.ts`, projekt `qa/playwright.qa.config.ts`, baseURL
  `http://localhost:3010`, `NEXT_LOCALE=pl`.
- Izolacja: test czyta i zapisuje wyłącznie organizację tenanta i grupy utworzone przez
  jego konto `teacher`; nie dotyka flag funkcji, katalogu planów, ustawień admina ani
  wierszy singletonowych. Własne grupy testowe sprząta na starcie, więc powtórzenie na tym
  samym tenancie (CI: `--repeat-each`/`--retries`) startuje od tego samego stanu.

## Observed during the suite walk (qa-env-7, shared app 3010 / DB 54421, pl)

- `/edu/groups` otwiera się z sidebara `/edu` („Grupy”, widoczne tylko gdy rola
  organizacyjna ma `group.manage`). Pierwsze wejście deep-linkiem tuż po logowaniu przez
  API potrafi odpowiedzieć `403` zanim aktywna organizacja się ustali, dlatego spec wchodzi
  przez `/edu` i klika „Grupy”.
- Strona pokazuje nagłówek/kartę „Grupy”, przycisk „Nowa grupa” i tabelę z kolumnami
  **Nazwa / Członkowie / Nauczyciele / Akcje**. Seedowana `G1` renderuje 4 / 1; grupy
  utworzone przez nauczyciela renderują 0 / 0 i mają akcje edycji/usunięcia (są jego
  własne), a `G1` — nie (należy do admina).
- „Nowa grupa” otwiera dialog „Utwórz grupę” z polami „Nazwa”, „Opis” i przyciskami
  „Anuluj” / „Utwórz”. Nazwa krótsza niż 3 znaki jest odrzucana po stronie klienta bez
  żądania do API.
- Grupa 2 i grupa 3 powstają: `POST /api/v1/organization/groups` → **201**, toast „Grupa
  utworzona”, wiersz pojawia się od razu z 0 / 0.
- Czwarta próba: `POST /api/v1/organization/groups` → **429**
  `{"success":false,"error":"USAGE_LIMIT_EXCEEDED"}`, toast „Nie udało się utworzyć grupy”,
  dialog pozostaje otwarty z wpisaną nazwą, a lista nadal ma 3 grupy. Limit pochodzi z planu
  organizacji (Launch, `max_groups = 3`), nie z osobistego planu nauczyciela (Lite,
  `max_groups = 1`), który zablokowałby już drugą grupę.
