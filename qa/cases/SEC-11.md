# SEC-11 — Przesyłanie plików – typy i rozmiary

- id: SEC-11
- priority: P2 ważny
- module: SEC – Autoryzacja i izolacja danych
- section: Walidacja wejścia i odporność
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Punkty uploadu: logo (manager), media fiszek, zdjęcia kartkówki, CSV, PDF AI.

## Prereqs (tenant model)

The case's own tenant, seeded by `bun scripts/qa-tenant.ts SEC-11 --fresh` (never the
legacy `manager@dev.local` / `teacher1@dev.local` / `pass` accounts):

- key: `tenantKey('qa/cases/SEC-11.md', 'SEC-11#<run suffix>', 'qa-shared')`
- `__tests__/qa/profiles/SEC-11.json` declares `{ "profile": "content", "plan": "hub" }`: one
  organization on **Hub** (so the manager's logo upload passes the `branding` feature gate,
  which is otherwise a 403 before any file is looked at), the tenant's
  manager/teacher/student, and the default group `G1`.
- the profile seeds the graph only. The spec builds the one piece the case needs — a
  published assignment with an open question, targeted at the tenant's student, plus that
  student's attempt — through the product API inside the same tenant. Every id is the
  tenant's own; nothing global is written (no plan catalogue, feature flag, admin setting,
  platform stat or singleton row) and no other tenant is touched.

Upload points reconciled with the code (the manual document names UI labels, not routes):

| Case wording      | Real surface                                                                  | Cap   |
| ----------------- | ----------------------------------------------------------------------------- | ----- |
| logo (manager)    | `POST /api/v1/organization/<id>/logo` (`org-logos` bucket)                    | 5 MB  |
| media fiszek      | `POST /api/v1/flashcards/media/upload` (`flashcard-media` bucket)             | 50 MB |
| zdjęcia kartkówki | `POST /api/v1/assignments/<id>/upload-image` (`assignment-images` bucket)     | 10 MB |
| CSV               | `POST /api/v1/flashcards/import/csv` — **JSON card list**, not a file upload  | n/a   |
| PDF AI            | AI chat composer — the picked file is **never sent** (chat body is text only) | n/a   |

## Steps

1. Do każdego uploadu spróbuj wgrać plik .exe, .html, .svg z JavaScriptem i plik > 20 MB.

## Expected result

- Niedozwolone typy odrzucone po stronie serwera (nie tylko w selektorze); pliki aktywne (html/svg) nie wykonują się po otwarciu.

## Observed during the suite walk (qa-env-5, shared app 3010 / DB 54421)

Uploads were attempted with the browser file picker bypassed (a `DataTransfer` on the hidden
`<input type=file>`, i.e. what drag-and-drop or devtools would do), so every result below is
the server's answer, not the `accept` attribute:

- **Flashcard media** (`/api/v1/flashcards/media/upload`, teacher): `.exe` → 422
  `UNPROCESSABLE_ENTITY`, `.html` → 422, `.svg` with `<script>`/`onload` → 422; the same SVG
  and HTML relabelled `image/png` → 422. A real 1×1 PNG named `evil.html` is accepted (200)
  and stored as `…/<uuid>.png`, served with `Content-Type: image/png` — the sniffed bytes
  decide path, extension and stored type, so an active payload is never served as a document.
- **Organization logo** (`/api/v1/organization/<id>/logo`, manager on Hub): the same five
  payloads → 422; a 21 MB PNG → 413 `PAYLOAD_TOO_LARGE`; the organization row keeps its
  previous `logo_url` after every rejected attempt. A valid PNG → 200, `logo_url` under
  `/org-logos/<org>/…png`, served as `image/png`.
- **Answer photo** (`/api/v1/assignments/<id>/upload-image`, student in an active attempt):
  the same five payloads → 422; an 11 MB PNG → 413; a valid PNG → 200 with
  `…/assignment-images/<org>/<assignment>/<attempt>/…png`, served as `image/png`.
- **CSV**: the dialog reads the chosen file as text and posts a JSON card list, so there is no
  file type to reject on the server. Posting binary (`.exe`) bytes to
  `/api/v1/flashcards/import/csv` → 400 `BAD_REQUEST` and no deck is created; the server's
  row schema rejects a non-card payload with 422.
- **PDF AI**: the composer's picker (`accept=".pdf,.docx,.txt,.png,.jpg,.jpeg"`) keeps the
  file in client state; sending a message with a selected `evil.pdf` issues only
  `POST /api/v1/ai/chat` with a JSON body — no multipart upload, so there is no storage
  surface to validate. Nothing to assert beyond that; the case text assumes an upload that
  does not exist.

Deviation from the expected result: none. Note on the „plik > 20 MB” step — the only bucket
whose cap is below 20 MB is the logo (5 MB) and the answer photo (10 MB); flashcard media is
capped at **50 MB**, so a 20–50 MB media file is accepted by design and asserting a rejection
there would encode the wrong contract. The spec therefore asserts the size dimension at the
logo and answer-photo caps and records the media cap here.
