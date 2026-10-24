# MGR-ROL-02 — Tworzenie i edycja roli – plan z role.builder

- id: MGR-ROL-02
- priority: P2 ważny
- module: MGR – Panel managera organizacji (/manage)
- section: Role (/manage/roles)
- prereqs: BIL-04
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Włącz role.builder dla organizacji (override w adminie lub plan Hub: BIL-04).

## Prerequisite context

### BIL-04 — Zakup planu organizacji przez managera
_Warunek wstępny: manager@dev.local, organizacja WSB Merito (Launch)._
1. Wejdź na /pricing/org i wybierz „Hub” → zakup (checkout z kartą testową).
2. Po zakupie sprawdź /manage/settings (branding) i /manage/roles.

Expected:
- Zakup przechodzi (komunikaty jak w BIL-03).
- WERYFIKUJ I ZGŁOŚ: z kodu wynika, że symulowany webhook zmienia wyłącznie plan OSOBISTY użytkownika (profiles.personal_plan_key), a NIE plan organizacji. Oczekiwane (zgodnie ze specyfikacją): organizacja przechodzi na Hub i odblokowuje branding oraz kreator ról. Jeśli po zakupie organizacja nadal ma Launch (karta blokady brandingu widoczna), zgłoś jako defekt funkcjonalny.

## Steps

1. Utwórz rolę „Asystent”.
2. Edytuj jej nazwę i opis.

## Expected result

- Toasty „Rola utworzona”, „Rola zaktualizowana”; typ „Niestandardowa”.
