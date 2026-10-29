# SEC-10 — XSS w polach tekstowych

- id: SEC-10
- priority: P1 krytyczny
- module: SEC – Autoryzacja i izolacja danych
- section: Walidacja wejścia i odporność
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Dowolne konto z prawem tworzenia treści.

## Prerequisite context (tenant model)

„Dowolne konto z prawem tworzenia treści” to w automatyzacji cały tenant tego
przypadku: konto managera (organizacja, opis grupy), konto nauczyciela (talie, fiszki,
banki pytań, kartkówki) oraz konto studenta (lista i podgląd treści, sesja nauki,
odpowiedź w kartkówce, zgłoszenie). Wszystkie trzy konta należą do jednej organizacji z
grupą `G1`, więc payloady przechodzą przez wszystkie cztery powierzchnie z kroku 4:
listę, podgląd, sesję nauki i widok nauczyciela.

## Seed (QA-suite tenant)

Automatyzacja nie używa kont ręcznego seeda (`teacher1@dev.local`, hasło `pass`).
Przypadek dostaje własny tenant seedowany przez `scripts/qa-tenant.ts` ze wspólnych
helperów e2e (`__tests__/helpers/tenant-seed.ts`), z nowym sufiksem przebiegu przy
każdym niezależnym uruchomieniu:

```bash
bun scripts/qa-tenant.ts SEC-10 --fresh
```

- Profil tenanta: `__tests__/qa/profiles/SEC-10.json` = `"content"` — organizacja
  `qa-sec-10-<suffix>`, domyślna grupa `G1`, konto `manager` (rola organizacji
  `admin`), konto `teacher` (typ `educator`) i konto `student`; hasło `Seed4Test!`.
- Klucz tenanta: `qa/cases/SEC-10.md::SEC-10#<run>::qa-shared`
  (`tenantKey('qa/cases/SEC-10.md', 'SEC-10#<run>', 'qa-shared')` + `tenantId` dla
  każdego id) — ten sam schemat co fixture'y e2e, bez nowych, ręcznie wpisanych UUID.
- Manager dopisuje nauczyciela jako `teacher` grupy `G1` przez
  `PUT /api/v1/organization/groups/<id>/members` (udostępnianie treści do grupy wymaga
  roli nauczyciela tej grupy) i wpisuje `<script>alert(1)</script>` w opis grupy
  (`PUT /api/v1/organization/groups/<id>`).
- Nauczyciel tworzy przez API: talię o nazwie `<img src=x onerror=alert(1)>` z jedną
  fiszką, której przód to Markdown `<script>alert(1)</script>` +
  `[klik](<javascript:alert(1)>)`; bank pytań o nazwie `<script>alert(1)</script>` z
  pytaniem otwartym. Wszystkie treści mają widoczność `group` dla `G1`.
- Kartkówka: nauczyciel tworzy assignment z pytaniem otwartym, ustawia cel `G1` i
  publikuje; student odpowiada tekstem `<script>alert(1)</script>`, a nauczyciel
  ogląda odpowiedź na `/edu/assignments/<id>/results/<studentId>`.
- Zgłoszenie: student tworzy zgłoszenie pytania z wiadomością
  `<img src=x onerror=alert(1)>`; nauczyciel ogląda wątek na `/edu/reports/<id>`.
- Żaden globalny wiersz (ustawienia admina, flagi funkcji, plany, statystyki, singletony)
  nie jest zapisywany; specyfikacja dotyka wyłącznie wierszy własnego tenanta.

## Steps

1. Utwórz talię o nazwie <img src=x onerror=alert(1)>.
2. Utwórz fiszkę z treścią Markdown zawierającą <script>alert(1)</script> oraz [klik](<javascript:alert(1)>).
3. Wpisz skrypt w opisie grupy, nazwie bankowi, odpowiedzi w kartkówce i wiadomości zgłoszenia.
4. Wyświetl wszystkie te elementy (listy, podgląd, sesja nauki, widok nauczyciela).

## Expected result

- Treści wyświetlają się jako tekst; skrypty nie wykonują się; link javascript: nie jest aktywny.
- Brak okien alert().

## Observed during the suite walk (shared app 3010 / DB 54421, pl)

- Nazwa talii (`<img src=x onerror=alert(1)>`), nazwa banku
  (`<script>alert(1)</script>`), opis grupy i wiadomość zgłoszenia są renderowane jako
  zwykły tekst (escapowanie Reacta): payload jest widoczny dosłownie, a w DOM nie ma
  elementu `img[src="x"]` ani atrybutu `onerror`.
- Markdown fiszki jest sanitizowany (`MarkdownRenderer` → `rehype-raw` +
  `rehype-sanitize`): element `<script>` jest w całości usuwany z wyniku, a link
  `[klik](<javascript:alert(1)>)` renderuje się jako `<a>` **bez atrybutu `href`**, więc
  URL `javascript:` jest nieaktywny. Dotyczy to podglądu talii oraz sesji nauki
  (`/app/study/session/cram?deckId=<id>`).
- Odpowiedź w kartkówce w widoku nauczyciela pokazuje się jako tekst
  „Odpowiedź ucznia: <script>alert(1)</script>” (ICU `text_answer`), bez wykonania
  skryptu.
- Na żadnej z powierzchni nie pojawiło się okno `alert()`; w DOM nie występują
  wykonywalne elementy z payloadem ani linki `javascript:`.
