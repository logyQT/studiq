# ONB-08 — Rejestracja z zaproszenia – ścieżka poprawna

- id: ONB-08
- priority: P2 ważny
- module: ONB – Onboarding, organizacje i zaproszenia
- section: Zaproszenie przez link (/join?token=…)
- prereqs: MGR-INV-01
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Wygenerowane zaproszenie dla nowego e-maila (MGR-INV-01). Skopiowany „link zaproszenia”.

## Prerequisite context

### MGR-INV-01 — Wysłanie zaproszenia z rolą

_Warunek wstępny: M1, WSB Merito (4/5 członków)._

1. Otwórz /manage/invites.
2. Wpisz e-mail invite1@example.com, wybierz rolę „member”.
3. Kliknij „Wyślij zaproszenia”.
4. W sekcji „Wyniki” kliknij „Kopiuj link”.

Expected:

- Toast „Wysłano 1 zaproszeń.”; w sekcji „Wyniki” plakietka „Sukces” i przycisk „Kopiuj link” (toast „Skopiowano!”).
- W tabeli „Wysłane zaproszenia” nowe zaproszenie ze statusem „Oczekujące”.
- W Inbucket brak wiadomości lub wiadomość z linkiem (zanotuj – jeżeli mail nie jest wysyłany, link kopiowany ręcznie).

## Seed (QA-suite tenant)

Automatyzacja nie używa ręcznego seeda (`manager@dev.local`, `invite1@example.com`, `pass`).
Przypadek potrzebuje managera z organizacją (rola `admin`) i miejscem na nowego członka:

```bash
bun scripts/qa-tenant.ts ONB-08 --profile content --fresh
```

- Klucz tenanta: `ONB-08.md::ONB-08#<run>::qa-shared` —
  `tenantKey('qa/cases/ONB-08.md', 'ONB-08#<run>', 'qa-shared')` + `tenantId`, ten sam schemat
  co fixture'y e2e. `--fresh` nadaje nowy sufiks przebiegu, więc każdy niezależny przebieg
  dostaje własną organizację, managera i unikalny adres zapraszanego.
- Organizacja: `qa-onb-08-<run>` (plan Launch, 3/5 członków: manager + teacher + student).
  Role systemowe `admin` / `teacher` / `member` tworzy trigger organizacji.
- Manager: `seed-manager-<hash>@dev.local` / `Seed4Test!`, `app_metadata.account_type = manager`,
  rola organizacyjna `admin` (ma `member.manage`).
- Zapraszany adres jest pochodną klucza tenanta: `qa+<shortHash(key)>@test.local` — deterministyczny
  w obrębie przebiegu i unikalny między przebiegami, więc konto w współdzielonym auth nigdy nie
  koliduje z innym workerem.
- Worker QA-suite seeduje **wspólną** bazę (`http://localhost:54421`); `scripts/qa-tenant.ts`
  bierze URL z `qa/env.json`, a klucz service role z `apps/web/.env`.
- Spec: `qa/tests/ONB/ONB-08.spec.ts`, projekt `qa/playwright.qa.config.ts`, baseURL
  `http://localhost:3010`, `NEXT_LOCALE=pl` (kopie interfejsu w przypadku są polskie).
- Link aktywacyjny jest odczytywany z catchera poczty wspólnego stacku
  (`qa/fixtures/qa-mail.ts`: `QA_MAIL_URL`, w przeciwnym razie port API Supabase + 3 —
  `54424` na współdzielonym stacku, `54324` w CI; obsługiwane są Mailpit i klasyczny
  Inbucket). Test czyta wyłącznie wiadomość zaadresowaną na swój unikalny adres; nie usuwa
  ani nie zmienia cudzych wiadomości.
- Izolacja: zaproszenie, konto i członkostwo dotyczą tylko organizacji tego tenanta. Test nie
  czyta ani nie zmienia innego tenanta, flag funkcji, planów, ustawień globalnych ani wierszy
  singletonowych.

## Steps

1. W oknie bez sesji otwórz link zaproszenia (/join?token=…).
2. Sprawdź formularz: pola imię i e-mail.
3. Wpisz hasło i kliknij przycisk aktywacji konta.
4. Aktywuj konto linkiem z Inbucket i zaloguj się.

## Expected result

- Najpierw szkielet „Verifying invitation…”, potem formularz: e-mail wstępnie wypełniony i
  zablokowany (tylko do odczytu), imię **edytowalne** — patrz „Odstępstwa” niżej (#309).
- Po zapisaniu toast sukcesu i przejście na /login.
- Nagłówek, opis i przycisk ekranu /join są przetłumaczone („Dołącz do organizacji”,
  „Uzupełnij swoje dane i ustaw hasło, aby aktywować konto.”, „Aktywuj konto”) — brak surowych
  kluczy `RegisterPage.*` (błąd #252 zamknięty).
- Po aktywacji i zalogowaniu użytkownik jest członkiem zapraszającej organizacji z rolą przypisaną
  w zaproszeniu (`member`), a zaproszenie nie pozostaje „Oczekujące”.

## Odstępstwa od dokumentu (decyzje produktowe)

- **Pole „Imię i Nazwisko” jest edytowalne, nie wstępnie wypełnione.** Dokument oczekuje obu pól
  wypełnionych i zablokowanych, ale `invitations` nie przechowuje imienia (kolumna zawsze `NULL`,
  `CreateInviteSchema` go nie przyjmuje). Zgłoszenie #309 („formularz nie pozwala się wysłać”)
  zostało zamknięte przez udostępnienie pola zapraszanemu; test asertuje więc intencję: e-mail
  prefilled+read-only, imię wymagane i edytowalne. Patrz też #311 (akceptacja zaproszenia po
  potwierdzeniu e-maila).

## Observed during the suite walk (qa-env-2, shared app 3010 / DB 54421)

- `/manage/invites`: combobox roli pokazuje nazwy wyświetlane ról systemowych — `member` to
  „Student”. Po wysłaniu: toast „Wysłano 1 zaproszeń.”, wiersz „Wyniki” z plakietką „Sukces”,
  „Kopiuj kod” i „Kopiuj link”, a tabela „Wysłane zaproszenia” pokazuje „Oczekujące”.
- `/join?token=…` w kontekście bez ciasteczek sesji: szkielet „Verifying invitation...” (tekst
  zaszyty w komponencie, niezależny od locale), potem karta „Dołącz do organizacji” z opisem
  „Uzupełnij swoje dane i ustaw hasło, aby aktywować konto.”. Pola: „Imię i Nazwisko” (puste,
  edytowalne), „Adres e-mail” (wypełniony zaproszonym adresem, `readonly`), „Hasło”.
- „Aktywuj konto” → `POST /api/v1/auth/register` **202**; toast „Konto zostało utworzone” +
  „Link aktywacyjny został wysłany. Sprawdź swoją skrzynkę e-mail.”; przejście na `/login`.
- Wiadomość „StudiQ - Confirm Your Email” trafia do Mailpita (`:54424`); link prowadzi do
  `…/auth/callback?token_hash=…&type=signup&next=/login`.
- Po wejściu w link: `/app` z aktywną sesją, `GET /api/v1/me/orgs` zwraca dokładnie jedną
  organizację z `orgRoleName: "member"` i `isActive: true`; po wylogowaniu i ponownym logowaniu
  nowym hasłem członkostwo i rola pozostają.
- `GET /api/v1/organization/invites?isAccepted=true` (manager) zawiera zaproszenie jako
  zaakceptowane — token nie zostaje „Oczekujące”.
