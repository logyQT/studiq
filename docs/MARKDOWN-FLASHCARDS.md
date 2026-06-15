# Phase 3.1 — Media in Cards (Markdown + Inline LaTeX)

Implementation plan for adding Markdown formatting, inline LaTeX math, and image/audio media attachments to flashcards.

---

## Architecture

```
┌─────────────┐     POST /api/v1/flashcards/media/upload     ┌──────────────┐
│  Browser     │ ──── multipart/form-data ────────────────→ │  Next.js API  │
│  (Dropzone)  │                                             │  (withAuth)   │
│              │ ←── { type, url } ───────────────────────── │               │
└─────────────┘                                             └──────┬───────┘
                                                                   │
                                                          createServiceClient()
                                                                   │
                                                          ┌────────▼───────┐
                                                          │ Supabase Storage│
                                                          │ flashcard-media │
                                                          └────────────────┘
```

Storage layout: `flashcard-media/{userId}/{uuid}.{ext}`
Upload strategy: server-side (browser → API → Supabase via service role key)

---

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Upload path** | Server-side | Consistent with existing auth, no storage RLS, file validation server-side |
| **External images in Markdown** | ❌ Strip all | `rehype-sanitize` blocks `<img>`, `![alt](url)`. Only uploaded media rendered as attachments. |
| **CSV import validation** | Accept any string | Frontend helpers warn users, DB stores whatever |
| **Audio rendering** | Inline `<audio controls>` | Instant playback, no download required |
| **Newline handling** | Pre-save transform | `formatMarkdown()` converts single newlines to Markdown line breaks (`  \n`) on save |

---

## Dependencies

```
bun add react-markdown remark-gfm rehype-sanitize katex remark-math rehype-katex
```

6 packages, 0 type packages needed (KaTeX ships its own types).

---

## Step 1 — Newline Format Helper

**File:** `src/lib/markdown-utils.ts`

```typescript
export function formatMarkdown(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n');
  const paragraphs = normalized.split(/\n{2,}/);
  const formatted = paragraphs.map((p) => p.replace(/\n/g, '  \n'));
  return formatted.join('\n\n');
}
```

Called in create/edit dialog handlers before `onCreate`/`onUpdate`.

---

## Step 2 — Shared MarkdownRenderer

**File:** `src/components/shared/markdown-renderer.tsx`

Props: `{ content: string, className?: string }`

Pipeline:
```
content string
  → react-markdown
    → remark-gfm (tables, strikethrough, task lists)
    → remark-math (parse $...$ / $$...$$)
    → rehype-katex (render math via KaTeX)
    → rehype-sanitize (strip ALL HTML + images)
  → sanitized React elements
```

No `![alt](url)` support. No raw HTML. Only uploaded media rendered as controlled components below text.

---

## Step 3 — Database Migration

**Migration file:** `supabase/migrations/20260617000000_flashcard_media.sql`

```sql
ALTER TABLE public.flashcards
  ADD COLUMN media jsonb NOT NULL DEFAULT '[]'::jsonb;
```

No ALTER on `front`/`back` needed — they're already `text` (unbounded in Postgres).

**Schema file update:** `supabase/schemas/30_flashcards.sql` — add `media jsonb DEFAULT '[]'::jsonb` to `CREATE TABLE`.

**Config update:** `supabase/config.toml` — add storage bucket:
```toml
[storage.buckets.flashcard-media]
public = false
file_size_limit = "50MiB"
allowed_mime_types = ["image/png", "image/jpeg", "image/gif", "image/webp", "audio/mpeg", "audio/wav", "audio/ogg"]
```

---

## Step 4 — Backend: Storage Service

**File:** `src/server/services/storage.service.ts`

```typescript
class StorageService {
  async uploadFile(userId: string, file: File): Promise<{ type: 'image'|'audio', url: string }>
  async deleteFile(url: string): Promise<void>
}
```

- Uses `createServiceClient()` from `@/lib/supabase/service`
- Stores at `flashcard-media/{userId}/{uuid}.{ext}`
- Returns public URL

**Barrel export:** add to `src/server/services/index.ts`

---

## Step 5 — Backend: Upload Route

**Route:** `src/app/(backend)/api/v1/flashcards/media/upload/route.ts`

| Detail | Value |
|--------|-------|
| Method | `POST` |
| Auth | `withAuth` |
| Body | `multipart/form-data` with `file` field |
| Validation | file.type must be `image/*` or `audio/*`, file.size ≤ 50MiB |
| Response | `{ success: true, data: { type: 'image'|'audio', url } }` |

**Model:** Add `MediaUploadSchema` to `flashcard.model.ts`

**Controller:** Add `uploadMedia` method to `FlashcardController`

---

## Step 6 — Backend: Flashcard Model Updates

**File:** `src/server/models/flashcard.model.ts`

New schema:
```typescript
export const MediaItemSchema = z.object({
  type: z.enum(['image', 'audio']),
  url: z.string(),
  alt: z.string().optional(),
});
```

Add to existing schemas:
| Schema | Change |
|--------|--------|
| `CreateFlashcardSchema` | `front`/`back` max(255) → max(5000). Add `media: z.array(MediaItemSchema).optional()`. |
| `UpdateFlashcardSchema` | Same. |
| `BulkCreateFlashcardsSchema` | Same. |

**File:** `src/server/models/flashcard-import.model.ts`
- `CsvImportRowSchema`: `front`/`back` max(255) → max(5000)

---

## Step 7 — Backend: Flashcard Service Updates

**File:** `src/server/services/flashcard.service.ts`

Pass `media` through in every insert/update:

| Method | Change |
|--------|--------|
| `create()` | `media: data.media ?? []` in insert payload |
| `update()` | `if (data.media) updateFields.media = data.media` |
| `bulkCreate()` | `media: data.media ?? []` in each card insert |
| `copy()` | `media: original.media` in insert payload |
| `batchCopy()` | `media: fc.media` in each card insert |

---

## Step 8 — Frontend: MediaUpload Component

**File:** `src/components/flashcards/media-upload.tsx`

Props: `{ media: MediaItem[], onChange: (media: MediaItem[]) => void }`

Features:
- Drag-and-drop zone + file picker button
- Accepts `image/*, audio/*`
- Validates file size client-side before upload
- Calls `POST /api/v1/flashcards/media/upload` via `apiPost`
- Upload progress indicator (spinner)
- Image preview as thumbnail with remove button
- Audio shows filename + remove button
- Max 10 items per card

---

## Step 9 — Frontend: FlashcardCard Updates

**File:** `src/components/flashcards/flashcard-card.tsx`

```
Replace:  <p>{fc.front}</p>       →  <MarkdownRenderer content={fc.front} />
          <p>{fc.back}</p>        →  <MarkdownRenderer content={fc.back} />

Add below card content:
{fc.media?.map((item) => (
  item.type === 'image'
    ? <img src={item.url} alt={item.alt ?? ''} className="rounded-lg max-h-48 object-contain" />
    : <audio src={item.url} controls className="w-full" />
))}
```

---

## Step 10 — Frontend: SessionClient Updates

**File:** `src/app/(frontend)/app/flashcards/session/session-client.tsx`

Same pattern as FlashcardCard:
- Replace `<p>{currentCard.front}</p>` → `<MarkdownRenderer content={currentCard.front} />`
- Same for back
- Add `media` to local `Flashcard` interface
- Render images/audio below card text

---

## Step 11 — Frontend: DeckDetailDialogs Updates

**File:** `src/components/flashcards/deck-detail-dialogs.tsx`

| Change | Detail |
|--------|--------|
| `DialogsState.formData` | Add `media: MediaItem[]` |
| Create dialog | Add `<MediaUpload>` below topics section. Increase textarea rows 3→6. |
| Edit dialog | Same, pre-populated with existing media. |
| View topic dialog | Render front/back via `<MarkdownRenderer>` |
| Pre-save | Apply `formatMarkdown(formData.front)` and `formatMarkdown(formData.back)` |
| `onFormDataChange` handler | Thread `media` through |

---

## Step 12 — Frontend: All Other Render Sites

Replace `<p>{fc.front}</p>` + `<p>{fc.back}</p>` with `<MarkdownRenderer>` in:

| File | Location |
|------|----------|
| `topic-management-screen.tsx` | Flashcard list items |
| `difficulty-client.tsx` (or stats) | Card preview in stats |
| `flashcard-search-result.tsx` | Search result items |
| `stats-detail-client.tsx` | Card detail in stats |

---

## Step 13 — TypeScript Types

**File:** `src/types/flashcards.ts`

```typescript
export interface MediaItem {
  type: 'image' | 'audio';
  url: string;
  alt?: string;
}

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  created_by: string;
  media?: MediaItem[];
  flashcard_topic_assignments?: Array<{ topic_id: string }>;
  flashcard_deck_assignments?: Array<{ deck_id: string }>;
}
```

---

## Step 14 — i18n

Add to `AppFlashcardDeckViewPage` and `EduDeckViewPage` namespaces:

| Key | Default (en) |
|-----|-------------|
| `media_upload_label` | "Images & Audio" |
| `media_upload_hint` | "Drag files here or click to browse" |
| `media_remove` | "Remove" |
| `media_upload_error` | "Failed to upload file" |
| `media_image_alt` | "Flashcard image" |

---

## Implementation Order

| # | Step | Files |
|---|------|-------|
| 1 | Install npm packages | `package.json` |
| 2 | Create `formatMarkdown` utility | `src/lib/markdown-utils.ts` |
| 3 | Create `MarkdownRenderer` | `src/components/shared/markdown-renderer.tsx` |
| 4 | Migration + schema + config | `supabase/migrations/`, `schemas/`, `config.toml` |
| 5 | Storage service | `src/server/services/storage.service.ts` + `index.ts` |
| 6 | Upload route + model + controller | route, model, controller |
| 7 | Flashcard model updates | `flashcard.model.ts`, `flashcard-import.model.ts` |
| 8 | Flashcard service updates | `flashcard.service.ts` |
| 9 | Media upload component | `src/components/flashcards/media-upload.tsx` |
| 10 | Deck Detail Dialogs (media UI + format) | `deck-detail-dialogs.tsx` |
| 11 | FlashcardCard (Markdown + media render) | `flashcard-card.tsx` |
| 12 | SessionClient (Markdown + media render) | `session-client.tsx` |
| 13 | All other render sites | 4 files |
| 14 | Types | `src/types/flashcards.ts` |
| 15 | i18n | `en.json`, `pl.json` |
| 16 | Route rule check | `src/server/config/routes.config.ts` |

---

## File Inventory

### Created (5)

| Path | Purpose |
|------|---------|
| `src/lib/markdown-utils.ts` | Newline-to-Markdown format helper |
| `src/components/shared/markdown-renderer.tsx` | Shared Markdown + LaTeX renderer |
| `src/server/services/storage.service.ts` | Supabase Storage wrapper (server-side) |
| `src/app/(backend)/api/v1/flashcards/media/upload/route.ts` | File upload endpoint |
| `src/components/flashcards/media-upload.tsx` | Drag-drop upload component |
| `supabase/migrations/20260617000000_flashcard_media.sql` | Add `media jsonb` column |

### Modified (14)

| Path | Changes |
|------|---------|
| `supabase/schemas/30_flashcards.sql` | Add `media jsonb` column |
| `supabase/config.toml` | Add `flashcard-media` bucket config |
| `src/server/models/flashcard.model.ts` | `MediaItemSchema`, relax limits, add `media` field |
| `src/server/models/flashcard-import.model.ts` | Relax front/back max → 5000 |
| `src/server/services/flashcard.service.ts` | Pass `media` through CRUD |
| `src/server/services/index.ts` | Barrel export for `storage.service.ts` |
| `src/server/controllers/flashcard.controller.ts` | `uploadMedia` method |
| `src/types/flashcards.ts` | `MediaItem` type, `media` on `Flashcard` |
| `src/components/flashcards/flashcard-card.tsx` | `MarkdownRenderer` + media render |
| `src/components/flashcards/deck-detail-dialogs.tsx` | Media upload, formatMarkdown, larger textareas |
| `src/app/(frontend)/app/flashcards/session/session-client.tsx` | `MarkdownRenderer` + media render |
| `src/components/flashcards/topic-management-screen.tsx` | `MarkdownRenderer` |
| `src/components/search/flashcard-search-result.tsx` | `MarkdownRenderer` |
| `src/i18n/messages/en.json` + `pl.json` | 5 media keys |
