# SEC-06 — Student/nauczyciel nie zarządza organizacją

- id: SEC-06
- priority: P1 krytyczny
- module: SEC – Autoryzacja i izolacja danych
- section: Uprawnienia ról
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

student1 i teacher1.

## Seed (QA-suite tenant)

Automatyzacja nie używa kont ręcznego seeda (`student1@dev.local`, `teacher1@dev.local`,
hasło `pass`). Przypadek dostaje własny tenant, seedowany przez `scripts/qa-tenant.ts` ze
wspólnych helperów e2e (`__tests__/helpers/tenant-seed.ts`), z nowym sufiksem przebiegu przy
każdym niezależnym uruchomieniu:

```bash
bun scripts/qa-tenant.ts SEC-06 --fresh
```

- Profil `org-limit` + plan `hub` (`__tests__/qa/profiles/SEC-06.json`). `apply_org_plan`
  dotyczy wyłącznie organizacji tego tenanta — nie zmienia katalogu planów, flag funkcji
  ani żadnego wiersza singletonowego.
- Organizacja `qa-sec-06-<suffix>` z domyślną grupą `G1` i czterema członkami: `manager`
  (rola `admin`), `teacher` (typ `educator`, rola `teacher` — odpowiednik `teacher1`),
  drugi nauczyciel oraz `student` (rola `member` — odpowiednik `student1`). Dzięki temu
  odrzucenie nauczyciela nie może być skutkiem tego, że jest tylko członkiem `member`.
- Plan Hub jest częścią warunku przypadku (dokument źródłowy); bramką zapisu ról i
  członków jest uprawnienie (`org.role.manage` / `org.member.manage`), a rola `admin`
  ma je na każdym planie. Admin wykonuje te same operacje (kontrola pozytywna), a
  nauczyciel nie — to jest testowana granica uprawnień.
- Identyfikatory: `tenantKey('qa/cases/SEC-06.md', 'SEC-06#<suffix>', 'qa-shared')` +
  `tenantId(key, entity)`; adresy e-mail i nazwa roli kontrolnej zawierają sufiks przebiegu,
  więc dwa przebiegi nigdy nie kolidują.
- Spec: `__tests__/qa/SEC/SEC-06.spec.ts`, projekt `__tests__/qa/playwright.qa.config.ts`, baseURL
  `http://localhost:3010`, `NEXT_LOCALE=pl`.

## Steps

1. Jako student1: PUT /api/v1/organization/members; POST /api/v1/organization/invites/bulk; POST /api/v1/organization/roles.
2. Jako teacher1: to samo.

## Expected result

- Operacje odrzucone (403) – brak zmian ról/zaproszeń/ról niestandardowych. Od
  2026-11-20 (2b-5) dotyczy to także zaproszenia organizacyjnego z rolą `member` od
  nauczyciela: każde zaproszenie organizacyjne wymaga `org.invitation.manage`
  (sekcja „Zmiana kontraktu” poniżej).

## Observed during the suite walk (qa-env-3, shared app 3010 / DB 54421)

- `student`: `GET /api/v1/me/orgs` → własna organizacja aktywna, `orgRoleName: "member"`;
  `GET /api/v1/auth/me` → `account_type: "student"`. `PUT /organization/members` (poprawne
  ciało i `{}`) → **403 `FORBIDDEN`**; `POST /organization/invites/bulk` (poprawne ciało) →
  **403**; `POST /organization/roles` (poprawne ciało i `{}`) → **403**. Koperta bez `data`,
  nagłówek `x-error-code: FORBIDDEN`. Dla tras z regułą konta 403 przychodzi przed walidacją
  (nie 422).
- `teacher` (typ `educator`, rola organizacyjna `teacher`): `PUT /organization/members`
  (zmiana roli studenta) → **403**; `POST /organization/roles` → **403** (brak
  `org.member.manage` / `org.role.manage` w roli `teacher`); `POST /organization/invites/bulk`
  z rolą `admin` i z rolą `teacher` → **403** (`can_assign_org_role`, #189).
- Brak zmian: wiersze `org_members` (użytkownik → rola) identyczne z baseline, zero
  zaproszeń na adresy użyte w odrzuconych próbach, zero nowych ról niestandardowych.
- Kontrola pozytywna (ten sam tenant, ta sama aktywna organizacja): admin zmienia rolę
  studenta `member` → `teacher` i z powrotem (**200**), wysyła zaproszenie z rolą `member`
  (**200**) i tworzy rolę niestandardową (**201**) — trasy i fixture są sprawne, a 403 to
  granica uprawnień.
- Panel studenta (`/app`) i nauczyciela (`/edu`) nadal się ładuje — brak over-block.
- **2026-11-20 (2b-5)**: `POST /organization/invites/bulk` wymaga teraz
  `org.invitation.manage` dla każdej roli — także `member`; wyjątek nazwy roli
  `teacher` w `can_assign_org_role` został usunięty (ADR-0015 §4.3, §10), więc
  nauczyciel dostaje **403** również przy roli `member`. Ścieżką klasową nauczyciela
  jest zaproszenie klasowe na grupie, którą prowadzi (`group.invite`).

### Zmiana kontraktu 2026-11-20 (2b-5) — nauczyciel nie wysyła zaproszeń organizacyjnych

Poprzedni przebieg (qa-env-3) odnotował tu odstępstwo od dosłownego kroku 2: nauczyciel
organizacyjny **mógł** wysłać zaproszenie z rolą `member`, bo `can_assign_org_role`
celowo pozwalał roli `teacher` nadawać wyłącznie systemową rolę `member`, a odmawiał
ról `admin` / `teacher` (#189). **Od 2026-11-20 (2b-5) ten wyjątek jest usunięty**
(ADR-0015 §4.3, §10; kontrola w `__tests__/integration/invitations.test.ts`):
zaproszenie **organizacyjne** wymaga `org.invitation.manage` na dowolną rolę, więc
nauczyciel organizacyjny dostaje **403** także przy roli `member`. Ścieżką klasową
nauczyciela jest **zaproszenie klasowe** na grupie, którą prowadzi (wymaga
`group.invite` na tej grupie), a nie zaproszenie organizacyjne. Zakres przypadku
„nauczyciel nie zarządza organizacją” obejmuje więc także wszystkie zaproszenia
organizacyjne — i te operacje są odrzucane. Spec asertuje kontrolę „brak over-block”
dla ścieżki zaproszeń jako zaproszenie z rolą `member` wysłane przez **admina**
organizacji (kontrola pozytywna powyżej), a nie przez nauczyciela.
