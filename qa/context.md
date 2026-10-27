# Global context — StudiQ manual test plan

_Verbatim extract of sections 1-4 and the defect-template section of the source document (Polish). Read this once per session._

STUDIQ

Dokument testera – testy manualne

Scenariusze, kroki i pola do odhaczenia dla wszystkich funkcji aplikacji

| Pole                           | Wartość                                                                                                                                                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wersja dokumentu               | 1.3 (17.10.2026)                                                                                                                                                                                            |
| Testowana aplikacja            | StudiQ – aplikacja web (port 3000) i panel administracyjny (port 4000)                                                                                                                                      |
| Wersja kodu                    | gałąź main (commit 216daae) + PR #128 (formularz planów w adminie) + PR #130 (zarządzanie użytkownikami z 30-dniowym koszem) – oba PR do czasu merge’a należy testować na gałęzi feat/admin-user-management |
| Liczba scenariuszy             | 215 (P1: 60, P2: 150, P3: 5)                                                                                                                                                                                |
| Tester (imię i nazwisko)       |                                                                                                                                                                                                             |
| Data rozpoczęcia / zakończenia |                                                                                                                                                                                                             |
| Wynik końcowy                  | ZALICZONY / ZALICZONY Z UWAGAMI / NIEZALICZONY                                                                                                                                                              |

# 1. Cel i zakres dokumentu

Dokument prowadzi testera krok po kroku przez ręczne sprawdzenie wszystkich funkcji platformy StudiQ – od stron publicznych, przez panele studenta, nauczyciela i managera organizacji, po plany/płatności i panel administracyjny. Przy każdym scenariuszu podano: warunek wstępny, numerowane kroki, oczekiwany rezultat oraz pola do odhaczenia wyniku.

Skala testów: dokument jest przygotowany pod małą skalę – wystarczą 2–3 rekordy każdego typu (kilka fiszek, kilka pytań, 1–2 grupy, 1–2 kartkówki) i kilka kont z seeda. Limity planów sprawdzamy po obniżeniu wartości w bazie (LIM-02), a nie przez wgrywanie setek rekordów.

### Co jest objęte testami

Rejestracja, logowanie, reset hasła, ochrona tras według ról (student / nauczyciel / manager).

Panel studenta: nauka fiszek (SM-2), wkuwanie, quizy, talie i fiszki, tematy, banki pytań, kartkówki, zgłoszenia, statystyki, asystent AI, konto.

Panel nauczyciela: talie i fiszki, banki pytań, kreator quizów, kartkówki (publikacja, ocenianie, eksport, wydruk), grupy, zgłoszenia, statystyki.

Panel managera: członkowie, zaproszenia, grupy, role i uprawnienia, licencje (miejsca), ustawienia i branding.

Plany, limity, funkcje (feature flags), symulowana płatność.

Panel administracyjny: flagi funkcji, plany, nadpisania użytkowników, organizacje, użytkownicy (kosz 30 dni), zabezpieczenie API podpisem.

Testy negatywne bezpieczeństwa i izolacji danych oraz wymagania niefunkcjonalne (język, motyw, responsywność, dostępność, wydajność).

### Poza zakresem

Realna integracja płatności (moduł płatności jest świadomie symulowany – decyzja zespołu z 14.09.2026).

Egzamin ustny AI (funkcja opcjonalna, nie zaimplementowana) oraz sesje „Na żywo” (ekran „wkrótce”).

Testy obciążeniowe, duże wolumeny danych i testy penetracyjne – dokument zawiera jedynie podstawowe kontrole bezpieczeństwa.

Zautomatyzowane testy (unit/integration/e2e) – uruchamia się je osobno poleceniem bun test.

# 2. Konta i dane testowe

Hasło wszystkich kont seedowych: pass. W slotach QA działa build produkcyjny, więc nie ma panelu „Dev Quick Login”; **zawsze loguj się przez `POST /api/v1/auth/login`** (`{"email","password"}`), nigdy przez Dev Quick Login ani formularz. Skrzynka Inbucket: `http://localhost:$((54321 + 100 * N + 3))` dla slotu N (env-1 `:54424`, env-2 `:54524`, …).

| E-mail                      | Skrót | Typ konta | Organizacje / rola                                  | Plan osobisty | Uwagi                                                      |
| --------------------------- | ----- | --------- | --------------------------------------------------- | ------------- | ---------------------------------------------------------- |
| manager@dev.local           | M1    | manager   | WSB Merito (admin), UE Wrocław (admin)              | Launch        | Dwie organizacje – test przełącznika                       |
| manager2@dev.local          | M2    | manager   | Akademia Górnicza (admin)                           | Launch        | Jedyna organizacja, brak grup i uczniów                    |
| teacher1@dev.local          | T1    | educator  | WSB Merito i UE Wrocław (teacher); grupy O1G1, O2G1 | Lite          | Główne konto nauczyciela                                   |
| teacher2@dev.local          | T2    | educator  | WSB Merito i UE Wrocław (teacher); grupy O1G2, O2G2 | Lite          | Do testów izolacji względem T1                             |
| student1@dev.local          | S1    | student   | WSB Merito (member), grupa O1G1                     | Base          | Ma talię „O1S1” (osobista)                                 |
| student2@dev.local          | S2    | student   | UE Wrocław (member), grupa O2G1                     | Base          | Inna organizacja niż S1                                    |
| student3@dev.local          | S3    | student   | brak organizacji                                    | Base          | Konto samodzielne (B2C)                                    |
| test-student@dev.local      | TS    | student   | brak                                                | Base          | Brak jakichkolwiek treści – do testów „od zera” i limitów  |
| teacher-classroom@dev.local | TC    | educator  | Classroom (admin), grupa „Classroom Group”          | Launch        | Pełne dane: 2 banki, 10 pytań, 2 talie (8 fiszek), 2 quizy |
| student-classroom@dev.local | SC    | student   | Classroom (member), grupa „Classroom Group”         | Base          | Uczeń TC – do kartkówek i quizów                           |

### Organizacje, grupy i treści seed

| Organizacja (plan)         | Członkowie                                | Grupy                    | Treści                                                                                                                                                                                                                                                               |
| -------------------------- | ----------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WSB Merito (Launch)        | M1 admin; T1, T2 teacher; S1 member (4/5) | O1G1 (T1, S1), O1G2 (T2) | Talie/banki/tematy oznaczone O1G1T1, O1G2T2, osobista O1S1                                                                                                                                                                                                           |
| UE Wrocław (Launch)        | M1 admin; T1, T2 teacher; S2 member (4/5) | O2G1 (T1, S2), O2G2 (T2) | O2G1T1, O2G2T2, osobista O2S2                                                                                                                                                                                                                                        |
| Akademia Górnicza (Launch) | M2 admin                                  | —                        | brak                                                                                                                                                                                                                                                                 |
| Classroom (Launch)         | TC admin; SC member                       | Classroom Group          | Banki: Historia (4 pyt.: 2 WW, 1 P/F, 1 otw.), Geografia i Nauka (6 pyt.: 2 WW, 2 P/F, 2 otw.); talie: Historia – fiszki, Geografia – fiszki (po 4); quizy: „Historia — Średniowiecze”, „Geografia i Nauka — Odkrycia”; tematy: Średniowiecze, Odkrycia geograficzne |

### Plany (ceny podane w groszach w bazie)

| Typ         | Darmowy                        | Podstawowy (9,99 zł) | Premium (19,99 zł)                | Zaawansowany (49,99 zł)        |
| ----------- | ------------------------------ | -------------------- | --------------------------------- | ------------------------------ |
| Student     | Base                           | Spark                | Ace (AI, zaawansowane statystyki) | Pro (bez limitów)              |
| Edukator    | Lite (grupy 1, studenci 5)     | Guide                | Creator (AI)                      | Master (role, bez limitów)     |
| Organizacja | Launch (grupy 3, członkowie 5) | Team                 | Hub (AI, role, branding)          | Campus (bez limitów, branding) |

# 3. Jak korzystać z dokumentu

### Pola wyniku (kolumna „Wynik”)

| Pole  | Kiedy zaznaczyć                                                                                                                |
| ----- | ------------------------------------------------------------------------------------------------------------------------------ |
| OK    | Wszystkie punkty oczekiwanego rezultatu spełnione.                                                                             |
| BŁĄD  | Którykolwiek punkt niespełniony. Opisz w uwagach co się stało i załóż zgłoszenie. Wpisz numer zgłoszenia w ostatniej kolumnie. |
| BLOK. | Test nie mógł zostać wykonany (np. poprzedni krok zawiódł, brak danych, brak środowiska). Podaj powód w uwagach.               |
| N/D   | Nie dotyczy w tej konfiguracji (np. brak klucza AI, brak PR #130). Podaj powód.                                                |

Pola wyboru są klikalnymi kontrolkami w programie Word (kliknij, aby zaznaczyć ☒). W wersji drukowanej zaznacz długopisem. Zaznaczaj dokładnie jedno pole na scenariusz.

### Priorytety

| Priorytet        | Znaczenie                                                                               | Zasada wykonywania                                               |
| ---------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| P1 – krytyczny   | Podstawowa funkcja lub bezpieczeństwo; jej awaria blokuje użytkownika lub ujawnia dane. | Wykonuj zawsze, jako pierwsze. Błąd P1 = zgłoszenie natychmiast. |
| P2 – ważny       | Funkcja standardowa, walidacje, ścieżki alternatywne.                                   | Wykonuj w pełnym przebiegu testów.                               |
| P3 – kosmetyczny | Szczegóły wizualne, językowe i rzadkie przypadki.                                       | Wykonuj, gdy zostanie czas; błędy zbieraj zbiorczo.              |

### Zasady wykonywania

Czytaj cały scenariusz przed rozpoczęciem. Wykonuj kroki dokładnie w podanej kolejności i na wskazanym koncie.

Teksty w cudzysłowie „…” oznaczają dokładne napisy w interfejsie (polskim). Rozbieżność w treści komunikatu to uwaga językowa (P3), nie błąd działania – chyba że komunikat jest mylący.

Sformułowania „zanotuj” oznaczają, że oczekiwane zachowanie nie jest jednoznaczne – wpisz faktyczny wynik w uwagach, a decyzję o zaliczeniu podejmij z zespołem.

Oznaczenia „ZNANY PROBLEM”, „UWAGA”, „WERYFIKUJ I ZGŁOŚ” wskazują miejsca, w których przegląd kodu wskazał prawdopodobną usterkę – potwierdź ją testem.

Po każdej awarii zapisz zrzut ekranu, treść błędów z konsoli (Console) oraz nieudane żądanie z zakładki Network (adres, kod, odpowiedź).

Nigdy nie używaj prawdziwych danych karty płatniczej ani prawdziwych haseł – płatność jest symulowana, a hasła testowe są jawne.

### Odstępstwa od dokumentu (decyzje produktowe)

**PUB-08 — panel nauczyciela bez sekcji „Klasa”** (decyzja #292, 2026-10-25). Strona 404 `/edu/nie-istnieje` pokazuje cztery linki: Przegląd / Pytania / Fiszki / Statystyki. Trasa `/edu/classroom` nie ma strony docelowej (istnieją tylko `/edu/classroom/members`, `/edu/classroom/invite`, `/edu/classroom/new`), a zarządzanie członkami i grupami należy do panelu managera — brak linku „Klasa” jest wynikiem oczekiwanym, nie usterką.

### Sugerowana kolejność

1. PUB, AUT → 2) ONB → 3) STU → 4) EDU → 5) MGR → 6) BIL, LIM → 7) ADM → 8) SEC → 9) NFR. Pełny przebieg ma sens po bunx supabase db reset.

# 4. Spis modułów i podsumowanie wykonania

Wypełnij po zakończeniu testów (liczby zaznaczeń w danym module).

| Kod | Moduł                                         | Scenariuszy | OK  | BŁĄD | BLOK. | N/D |
| --- | --------------------------------------------- | ----------- | --- | ---- | ----- | --- |
| PUB | Strony publiczne i nawigacja ogólna           | 8           |     |      |       |     |
| AUT | Uwierzytelnianie i sesja                      | 19          |     |      |       |     |
| ONB | Onboarding, organizacje i zaproszenia         | 10          |     |      |       |     |
| STU | Panel studenta (/app)                         | 53          |     |      |       |     |
| EDU | Panel nauczyciela (/edu)                      | 41          |     |      |       |     |
| MGR | Panel managera organizacji (/manage)          | 28          |     |      |       |     |
| BIL | Plany, rozliczenia i płatność (symulowana)    | 7           |     |      |       |     |
| LIM | Funkcje (feature flags) i limity planów       | 7           |     |      |       |     |
| ADM | Panel administracyjny (apps/admin, port 4000) | 21          |     |      |       |     |
| SEC | Autoryzacja i izolacja danych                 | 13          |     |      |       |     |
| NFR | Wymagania niefunkcjonalne i międzyobszarowe   | 8           |     |      |       |     |
|     | RAZEM                                         | 215         |     |      |       |     |

Zakładaj zgłoszenia w narzędziu zespołu (np. GitHub Issues repozytorium logyQT/studiq). Wzór treści:

| Pole                 | Treść                                                                         |
| -------------------- | ----------------------------------------------------------------------------- |
| Tytuł                | Krótko: [moduł] co nie działa (np. „[MGR] Konto managera prowadzi do 404”)    |
| Numer scenariusza    | np. MGR-ACC-01, krok 2                                                        |
| Kroki do odtworzenia | Numerowana lista od czystych danych (po bunx supabase db reset)               |
| Wynik oczekiwany     | Skopiuj z dokumentu                                                           |
| Wynik faktyczny      | Co się stało, dokładny tekst komunikatu                                       |
| Załączniki           | Zrzut ekranu, treść Console, nieudane żądanie z Network (URL, kod, odpowiedź) |
| Waga                 | Krytyczny (blokuje pracę lub ujawnia dane) / Wysoki / Średni / Niski          |
| Powtarzalność        | Zawsze / czasami (ile razy na ile prób)                                       |
