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
