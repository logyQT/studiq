# LIM-03 — Wyższy limit po zakupie planu

- id: LIM-03
- priority: P2 ważny
- module: LIM – Funkcje (feature flags) i limity planów
- section: Egzekwowanie limitów
- prereqs: LIM-02
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Po LIM-02 (limity Base obniżone do 2). Konto TS.

## Prerequisite context

### LIM-02 — Egzekwowanie limitów – w małej skali (obniżone wartości)
_Warunek wstępny: Konto TS (test-student@dev.local, plan Base, brak treści). Dostęp do Supabase Studio: http://127.0.0.1:54323 → SQL Editor. Na koniec zrób bunx supabase db reset, aby przywrócić limity._
1. W SQL Editor wykonaj: update plan_limits set limit_value = 2 where plan_key = 'base' and limit_key in ('max_decks', 'max_flashcards', 'max_questions', 'max_question_banks');
2. Jako TS utwórz 2 talie, następnie spróbuj utworzyć 3. talię.
3. W jednej talii dodaj 2 fiszki, następnie spróbuj dodać 3. (ręcznie).
4. Utwórz 2 banki pytań i spróbuj utworzyć 3. bank.
5. W jednym banku utwórz 2 pytania i spróbuj dodać 3.

Expected:
- Talie, fiszki i pytania: trzeci element jest odrzucony błędem limitu (USAGE_LIMIT_EXCEEDED / HTTP 429) z czytelnym komunikatem w interfejsie, a nie białym ekranem.
- Banki pytań: z kodu wynika, że limit max_question_banks NIE jest egzekwowany (tylko wyświetlany) – jeśli 3. bank da się utworzyć, zgłoś jako obserwację.

## Steps

1. Kup plan Spark (BIL-03).
2. Spróbuj utworzyć 3. talię.

## Expected result

- Po zakupie obowiązuje limit planu Spark (talie: 50) – 3. talia powstaje bez błędu. Strona rozliczeń pokazuje nowe limity.
