# NFR-02 — Zmiana języka (PL ⇄ EN)

- id: NFR-02
- priority: P1 krytyczny
- module: NFR – Wymagania niefunkcjonalne i międzyobszarowe
- section: Język i motyw
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany użytkownik.

## Steps

1. W menu użytkownika (avatar w nagłówku albo menu w pasku bocznym) odszukaj **jeden** wiersz
   „Język” z aktualną nazwą języka po prawej (np. „Język  Polski ›”) i go otwórz — menu się
   zamyka, a w tym samym miejscu otwiera się panel „Język” z polem „Szukaj języka lub kodu…”.
2. W panelu sprawdź, że aktualny język ma znacznik ✓ i dopisek dla czytnika ekranu, wpisz `eng`
   (albo `english` / `en`), a następnie wybierz „English” klawiszem Enter lub kliknięciem.
3. Wróć do panelu i wybierz „Polski” (`pl` / `polski`).
4. Powtórz na stronach publicznych, np. na `/pricing`: w stopce przycisk „Język: Polski” otwiera
   **ten sam** panel (tylko do góry).
5. Sprawdź wyszukiwanie bez wyników: wpisz `zzz`, a potem użyj „Wyczyść”.
6. Na wąskim ekranie (390×844) otwórz menu hamburger: wiersz „Język” rozwija panel **w miejscu**
   (bez drugiego okna), a arkusz pozostaje otwarty.
7. Przełącz język na głębokiej podstronie (np. `/app/stats/content`) i sprawdź adres oraz pozycję
   przewinięcia; następnie odśwież stronę (F5).

## Expected result

- Język jest **jednym, opisanym kontrolnym elementem** („Język” + aktualna nazwa), a nie dwoma
  osobnymi pozycjami menu. W panelu widać flagę (dekoracyjną) i pełną nazwę języka — nigdy samą
  flagę.
- Lista języków jest rozwijana i przeszukiwalna po nazwie oraz kodzie (`angielski`, `english`,
  `pl`, `en`); przy braku dopasowania pojawia się „Brak pasującego języka” z podpowiedzią i
  działającym przyciskiem „Wyczyść”.
- Po wybraniu języka treść zmienia się **bez przeładowania strony**: adres i pozycja przewinięcia
  pozostają, fokus wraca na element, który otworzył panel. Ciasteczko `NEXT_LOCALE` jest ważne rok.
- Zmiana języka jest komunikowana czytnikowi ekranu **raz**, w języku, w którym użytkownik czytał
  stronę; przy zaznaczonym aktualnym języku widoczny jest ✓.
- Na telefonie wiersz „Język” rozwija panel w miejscu i nie zamyka arkusza menu.
- Wersja angielska nie zawiera polskich fragmentów, a polska – angielskich; liczebniki
  (fiszka/fiszki/fiszek) odmieniają się poprawnie.
- Język jest zapamiętany po ponownym logowaniu i po odświeżeniu strony.
