# EDU-DECK-07 — Udostępnienie talii grupie daje tylko odczyt

- id: EDU-DECK-07
- priority: P1 krytyczny
- module: EDU – Panel nauczyciela (/edu)
- section: Talie i fiszki nauczyciela
- prereqs: none
- source: issue #961 (decyzja operatora 2026-11-27)

## Steps

1. Nauczyciel tworzy talię i udostępnia ją grupie G1.
2. Student — członek G1 z rolą własną, która ma tylko odczyt — otwiera listę talii i
   udostępnioną talię. Sprawdza menu talii, zawiesza talię i przywraca ją.
3. Student próbuje zmienić talię i jej fiszki: `PUT` talii, `DELETE` talii, `POST`
   fiszki do talii i `PUT` fiszki.
4. Manager otwiera edytor ról dla roli studenta i sprawdza wiersz „Edytuj talię”.
   Następnie wysyła pełny payload katalogu z `deck.update` w zakresie „Grupa”.
5. Manager organizacji, który nie jest autorem talii, otwiera szczegóły talii
   nauczyciela i zmienia jej nazwę.

## Expected result

- Krok 2 (kontrola): student widzi udostępnioną talię i jej fiszki. Nie widzi
  osobistej talii nauczyciela. W menu talii nie ma „Edytuj” ani „Usuń”, a w talii
  nie ma przycisku „Nowa Fiszka”. „Zawieś talię” jest dostępne i działa: pojawia
  się komunikat „Ta talia jest zawieszona…”, a „Przywróć talię” wraca do stanu
  wyjściowego. Zawieszenie to preferencja użytkownika, nie zapis treści, więc
  serwer wymaga tylko odczytu.
- Krok 3 (kontrola): API odmawia każdym zapisem kodem 403. Odczyt talii i fiszek
  działa (200). Ten krok nie dowodzi zakazu „Grupa”: rola studenta ma wyłącznie
  odczyty, więc odmowa wynika z braku uprawnienia, a nie z zakresu.
- Krok 4 (asercja rozstrzygająca): wiersz „Edytuj talię” ma tylko „Własne” i
  „Organizacja” — brak opcji „Grupa”. Zapis z `deck.update: group` odpowiada 422,
  a odczyt roli nadal nie zawiera `deck.update`. Ten krok zawodzi, gdy zakaz
  „Grupa” dla zapisów treści zostanie cofnięty.
- Krok 5: manager widzi „Edytuj” i „Usuń”, a `PUT` talii odpowiada 200 i zmienia
  nazwę. Uprawnienie `organization` roli Admina to świadoma władza w całej
  organizacji, nie udostępnianie.

## QA tenant fixture (reconciled)

Profil `{ "profile": "content", "plan": "hub" }`: jedna organizacja na planie Hub,
manager (Admin), nauczyciel i student oraz domyślna grupa `G1`.

Spec tworzy w czasie działania, przez API produktu i tylko w tej organizacji:

- rolę własną z szablonu `blank`, z `deck.read` i `flashcard.read` w zakresie
  `group`, i przypisuje ją studentowi;
- awans nauczyciela na `teacher` w `G1` (udostępnienie talii grupie wymaga
  nauczyciela grupy);
- talię grupową z jedną fiszką oraz osobistą talię nauczyciela.

Nic globalnego nie jest zapisywane: żadne ustawienie administracyjne, flaga
funkcji, plan, statystyka platformy ani wiersz singletonu.
