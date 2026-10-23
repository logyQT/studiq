# STU-49 — Generator fiszek z PDF (AI)

- id: STU-49
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Asystent AI (/app/ai)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

AI włączone; plik PDF z tekstem.

## Steps

1. W widoku talii kliknij „Generuj z AI”.
2. Prześlij plik PDF, wybierz język (Polski/Angielski), kliknij „Generuj Fiszki”.
3. Zachowaj/odrzuć karty („Zachowaj”/„Odrzuć”), edytuj temat, wpisz nazwę talii, „Zapisz Talię”.
4. Spróbuj wgrać plik inny niż PDF.

## Expected result

- Postęp „Przetwarzanie części X z Y”, licznik „Wygenerowano do tej pory (N)”.
- Po zakończeniu „Generowanie zakończone!”, zapis daje toast „Talia utworzona z N fiszkami”.
- Plik nie-PDF → „Akceptowane są tylko pliki PDF”. Brak zachowanych kart → „Nie zachowano żadnych fiszek…”.
