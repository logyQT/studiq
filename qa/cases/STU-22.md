# STU-22 — Multimedia na fiszce (obraz/audio)

- id: STU-22
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Fiszki w talii (/app/flashcards/<id>)
- prereqs: none (self-contained tenant — see Seed)
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Plik graficzny PNG/JPG < 5 MB i plik audio MP3.

## Seed (QA-suite)

- Tenant: `bun scripts/qa-tenant.ts STU-22 --fresh`, profile `content`
  (`__tests__/qa/profiles/STU-22.json`) — its own organization, manager, teacher and student.
- Accounts: the legacy `student1@dev.local` is the tenant's `users.student`
  (`loginAs(page, tenant, 'student')`); no legacy/manual account is used.
- Content: the student's own deck (the legacy „własna talia” prerequisite) is created
  by the spec through `POST /api/v1/flashcards/decks` („Biologia – multimedia”), and the
  card is added through the editor UI — the subject of this case. Media are deterministic
  buffers generated in the spec: a 1×1 PNG for the image and a single MPEG-1 Layer III
  frame for the MP3 (no binary fixtures in the repo).
- The oversized file is 50 MB + 2 KB, written to the test's own output directory
  (Playwright refuses a >50 MB in-memory buffer and asks for a path).
- Nothing global (plan catalogue, feature flags, admin settings, platform stats,
  singleton rows) is read or written, and the tenant is fresh for every independent run.

## Observed (walk on the shared app, :3010)

- „Nowa Fiszka” opens the editor dialog titled „Utwórz Nową Fiszkę”. The toolbar button
  „Prześlij multimedia” triggers a hidden `input[type=file]` (accept =
  png/jpeg/gif/webp + mpeg/wav/ogg).
- The picked file is uploaded to `POST /api/v1/flashcards/media/upload` and inserted into
  the side that has focus: an image as `![<file name without extension>](<public url>)`,
  audio as `<audio controls src="<public url>"></audio>`. The live preview on the right
  renders both immediately.
- Saving keeps that markdown/HTML verbatim; the deck view and the „Wkuwaj” session render
  the image (public storage URL, `naturalWidth > 0`) and the audio player.
- A disallowed type (.txt, .exe) is refused with HTTP 422 and the toast „Nieobsługiwany
  format pliku. Dodaj obraz lub plik audio.”; a file over the cap is refused with
  HTTP 413 and „Plik jest zbyt duży. Wybierz mniejszy plik.”. The dialog stays open, the
  content is untouched, the upload button is usable again and a following valid upload
  still works.
- The product cap is **50 MB**, not the 5 MB from the prerequisite: `MAX_UPLOAD_BYTES` in
  `storage.service.ts` equals the `flashcard-media` bucket `file_size_limit`. „Bardzo duży
  plik” is therefore exercised with a file over 50 MB; a 6 MB file is legitimately accepted.

## Steps

1. W edytorze fiszki użyj „Prześlij multimedia” i wgraj obraz.
2. Wgraj plik audio.
3. Spróbuj wgrać plik niedozwolony (np. .exe lub .txt) oraz bardzo duży plik.

## Expected result

- Obraz/audio wstawiane do treści i widoczne po zapisaniu oraz w sesji nauki.
- Plik niedozwolony lub zbyt duży → czytelny błąd; brak awarii edytora.
