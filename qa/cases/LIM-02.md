# LIM-02 — Egzekwowanie limitów – w małej skali (obniżone wartości)

- id: LIM-02
- priority: P1 krytyczny
- module: LIM – Funkcje (feature flags) i limity planów
- section: Egzekwowanie limitów
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Konto TS (test-student@dev.local, plan Base, brak treści). Dostęp do Supabase Studio: http://127.0.0.1:54323 → SQL Editor. Na koniec zrób bunx supabase db reset, aby przywrócić limity.

## Steps

1. W SQL Editor wykonaj: update plan_limits set limit_value = 2 where plan_key = 'base' and limit_key in ('max_decks', 'max_flashcards', 'max_questions', 'max_question_banks');
2. Jako TS utwórz 2 talie, następnie spróbuj utworzyć 3. talię.
3. W jednej talii dodaj 2 fiszki, następnie spróbuj dodać 3. (ręcznie).
4. Utwórz 2 banki pytań i spróbuj utworzyć 3. bank.
5. W jednym banku utwórz 2 pytania i spróbuj dodać 3.

## Expected result

- Talie, fiszki i pytania: trzeci element jest odrzucony błędem limitu (USAGE_LIMIT_EXCEEDED / HTTP 429) z czytelnym komunikatem w interfejsie, a nie białym ekranem.
- Banki pytań: z kodu wynika, że limit max_question_banks NIE jest egzekwowany (tylko wyświetlany) – jeśli 3. bank da się utworzyć, zgłoś jako obserwację.
