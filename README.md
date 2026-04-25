# 🗄️ Local Supabase Setup

Instrukcja uruchamiania Supabase lokalnie dla członków zespołu.

---

## ✅ Wymagania wstępne

- **Docker Desktop** — musi być zainstalowany i uruchomiony przed jakimikolwiek krokami  
  👉 [Pobierz Docker Desktop](https://www.docker.com/products/docker-desktop/)

---

## 🚀 Uruchomienie

### 1. Wystartuj lokalne Supabase

```bash
bunx supabase start
```

> Pierwsze uruchomienie może potrwać kilka minut — Docker pobiera obrazy.

Po zakończeniu w terminalu pojawią się lokalne adresy i klucze API.

---

### 2. Utwórz plik `.env.local`

W katalogu głównym projektu utwórz plik `.env.local`:

```bash
touch .env.local
```

---

### 3. Skopiuj zmienne środowiskowe

1. Wejdź na [http://127.0.0.1:54323/](http://127.0.0.1:54323/) — to lokalne Supabase Studio
2. Kliknij przycisk **Connect** (prawy górny róg)
3. Skopiuj zawartość i wklej ją do `.env.local`

Przykładowy wygląd `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

---

## 🛑 Zatrzymanie

```bash
bunx supabase stop
```

> Dane zostają zachowane. Aby wyczyścić bazę danych, dodaj flagę `--no-backup`.

---

## 👥 Współpraca zespołowa

Dane lokalne **nie są synchronizowane przez git** — każdy ma swoją lokalną bazę. Żeby wszyscy mieli to samo, używamy migracji i seedów.

### Schemat (struktura tabel)

Po wprowadzeniu zmian w tabelach przez Supabase Studio, wygeneruj migrację:

```bash
bunx supabase db diff -f nazwa_migracji
```

Supabase automatycznie porówna aktualny stan bazy z poprzednią migracją i zapisze różnice do `supabase/migrations/`. **Ten plik committujesz do gita.**

### Dane testowe

Edytuj plik `supabase/seed.sql` z przykładowymi danymi:

```sql
INSERT INTO products (name, price) VALUES ('Produkt testowy', 99.99);
```

Plik `seed.sql` też wchodzi do gita.

### Flow po stronie autora zmian

```bash
# 1. Wprowadź zmiany w Studio (http://127.0.0.1:54323)
# 2. Wygeneruj migrację
bunx supabase db diff -f nazwa_migracji
# 3. Zaktualizuj seed.sql jeśli potrzeba
# 4. Committuj i pushuj
git add supabase/
git commit -m "migration: nazwa_migracji"
```

### Flow dla reszty zespołu

```bash
git pull
bunx supabase start        # aplikuje migracje automatycznie
bunx supabase db reset     # (opcjonalnie) ładuje świeży seed z danymi testowymi
```

> ⚠️ `db reset` **kasuje wszystkie lokalne dane** i ładuje seed od nowa — używaj świadomie.

---

## 🔄 Przydatne komendy

| Komenda | Opis |
|---|---|
| `bunx supabase start` | Uruchom lokalne Supabase |
| `bunx supabase stop` | Zatrzymaj lokalne Supabase |
| `bunx supabase status` | Sprawdź status i wyświetl klucze API |
| `bunx supabase db reset` | Zresetuj bazę danych (+ seed) |
| `bunx supabase db diff -f <nazwa>` | Wygeneruj migrację z aktualnych zmian |
| `bunx supabase migration new <nazwa>` | Utwórz pustą migrację ręcznie |
| `bunx supabase db push` | Wypchnij migracje do bazy |

---

## 🔗 Lokalne adresy

| Usługa | URL |
|---|---|
| Supabase Studio | http://127.0.0.1:54323 |
| API (REST) | http://127.0.0.1:54321 |
| Auth | http://127.0.0.1:54321/auth/v1 |
| Inbucket (e-maile) | http://127.0.0.1:54324 |

---

## ⚠️ Uwagi

- Plik `.env.local` jest w `.gitignore` — **nie commituj go do repozytorium**
- Każdy członek zespołu musi wykonać te kroki samodzielnie na swoim komputerze
- Upewnij się, że Docker Desktop jest uruchomiony **przed** `bunx supabase start`