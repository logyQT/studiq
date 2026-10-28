# Scenario index — 215 cases

Prerequisite ids are greppable: `grep -n "EDU-DECK-03" index.md`.
Full steps live in `cases/<ID>.md` (Polish, verbatim). Read the case **and** every id in its Prereqs column.

| ID          | Prio           | Title                                                                | Prereqs     | Module                                              |
| ----------- | -------------- | -------------------------------------------------------------------- | ----------- | --------------------------------------------------- |
| PUB-01      | P1 krytyczny   | Strona główna – wygląd i treść (niezalogowany)                       | —           | PUB – Strony publiczne i nawigacja ogólna           |
| PUB-02      | P2 ważny       | Strona „Funkcje” (/features)                                         | —           | PUB – Strony publiczne i nawigacja ogólna           |
| PUB-03      | P1 krytyczny   | Strona „Cennik” (/pricing) – kafelki typów kont                      | —           | PUB – Strony publiczne i nawigacja ogólna           |
| PUB-04      | P2 ważny       | Podstrona planów (/pricing/student) – karty planów                   | —           | PUB – Strony publiczne i nawigacja ogólna           |
| PUB-05      | P3 kosmetyczny | Strona Kontakt (/contact)                                            | —           | PUB – Strony publiczne i nawigacja ogólna           |
| PUB-06      | P3 kosmetyczny | Polityka prywatności i Regulamin                                     | —           | PUB – Strony publiczne i nawigacja ogólna           |
| PUB-07      | P2 ważny       | Strona 404 (niezalogowany)                                           | —           | PUB – Strony publiczne i nawigacja ogólna           |
| PUB-08      | P2 ważny       | 404 wewnątrz paneli (student / nauczyciel / manager)                 | —           | PUB – Strony publiczne i nawigacja ogólna           |
| AUT-01      | P1 krytyczny   | Rejestracja studenta – ścieżka poprawna                              | —           | AUT – Uwierzytelnianie i sesja                      |
| AUT-02      | P2 ważny       | Rejestracja nauczyciela i managera                                   | —           | AUT – Uwierzytelnianie i sesja                      |
| AUT-03      | P2 ważny       | Walidacja hasła – reguły                                             | —           | AUT – Uwierzytelnianie i sesja                      |
| AUT-04      | P2 ważny       | Walidacja imienia i nazwiska                                         | —           | AUT – Uwierzytelnianie i sesja                      |
| AUT-05      | P2 ważny       | Rejestracja na istniejący e-mail                                     | —           | AUT – Uwierzytelnianie i sesja                      |
| AUT-06      | P2 ważny       | Brak aktywacji konta uniemożliwia logowanie                          | —           | AUT – Uwierzytelnianie i sesja                      |
| AUT-07      | P1 krytyczny   | Logowanie – każdy typ konta i przekierowanie                         | —           | AUT – Uwierzytelnianie i sesja                      |
| AUT-08      | P1 krytyczny   | Logowanie – niepoprawne dane                                         | —           | AUT – Uwierzytelnianie i sesja                      |
| AUT-09      | P2 ważny       | Logowanie – parametr next (powrót do żądanej strony)                 | —           | AUT – Uwierzytelnianie i sesja                      |
| AUT-10      | P2 ważny       | Logowanie – próba przekierowania na zewnętrzny adres (open redirect) | —           | AUT – Uwierzytelnianie i sesja                      |
| AUT-11      | P2 ważny       | Zalogowany użytkownik na /login i /register                          | —           | AUT – Uwierzytelnianie i sesja                      |
| AUT-12      | P1 krytyczny   | Zapomniane hasło – wysłanie linku                                    | —           | AUT – Uwierzytelnianie i sesja                      |
| AUT-13      | P2 ważny       | Ustawienie nowego hasła z linku                                      | AUT-12      | AUT – Uwierzytelnianie i sesja                      |
| AUT-14      | P1 krytyczny   | Wylogowanie                                                          | —           | AUT – Uwierzytelnianie i sesja                      |
| AUT-15      | P1 krytyczny   | Niezalogowany → trasy chronione                                      | —           | AUT – Uwierzytelnianie i sesja                      |
| AUT-16      | P1 krytyczny   | Student → trasy innych ról                                           | —           | AUT – Uwierzytelnianie i sesja                      |
| AUT-17      | P1 krytyczny   | Nauczyciel → trasy innych ról                                        | —           | AUT – Uwierzytelnianie i sesja                      |
| AUT-18      | P1 krytyczny   | Manager → trasy innych ról                                           | —           | AUT – Uwierzytelnianie i sesja                      |
| AUT-19      | P1 krytyczny   | API bez sesji i z niewłaściwą rolą                                   | —           | AUT – Uwierzytelnianie i sesja                      |
| ONB-01      | P2 ważny       | Nauczyciel bez organizacji → /setup                                  | —           | ONB – Onboarding, organizacje i zaproszenia         |
| ONB-02      | P1 krytyczny   | Utworzenie klasy (bez zaproszeń)                                     | ONB-01      | ONB – Onboarding, organizacje i zaproszenia         |
| ONB-03      | P2 ważny       | Dołączenie nauczyciela do istniejącej organizacji kodem              | —           | ONB – Onboarding, organizacje i zaproszenia         |
| ONB-04      | P2 ważny       | Manager bez organizacji → /setup/org                                 | —           | ONB – Onboarding, organizacje i zaproszenia         |
| ONB-05      | P2 ważny       | Student bez organizacji (S3)                                         | —           | ONB – Onboarding, organizacje i zaproszenia         |
| ONB-06      | P2 ważny       | Student – dołączenie do klasy kodem (/app/join)                      | MGR-INV-01  | ONB – Onboarding, organizacje i zaproszenia         |
| ONB-07      | P1 krytyczny   | Przełączanie organizacji (M1 / T1)                                   | —           | ONB – Onboarding, organizacje i zaproszenia         |
| ONB-08      | P2 ważny       | Rejestracja z zaproszenia – ścieżka poprawna                         | MGR-INV-01  | ONB – Onboarding, organizacje i zaproszenia         |
| ONB-09      | P2 ważny       | /join – brak tokenu, zły token, wygasły token                        | —           | ONB – Onboarding, organizacje i zaproszenia         |
| ONB-10      | P1 krytyczny   | Limit członków organizacji przy akceptacji zaproszeń                 | —           | ONB – Onboarding, organizacje i zaproszenia         |
| STU-01      | P1 krytyczny   | Pulpit studenta – widok i statystyki                                 | —           | STU – Panel studenta (/app)                         |
| STU-02      | P2 ważny       | Checklista „Pierwsze kroki” (student)                                | —           | STU – Panel studenta (/app)                         |
| STU-03      | P2 ważny       | Menu boczne studenta                                                 | —           | STU – Panel studenta (/app)                         |
| STU-04      | P2 ważny       | Strona „Ucz się” – stan z fiszkami do powtórki                       | —           | STU – Panel studenta (/app)                         |
| STU-05      | P1 krytyczny   | Sesja nauki – ocena fiszek (ścieżka pełna)                           | —           | STU – Panel studenta (/app)                         |
| STU-06      | P2 ważny       | Sesja nauki – skróty klawiaturowe                                    | —           | STU – Panel studenta (/app)                         |
| STU-07      | P1 krytyczny   | Harmonogram powtórek zmienia się po ocenie                           | —           | STU – Panel studenta (/app)                         |
| STU-08      | P2 ważny       | Wkuwanie wybranej talii                                              | —           | STU – Panel studenta (/app)                         |
| STU-09      | P1 krytyczny   | Wygenerowanie i rozwiązanie quizu                                    | —           | STU – Panel studenta (/app)                         |
| STU-10      | P2 ważny       | Quiz – wznowienie niedokończonego                                    | —           | STU – Panel studenta (/app)                         |
| STU-11      | P1 krytyczny   | Przegląd wyniku quizu (review)                                       | —           | STU – Panel studenta (/app)                         |
| STU-12      | P2 ważny       | Historia quizów                                                      | —           | STU – Panel studenta (/app)                         |
| STU-13      | P3 kosmetyczny | Strona „Na żywo” (funkcja w przygotowaniu)                           | —           | STU – Panel studenta (/app)                         |
| STU-14      | P2 ważny       | Lista talii – widok i filtry własności                               | —           | STU – Panel studenta (/app)                         |
| STU-15      | P1 krytyczny   | Utworzenie talii                                                     | —           | STU – Panel studenta (/app)                         |
| STU-16      | P2 ważny       | Edycja talii                                                         | STU-15      | STU – Panel studenta (/app)                         |
| STU-17      | P2 ważny       | Zawieszanie talii                                                    | —           | STU – Panel studenta (/app)                         |
| STU-18      | P2 ważny       | Usunięcie talii                                                      | —           | STU – Panel studenta (/app)                         |
| STU-19      | P1 krytyczny   | Import talii/fiszek z CSV (lista talii)                              | —           | STU – Panel studenta (/app)                         |
| STU-20      | P2 ważny       | Import CSV – błędne dane                                             | —           | STU – Panel studenta (/app)                         |
| STU-21      | P1 krytyczny   | Tworzenie fiszki – edytor Markdown                                   | —           | STU – Panel studenta (/app)                         |
| STU-22      | P2 ważny       | Multimedia na fiszce (obraz/audio)                                   | —           | STU – Panel studenta (/app)                         |
| STU-23      | P2 ważny       | Edycja fiszki                                                        | —           | STU – Panel studenta (/app)                         |
| STU-24      | P2 ważny       | Tematy fiszki – dodawanie i usuwanie                                 | —           | STU – Panel studenta (/app)                         |
| STU-25      | P2 ważny       | Połączenie fiszki z inną talią (link)                                | —           | STU – Panel studenta (/app)                         |
| STU-26      | P2 ważny       | Kopiowanie fiszki do innej talii                                     | —           | STU – Panel studenta (/app)                         |
| STU-27      | P2 ważny       | Usuwanie fiszki                                                      | —           | STU – Panel studenta (/app)                         |
| STU-28      | P2 ważny       | Operacje zbiorcze na fiszkach                                        | —           | STU – Panel studenta (/app)                         |
| STU-29      | P1 krytyczny   | Fiszka z talii nauczyciela – tylko do odczytu                        | —           | STU – Panel studenta (/app)                         |
| STU-30      | P2 ważny       | Tworzenie, edycja, usunięcie tematu                                  | —           | STU – Panel studenta (/app)                         |
| STU-31      | P2 ważny       | Lista banków pytań studenta                                          | —           | STU – Panel studenta (/app)                         |
| STU-32      | P2 ważny       | Własny bank i własne pytania                                         | —           | STU – Panel studenta (/app)                         |
| STU-33      | P2 ważny       | Edycja i usuwanie pytania / banku                                    | —           | STU – Panel studenta (/app)                         |
| STU-34      | P2 ważny       | Lista kartkówek                                                      | —           | STU – Panel studenta (/app)                         |
| STU-35      | P1 krytyczny   | Rozwiązanie kartkówki od startu do wysłania                          | —           | STU – Panel studenta (/app)                         |
| STU-36      | P2 ważny       | Kartkówka – maks. liczba prób                                        | —           | STU – Panel studenta (/app)                         |
| STU-37      | P2 ważny       | Podsumowanie wyników kartkówki                                       | —           | STU – Panel studenta (/app)                         |
| STU-38      | P2 ważny       | Kartkówka cudzej grupy – brak dostępu                                | —           | STU – Panel studenta (/app)                         |
| STU-39      | P2 ważny       | Zgłoszenie błędnej fiszki                                            | —           | STU – Panel studenta (/app)                         |
| STU-40      | P2 ważny       | Wątek zgłoszenia – odpowiedzi                                        | EDU-REP-02  | STU – Panel studenta (/app)                         |
| STU-41      | P2 ważny       | Licznik nieprzeczytanych zgłoszeń                                    | —           | STU – Panel studenta (/app)                         |
| STU-42      | P2 ważny       | Statystyki – „Treści” (/app/stats/content)                           | STU-05      | STU – Panel studenta (/app)                         |
| STU-43      | P2 ważny       | Statystyki – „Wyniki” (quizy)                                        | —           | STU – Panel studenta (/app)                         |
| STU-44      | P2 ważny       | Statystyki – „Aktywność” (/app/stats/activity)                       | —           | STU – Panel studenta (/app)                         |
| STU-45      | P2 ważny       | Dostęp do AI zależny od planu                                        | —           | STU – Panel studenta (/app)                         |
| STU-46      | P2 ważny       | Włączenie AI przez administratora (flaga/override)                   | —           | STU – Panel studenta (/app)                         |
| STU-47      | P2 ważny       | Czat AI – podstawowa rozmowa                                         | —           | STU – Panel studenta (/app)                         |
| STU-48      | P2 ważny       | Czat AI – generowanie fiszek i zapis do talii                        | —           | STU – Panel studenta (/app)                         |
| STU-49      | P2 ważny       | Generator fiszek z PDF (AI)                                          | —           | STU – Panel studenta (/app)                         |
| STU-50      | P2 ważny       | Zmiana nazwy                                                         | —           | STU – Panel studenta (/app)                         |
| STU-51      | P2 ważny       | Zmiana hasła w koncie                                                | —           | STU – Panel studenta (/app)                         |
| STU-52      | P3 kosmetyczny | Historia płatności                                                   | —           | STU – Panel studenta (/app)                         |
| STU-53      | P3 kosmetyczny | Powiadomienia (funkcja niezaimplementowana)                          | —           | STU – Panel studenta (/app)                         |
| EDU-01      | P2 ważny       | Pulpit nauczyciela (/edu)                                            | —           | EDU – Panel nauczyciela (/edu)                      |
| EDU-02      | P2 ważny       | Menu boczne nauczyciela                                              | —           | EDU – Panel nauczyciela (/edu)                      |
| EDU-DECK-01 | P2 ważny       | Hub fiszek (/edu/flashcards)                                         | —           | EDU – Panel nauczyciela (/edu)                      |
| EDU-DECK-02 | P1 krytyczny   | Utworzenie talii dla grupy                                           | —           | EDU – Panel nauczyciela (/edu)                      |
| EDU-DECK-03 | P2 ważny       | Zmiana widoczności talii: Tylko ja ⇄ Grupy                           | EDU-DECK-02 | EDU – Panel nauczyciela (/edu)                      |
| EDU-DECK-04 | P2 ważny       | Fiszki w talii nauczyciela – CRUD                                    | EDU-DECK-02 | EDU – Panel nauczyciela (/edu)                      |
| EDU-DECK-05 | P2 ważny       | Przycisk „Twórz z Agentem” (AI)                                      | —           | EDU – Panel nauczyciela (/edu)                      |
| EDU-DECK-06 | P2 ważny       | Statystyki fiszek (/edu/flashcards/stats)                            | —           | EDU – Panel nauczyciela (/edu)                      |
| EDU-TOP-01  | P2 ważny       | Tematy nauczyciela – CRUD i widoczność                               | —           | EDU – Panel nauczyciela (/edu)                      |
| EDU-Q-01    | P2 ważny       | Utworzenie banku dla grupy                                           | —           | EDU – Panel nauczyciela (/edu)                      |
| EDU-Q-02    | P1 krytyczny   | Pytanie wielokrotnego wyboru                                         | —           | EDU – Panel nauczyciela (/edu)                      |
| EDU-Q-03    | P2 ważny       | Pytanie Prawda/Fałsz                                                 | —           | EDU – Panel nauczyciela (/edu)                      |
| EDU-Q-04    | P2 ważny       | Pytanie otwarte                                                      | —           | EDU – Panel nauczyciela (/edu)                      |
| EDU-Q-05    | P2 ważny       | Edycja i usuwanie pytań                                              | EDU-Q-02    | EDU – Panel nauczyciela (/edu)                      |
| EDU-Q-06    | P2 ważny       | Utworzenie fiszki z pytania                                          | —           | EDU – Panel nauczyciela (/edu)                      |
| EDU-QZ-01   | P2 ważny       | Utworzenie quizu                                                     | —           | EDU – Panel nauczyciela (/edu)                      |
| EDU-QZ-02   | P1 krytyczny   | Dodawanie pytań do quizu                                             | —           | EDU – Panel nauczyciela (/edu)                      |
| EDU-QZ-03   | P2 ważny       | Zmiana kolejności i punktów pytań                                    | —           | EDU – Panel nauczyciela (/edu)                      |
| EDU-QZ-04   | P2 ważny       | Autozapis i zapis ręczny                                             | —           | EDU – Panel nauczyciela (/edu)                      |
| EDU-QZ-05   | P2 ważny       | Utworzenie kartkówki z quizu                                         | —           | EDU – Panel nauczyciela (/edu)                      |
| EDU-ASG-01  | P1 krytyczny   | Utworzenie kartkówki (formularz)                                     | —           | EDU – Panel nauczyciela (/edu)                      |
| EDU-ASG-02  | P2 ważny       | Dodawanie pytań – ręczny wybór                                       | —           | EDU – Panel nauczyciela (/edu)                      |
| EDU-ASG-03  | P2 ważny       | Dodawanie pytań – losowanie                                          | —           | EDU – Panel nauczyciela (/edu)                      |
| EDU-ASG-04  | P1 krytyczny   | Publikacja – wybór odbiorców                                         | —           | EDU – Panel nauczyciela (/edu)                      |
| EDU-ASG-05  | P1 krytyczny   | Cofnięcie publikacji                                                 | —           | EDU – Panel nauczyciela (/edu)                      |
| EDU-ASG-06  | P2 ważny       | Usunięcie kartkówki                                                  | —           | EDU – Panel nauczyciela (/edu)                      |
| EDU-ASG-07  | P2 ważny       | Wyniki kartkówki – lista uczniów                                     | —           | EDU – Panel nauczyciela (/edu)                      |
| EDU-ASG-08  | P1 krytyczny   | Ocena odpowiedzi ucznia (per uczeń)                                  | —           | EDU – Panel nauczyciela (/edu)                      |
| EDU-ASG-09  | P2 ważny       | Eksport odpowiedzi                                                   | —           | EDU – Panel nauczyciela (/edu)                      |
| EDU-ASG-10  | P2 ważny       | Wydruk kartkówki i klucz odpowiedzi                                  | —           | EDU – Panel nauczyciela (/edu)                      |
| EDU-GRP-01  | P2 ważny       | Lista i tworzenie grup                                               | —           | EDU – Panel nauczyciela (/edu)                      |
| EDU-GRP-02  | P2 ważny       | Zarządzanie członkami grupy                                          | EDU-GRP-01  | EDU – Panel nauczyciela (/edu)                      |
| EDU-GRP-03  | P2 ważny       | Edycja i usuwanie grupy                                              | —           | EDU – Panel nauczyciela (/edu)                      |
| EDU-GRP-04  | P2 ważny       | Limit grup (plan organizacji Launch: 3)                              | —           | EDU – Panel nauczyciela (/edu)                      |
| EDU-GRP-05  | P2 ważny       | Brak funkcji group.manage                                            | —           | EDU – Panel nauczyciela (/edu)                      |
| EDU-REP-01  | P2 ważny       | Lista zgłoszeń nauczyciela                                           | STU-39      | EDU – Panel nauczyciela (/edu)                      |
| EDU-REP-02  | P2 ważny       | Odpowiedź na zgłoszenie                                              | EDU-REP-01  | EDU – Panel nauczyciela (/edu)                      |
| EDU-ST-01   | P2 ważny       | Statystyki – „Treści” (/edu/stats/data)                              | —           | EDU – Panel nauczyciela (/edu)                      |
| EDU-ST-02   | P2 ważny       | Statystyki – „Wyniki” (/edu/stats/results)                           | —           | EDU – Panel nauczyciela (/edu)                      |
| EDU-ST-03   | P2 ważny       | Statystyki – „Aktywność” (/edu/stats/activity)                       | —           | EDU – Panel nauczyciela (/edu)                      |
| EDU-ST-04   | P2 ważny       | Statystyki – testy (/edu/stats/quizzes)                              | —           | EDU – Panel nauczyciela (/edu)                      |
| MGR-01      | P2 ważny       | Pulpit „Zarządzanie Uczelnią” (/manage)                              | —           | MGR – Panel managera organizacji (/manage)          |
| MGR-02      | P2 ważny       | Menu boczne managera                                                 | —           | MGR – Panel managera organizacji (/manage)          |
| MGR-03      | P2 ważny       | Dane różnią się między organizacjami                                 | —           | MGR – Panel managera organizacji (/manage)          |
| MGR-MEM-01  | P1 krytyczny   | Lista członków – wyszukiwanie i filtr roli                           | —           | MGR – Panel managera organizacji (/manage)          |
| MGR-MEM-02  | P1 krytyczny   | Zmiana roli członka                                                  | —           | MGR – Panel managera organizacji (/manage)          |
| MGR-MEM-03  | P1 krytyczny   | Zmiana własnej roli / ostatni admin                                  | —           | MGR – Panel managera organizacji (/manage)          |
| MGR-MEM-04  | P2 ważny       | Usunięcie członka z organizacji                                      | —           | MGR – Panel managera organizacji (/manage)          |
| MGR-MEM-05  | P2 ważny       | Zarządzanie przynależnością do grup członka                          | —           | MGR – Panel managera organizacji (/manage)          |
| MGR-INV-01  | P1 krytyczny   | Wysłanie zaproszenia z rolą                                          | —           | MGR – Panel managera organizacji (/manage)          |
| MGR-INV-02  | P2 ważny       | Zaproszenia zbiorcze (wiele wierszy)                                 | —           | MGR – Panel managera organizacji (/manage)          |
| MGR-INV-03  | P2 ważny       | Anulowanie zaproszenia                                               | —           | MGR – Panel managera organizacji (/manage)          |
| MGR-INV-04  | P2 ważny       | Akceptacja zaproszenia dla istniejącego użytkownika                  | —           | MGR – Panel managera organizacji (/manage)          |
| MGR-GRP-01  | P1 krytyczny   | Lista, tworzenie, edycja i usuwanie grup                             | —           | MGR – Panel managera organizacji (/manage)          |
| MGR-GRP-02  | P2 ważny       | Członkowie grupy – przypisywanie                                     | —           | MGR – Panel managera organizacji (/manage)          |
| MGR-ROL-01  | P2 ważny       | Tworzenie roli – plan bez role.builder (Launch)                      | —           | MGR – Panel managera organizacji (/manage)          |
| MGR-ROL-02  | P2 ważny       | Tworzenie i edycja roli – plan z role.builder                        | BIL-04      | MGR – Panel managera organizacji (/manage)          |
| MGR-ROL-03  | P2 ważny       | Edytor uprawnień roli                                                | —           | MGR – Panel managera organizacji (/manage)          |
| MGR-ROL-04  | P1 krytyczny   | Usuwanie ról – ograniczenia                                          | —           | MGR – Panel managera organizacji (/manage)          |
| MGR-SEAT-01 | P2 ważny       | Zakup miejsc (symulacja)                                             | —           | MGR – Panel managera organizacji (/manage)          |
| MGR-SEAT-02 | P2 ważny       | Przydzielenie miejsca członkowi                                      | MGR-SEAT-01 | MGR – Panel managera organizacji (/manage)          |
| MGR-SEAT-03 | P2 ważny       | Zwolnienie miejsca                                                   | —           | MGR – Panel managera organizacji (/manage)          |
| MGR-SET-01  | P2 ważny       | Branding zablokowany na planie Launch                                | —           | MGR – Panel managera organizacji (/manage)          |
| MGR-SET-02  | P2 ważny       | Wgranie logo (plan z brandingiem)                                    | —           | MGR – Panel managera organizacji (/manage)          |
| MGR-SET-03  | P2 ważny       | Logo – niedozwolone pliki                                            | —           | MGR – Panel managera organizacji (/manage)          |
| MGR-SET-04  | P2 ważny       | Kolor marki                                                          | —           | MGR – Panel managera organizacji (/manage)          |
| MGR-SET-05  | P2 ważny       | Utrata brandingu po obniżeniu planu                                  | —           | MGR – Panel managera organizacji (/manage)          |
| MGR-REP-01  | P2 ważny       | Zgłoszenia w organizacji                                             | —           | MGR – Panel managera organizacji (/manage)          |
| MGR-ACC-01  | P1 krytyczny   | Menu użytkownika managera – Konto, Płatności, Wybierz plan           | —           | MGR – Panel managera organizacji (/manage)          |
| BIL-01      | P2 ważny       | Strona rozliczeń studenta (/app/billing)                             | —           | BIL – Plany, rozliczenia i płatność (symulowana)    |
| BIL-02      | P2 ważny       | Strona „Wybierz plan” (/app/upgrade, /edu/upgrade)                   | —           | BIL – Plany, rozliczenia i płatność (symulowana)    |
| BIL-03      | P1 krytyczny   | Zakup planu studenta – ścieżka poprawna                              | —           | BIL – Plany, rozliczenia i płatność (symulowana)    |
| BIL-04      | P1 krytyczny   | Zakup planu organizacji przez managera                               | —           | BIL – Plany, rozliczenia i płatność (symulowana)    |
| BIL-05      | P1 krytyczny   | Checkout – plan niezgodny z typem konta                              | —           | BIL – Plany, rozliczenia i płatność (symulowana)    |
| BIL-06      | P1 krytyczny   | Płatność bez zalogowania                                             | —           | BIL – Plany, rozliczenia i płatność (symulowana)    |
| BIL-07      | P2 ważny       | Zmiana ceny w panelu admina widoczna w cenniku                       | —           | BIL – Plany, rozliczenia i płatność (symulowana)    |
| LIM-01      | P2 ważny       | Macierz limitów – podgląd w panelu admina                            | —           | LIM – Funkcje (feature flags) i limity planów       |
| LIM-02      | P1 krytyczny   | Egzekwowanie limitów – w małej skali (obniżone wartości)             | —           | LIM – Funkcje (feature flags) i limity planów       |
| LIM-03      | P2 ważny       | Wyższy limit po zakupie planu                                        | LIM-02      | LIM – Funkcje (feature flags) i limity planów       |
| LIM-04      | P2 ważny       | Limit grup i członków organizacji (Launch)                           | —           | LIM – Funkcje (feature flags) i limity planów       |
| LIM-05      | P1 krytyczny   | Branding wymaga funkcji branding                                     | —           | LIM – Funkcje (feature flags) i limity planów       |
| LIM-06      | P2 ważny       | Flaga globalna wyłączona                                             | —           | LIM – Funkcje (feature flags) i limity planów       |
| LIM-07      | P2 ważny       | Nadpisanie funkcji dla użytkownika (user override)                   | —           | LIM – Funkcje (feature flags) i limity planów       |
| ADM-01      | P2 ważny       | Pulpit panelu admina                                                 | —           | ADM – Panel administracyjny (apps/admin, port 4000) |
| ADM-FLG-01  | P2 ważny       | Lista flag                                                           | —           | ADM – Panel administracyjny (apps/admin, port 4000) |
| ADM-FLG-02  | P1 krytyczny   | Utworzenie flagi                                                     | ADM-FLG-01  | ADM – Panel administracyjny (apps/admin, port 4000) |
| ADM-FLG-03  | P2 ważny       | Usunięcie flagi                                                      | —           | ADM – Panel administracyjny (apps/admin, port 4000) |
| ADM-FLG-04  | P2 ważny       | Efekt flagi w aplikacji web                                          | —           | ADM – Panel administracyjny (apps/admin, port 4000) |
| ADM-PLN-01  | P2 ważny       | Lista planów                                                         | —           | ADM – Panel administracyjny (apps/admin, port 4000) |
| ADM-PLN-02  | P1 krytyczny   | Utworzenie planu z typem konta                                       | —           | ADM – Panel administracyjny (apps/admin, port 4000) |
| ADM-PLN-03  | P1 krytyczny   | Edycja planu – typ konta i ceny                                      | —           | ADM – Panel administracyjny (apps/admin, port 4000) |
| ADM-PLN-04  | P2 ważny       | Usunięcie planu                                                      | —           | ADM – Panel administracyjny (apps/admin, port 4000) |
| ADM-OVR-01  | P2 ważny       | Utworzenie nadpisania                                                | —           | ADM – Panel administracyjny (apps/admin, port 4000) |
| ADM-ORG-01  | P2 ważny       | Lista organizacji                                                    | —           | ADM – Panel administracyjny (apps/admin, port 4000) |
| ADM-ORG-02  | P2 ważny       | Szczegóły organizacji                                                | ADM-ORG-01  | ADM – Panel administracyjny (apps/admin, port 4000) |
| ADM-USR-01  | P2 ważny       | Lista użytkowników i wyszukiwanie                                    | —           | ADM – Panel administracyjny (apps/admin, port 4000) |
| ADM-USR-02  | P1 krytyczny   | Utworzenie użytkownika                                               | —           | ADM – Panel administracyjny (apps/admin, port 4000) |
| ADM-USR-03  | P2 ważny       | Zmiana typu konta                                                    | —           | ADM – Panel administracyjny (apps/admin, port 4000) |
| ADM-USR-04  | P1 krytyczny   | Usunięcie użytkownika (kosz 30 dni)                                  | —           | ADM – Panel administracyjny (apps/admin, port 4000) |
| ADM-USR-05  | P2 ważny       | Przywrócenie użytkownika                                             | —           | ADM – Panel administracyjny (apps/admin, port 4000) |
| ADM-USR-06  | P2 ważny       | Trwałe usunięcie                                                     | —           | ADM – Panel administracyjny (apps/admin, port 4000) |
| ADM-SEC-01  | P2 ważny       | API z kluczami – brak/niepoprawny podpis                             | —           | ADM – Panel administracyjny (apps/admin, port 4000) |
| ADM-SEC-02  | P2 ważny       | Strony UI przy włączonym PEM                                         | ADM-SEC-01  | ADM – Panel administracyjny (apps/admin, port 4000) |
| ADM-SEC-03  | P2 ważny       | Fail-closed w produkcji                                              | —           | ADM – Panel administracyjny (apps/admin, port 4000) |
| SEC-01      | P1 krytyczny   | Student nie widzi treści innej grupy                                 | —           | SEC – Autoryzacja i izolacja danych                 |
| SEC-02      | P1 krytyczny   | Student z innej organizacji                                          | —           | SEC – Autoryzacja i izolacja danych                 |
| SEC-03      | P2 ważny       | Użytkownik bez organizacji (S3)                                      | —           | SEC – Autoryzacja i izolacja danych                 |
| SEC-04      | P1 krytyczny   | Manager jednej organizacji nie zarządza inną                         | —           | SEC – Autoryzacja i izolacja danych                 |
| SEC-05      | P1 krytyczny   | Student nie wykona akcji nauczyciela przez API                       | —           | SEC – Autoryzacja i izolacja danych                 |
| SEC-06      | P1 krytyczny   | Student/nauczyciel nie zarządza organizacją                          | —           | SEC – Autoryzacja i izolacja danych                 |
| SEC-07      | P2 ważny       | Manager nie korzysta z API AI                                        | —           | SEC – Autoryzacja i izolacja danych                 |
| SEC-08      | P1 krytyczny   | Edycja cudzych zasobów (IDOR)                                        | —           | SEC – Autoryzacja i izolacja danych                 |
| SEC-09      | P1 krytyczny   | Kartkówki i wyniki cudzych uczniów                                   | —           | SEC – Autoryzacja i izolacja danych                 |
| SEC-10      | P1 krytyczny   | XSS w polach tekstowych                                              | —           | SEC – Autoryzacja i izolacja danych                 |
| SEC-11      | P2 ważny       | Przesyłanie plików – typy i rozmiary                                 | —           | SEC – Autoryzacja i izolacja danych                 |
| SEC-12      | P2 ważny       | Endpointy deweloperskie                                              | —           | SEC – Autoryzacja i izolacja danych                 |
| SEC-13      | P2 ważny       | Reguły dostępu do bazy (RLS)                                         | —           | SEC – Autoryzacja i izolacja danych                 |
| NFR-01      | P2 ważny       | Brakujące tłumaczenia – przegląd polskiej wersji                     | —           | NFR – Wymagania niefunkcjonalne i międzyobszarowe   |
| NFR-02      | P1 krytyczny   | Zmiana języka (PL ⇄ EN)                                              | —           | NFR – Wymagania niefunkcjonalne i międzyobszarowe   |
| NFR-03      | P2 ważny       | Motyw jasny / ciemny                                                 | —           | NFR – Wymagania niefunkcjonalne i międzyobszarowe   |
| NFR-04      | P1 krytyczny   | Widok mobilny (375 × 812)                                            | —           | NFR – Wymagania niefunkcjonalne i międzyobszarowe   |
| NFR-05      | P2 ważny       | Obsługa klawiaturą                                                   | —           | NFR – Wymagania niefunkcjonalne i międzyobszarowe   |
| NFR-06      | P2 ważny       | Zachowanie przy braku sieci i błędach serwera                        | —           | NFR – Wymagania niefunkcjonalne i międzyobszarowe   |
| NFR-07      | P2 ważny       | Konsola przeglądarki i błędy serwera                                 | —           | NFR – Wymagania niefunkcjonalne i międzyobszarowe   |
| NFR-08      | P2 ważny       | Zgodność przeglądarek                                                | —           | NFR – Wymagania niefunkcjonalne i międzyobszarowe   |

## Modules

- PUB – Strony publiczne i nawigacja ogólna — 8 cases
- AUT – Uwierzytelnianie i sesja — 19 cases
- ONB – Onboarding, organizacje i zaproszenia — 10 cases
- STU – Panel studenta (/app) — 53 cases
- EDU – Panel nauczyciela (/edu) — 41 cases
- MGR – Panel managera organizacji (/manage) — 28 cases
- BIL – Plany, rozliczenia i płatność (symulowana) — 7 cases
- LIM – Funkcje (feature flags) i limity planów — 7 cases
- ADM – Panel administracyjny (apps/admin, port 4000) — 21 cases
- SEC – Autoryzacja i izolacja danych — 13 cases
- NFR – Wymagania niefunkcjonalne i międzyobszarowe — 8 cases
