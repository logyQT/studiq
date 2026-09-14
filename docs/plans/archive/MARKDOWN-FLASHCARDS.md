# Phase 3.1 — Media in Cards (Markdown + Inline LaTeX)

Implementation record for Markdown formatting, inline LaTeX math, and image/audio media in flashcards.

> **Status:** Implemented (with architectural deviations from original plan)
> **Last updated:** 2026-06-15

---

## Architecture

Media is embedded **inline as Markdown** within flashcard `front`/`back` text fields. No separate `media` column exists.

```
┌─────────────┐     POST /api/v1/flashcards/media/upload     ┌──────────────┐
│  Browser     │ ──── multipart/form-data ────────────────→ │  Next.js API  │
│  (Editor)    │                                             │  (withAuth)   │
│              │ ←── { url } ─────────────────────────────── │               │
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

### Media format in flashcard text

- **Images:** `![alt text](url)` — standard Markdown image syntax
- **Audio:** `<audio controls src="url"></audio>` — raw HTML (allowed by `rehype-raw`)

Media is inserted by the `FlashcardEditor` toolbar (upload button or drag-and-drop) directly into the textarea as Markdown/HTML text. There is no structured `media` JSONB column.

---

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Upload path** | Server-side | Consistent with existing auth, no storage RLS, file validation server-side |
| **Media storage** | Inline Markdown (not JSONB) | Simpler architecture — no schema changes, media travels with the text, works with CSV import/export |
| **External images** | Allowed | `rehype-raw` + `rehype-sanitize` with custom schema permits `![alt](url)` and `<audio>` tags |
| **Audio rendering** | Custom `AudioPlayer` component | Polished UI with play/pause, seekable progress bar, time display |
| **LaTeX rendering** | `rehype-sanitize` before `rehype-katex` | Prevents sanitize from stripping KaTeX-generated HTML (documented approach) |
| **Markdown in editor** | Rich editor with toolbar | `FlashcardEditor` component with formatting toolbar, live preview, inline media upload |
| **Newline handling** | Pre-save transform | `formatMarkdown()` converts single newlines to Markdown line breaks (`  \n`) on save, with `$$` delimiter awareness |
| **rehype-raw** | Included | Needed to parse inline `<audio>` HTML tags in flashcard content |

---

## Dependencies

```
bun add react-markdown remark-gfm rehype-raw rehype-sanitize katex remark-math rehype-katex
```

7 packages. KaTeX ships its own types.

---

## Step 1 — Newline Format Helper ✅

**File:** `src/lib/markdown-utils.ts`

```typescript
export function formatMarkdown(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n');
  const paragraphs = normalized.split(/\n{2,}/);
  const formatted = paragraphs.map((p) => {
    const lines = p.split('\n');
    return lines
      .map((line, i, arr) => {
        if (line.trim() === '$$') return line;       // preserve display-math delimiters
        if (i < arr.length - 1) return line + '  ';  // Markdown hard line break
        return line;
      })
      .join('\n');
  });
  return formatted.join('\n\n');
}
```

**Deviation from plan:** Added `$$` display-math guard to prevent broken KaTeX rendering when newlines are converted to Markdown hard-breaks.

Called in `deck-detail-screen.tsx` before create/update mutations.

---

## Step 2 — Shared MarkdownRenderer ✅

**File:** `src/components/shared/markdown-renderer.tsx`

Props: `{ content: string, className?: string }`

Pipeline:
```
content string
  → react-markdown
    → remark-gfm (tables, strikethrough, task lists)
    → remark-math (parse $...$ / $$...$$)
    → rehype-raw (parse inline HTML: <audio>, <img>)
    → rehype-sanitize (strip dangerous HTML, allow KaTeX classes)
    → rehype-katex (render math via KaTeX)
  → React elements with custom component overrides
```

**Deviations from plan:**
- `rehype-raw` added (not in original plan) — needed for `<audio>` HTML tags
- Plugin order: `rehype-raw → rehype-sanitize → rehype-katex` (plan had `rehype-katex → rehype-sanitize`)
- `rehype-sanitize` runs **before** `rehype-katex` so KaTeX output is preserved
- Sanitize schema extended: allows `audio` tag, `className` on `span`/`div` for KaTeX, `img` rendering
- Extensive custom component overrides: `p`, `ul`, `ol`, `li`, `code`, `strong`, `em`, `blockquote`, `a`, `table`, `th`, `td`, `del`, `img`, `hr`, `audio`
- KaTeX CSS imported directly in this component

---

## Step 3 — Database Migration ✅ (added then reverted)

**Original migration:** `supabase/migrations/20260617000000_flashcard_media.sql`
```sql
ALTER TABLE public.flashcards ADD COLUMN media jsonb NOT NULL DEFAULT '[]'::jsonb;
```

**Reverted:** `supabase/migrations/20260619000000_drop_flashcard_media.sql`
```sql
ALTER TABLE public.flashcards DROP COLUMN media;
```

The `media` column was added then dropped within 2 days. Media is now inline Markdown — no schema column needed.

**Storage bucket config** (`supabase/config.toml`) remains:
```toml
[storage.buckets.flashcard-media]
public = false
file_size_limit = "50MiB"
allowed_mime_types = ["image/png", "image/jpeg", "image/gif", "image/webp", "audio/mpeg", "audio/wav", "audio/ogg"]
```

---

## Step 4 — Backend: Storage Service ✅

**File:** `src/server/services/storage.service.ts`

```typescript
class StorageService {
  async uploadFile(userId: string, file: File): Promise<{ url: string }>
}
```

**Deviations from plan:**
- Returns `{ url }` only — no `type` field (type is inferred from MIME at upload time)
- `deleteFile` method **not implemented** — file cleanup is not handled
- Uses `createServiceClient()` from `@/lib/supabase/service`
- Stores at `{userId}/{uuid}.{ext}` (relative to bucket)

**Barrel export:** added to `src/server/services/index.ts`

---

## Step 5 — Backend: Upload Route ✅

**Route:** `src/app/(backend)/api/v1/flashcards/media/upload/route.ts`

| Detail | Value |
|--------|-------|
| Method | `POST` |
| Auth | `withAuth` |
| Body | `multipart/form-data` with `file` field |
| Validation | In `StorageService.uploadFile` (MIME type + size) |
| Response | `{ success: true, data: { url: string } }` |

**Deviations from plan:**
- Returns `{ url }` not `{ type, url }`
- No `MediaUploadSchema` — validation is in the service layer
- Route calls `storageService` directly, no controller method

---

## Step 6 — Backend: Flashcard Model Updates ✅ (partial)

**File:** `src/server/models/flashcard.model.ts`

- `front`/`back` max relaxed to 5000 ✅
- `MediaItemSchema` — **not implemented** (not needed with inline Markdown approach)
- `media` field on schemas — **not implemented** (not needed)

**File:** `src/server/models/flashcard-import.model.ts`
- `front`/`back` max relaxed to 5000 ✅

---

## Step 7 — Backend: Flashcard Service Updates ⏭️ Skipped

**File:** `src/server/services/flashcard.service.ts`

Media threading through CRUD was **skipped** — not needed with inline Markdown approach. Media lives in the `front`/`back` text fields, so it's automatically included in all existing CRUD operations.

---

## Step 8 — FlashcardEditor Component ✅ (replaced plan's MediaUpload)

**File:** `src/components/flashcards/flashcard-editor.tsx` — **new, not in original plan**

Rich Markdown editor with:
- Formatting toolbar (bold, italic, headings, lists, links)
- Live preview mode via `MarkdownRenderer`
- Inline media upload via toolbar button (uploads → inserts `![name](url)` or `<audio>` into textarea)
- Drag-and-drop file upload onto the editor
- Image/audio file picker

**Replaces:** The planned standalone `MediaUpload` component (`media-upload.tsx`) was never created. Media upload is embedded directly in the editor toolbar.

**File:** `src/components/flashcards/flashcard-editor-dialog.tsx` — **new, not in original plan**

Dialog wrapper around `FlashcardEditor` with topic selection (`MultiSelect`) and save/cancel buttons. Used by `deck-detail-dialogs.tsx` for both create and edit modes.

---

## Step 9 — FlashcardCard Updates ✅

**File:** `src/components/flashcards/flashcard-card.tsx`

- `<p>{fc.front}</p>` → `<MarkdownRenderer content={fc.front} />` ✅
- `<p>{fc.back}</p>` → `<MarkdownRenderer content={fc.back} />` ✅
- Separate media rendering below text — **skipped** (media is inline in the text, rendered by MarkdownRenderer)
- Flip mechanism: CSS grid overlay with `[grid-area:1/1]` + `invisible` toggle
- Topic dots: absolute-positioned at bottom-left, hover-reveal

---

## Step 10 — SessionClient Updates ✅

**File:** `src/app/(frontend)/app/flashcards/session/session-client.tsx`

- `<p>{currentCard.front}</p>` → `<MarkdownRenderer content={currentCard.front} />` ✅
- `<p>{currentCard.back}</p>` → `<MarkdownRenderer content={currentCard.back} />` ✅
- Separate media rendering — **skipped** (inline in text)
- `media` in local interface — **skipped** (not needed)

---

## Step 11 — DeckDetailDialogs Updates ✅

**File:** `src/components/flashcards/deck-detail-dialogs.tsx`

- Uses `FlashcardEditorDialog` (new abstraction) instead of direct textarea + MediaUpload ✅
- `formatMarkdown` called in parent `deck-detail-screen.tsx` ✅
- View topic dialog renders front/back via `<MarkdownRenderer>` ✅
- `media` in `DialogsState.formData` — **skipped** (not needed)

---

## Step 12 — Other Render Sites ✅

| File | Status |
|------|--------|
| `topic-management-screen.tsx` | ✅ Uses `<MarkdownRenderer>` |
| `difficulty-client.tsx` | ✅ Uses `<MarkdownRenderer>` |
| `flashcard-search-result.tsx` | ⏭️ N/A — renders deck-level results, not flashcard content |

---

## Step 13 — TypeScript Types ⏭️ Skipped

**File:** `src/types/flashcards.ts`

`MediaItem` type and `media` field on `Flashcard` — **not implemented**. Not needed with inline Markdown approach.

---

## Step 14 — i18n ✅ (partial)

Added keys (different from planned):

| Key | Value (en) | Namespace |
|-----|-----------|-----------|
| `media_label` | "Media (Optional)" | `AppFlashcardDeckViewPage` |
| `toolbar_bold` | "Bold" | `FlashcardEditorComponent` |
| `toolbar_italic` | "Italic" | `FlashcardEditorComponent` |
| `toolbar_heading1` | "Heading 1" | `FlashcardEditorComponent` |
| `toolbar_heading2` | "Heading 2" | `FlashcardEditorComponent` |
| `toolbar_bullet_list` | "Bullet List" | `FlashcardEditorComponent` |
| `toolbar_ordered_list` | "Ordered List" | `FlashcardEditorComponent` |
| `toolbar_link` | "Link" | `FlashcardEditorComponent` |
| `toolbar_upload_media` | "Upload Media" | `FlashcardEditorComponent` |
| `toolbar_edit` | "Edit" | `FlashcardEditorComponent` |
| `toolbar_preview` | "Preview" | `FlashcardEditorComponent` |
| `link_url_prompt` | "Link URL" | `FlashcardEditorComponent` |
| `link_default_text` | "link text" | `FlashcardEditorComponent` |
| `front_label` | "Front Side (Question)" | `FlashcardEditorComponent` |
| `back_label` | "Back Side (Answer)" | `FlashcardEditorComponent` |
| `front_placeholder` | "Enter the question or prompt..." | `FlashcardEditorComponent` |
| `back_placeholder` | "Enter the answer or explanation..." | `FlashcardEditorComponent` |
| `placeholder` | "Select..." | `MultiSelectComponent` |
| `no_results` | "No results found." | `MultiSelectComponent` |
| `search` | "Search..." | `MultiSelectComponent` |

Planned keys (`media_upload_label`, `media_upload_hint`, `media_remove`, `media_upload_error`, `media_image_alt`) — **not added**.

---

## Additional Components (not in original plan)

### AudioPlayer ✅

**File:** `src/components/shared/audio-player.tsx`

Custom audio player with:
- Play/pause button
- Seekable progress bar
- Time display (current / total)
- `stopPropagation()` to prevent card flip on click

Replaces the planned simple `<audio controls>` with a polished UI.

### Markdown Converter ✅

**File:** `src/lib/markdown-converter.ts`

Utility for HTML ↔ Markdown conversion using `marked` and `turndown`. Currently unused — created for potential future use (e.g., importing HTML content).

---

## File Inventory

### Created (8)

| Path | Purpose | In Plan? |
|------|---------|----------|
| `src/lib/markdown-utils.ts` | Newline-to-Markdown format helper (math-aware) | ✅ |
| `src/components/shared/markdown-renderer.tsx` | Shared Markdown + LaTeX renderer | ✅ |
| `src/components/shared/audio-player.tsx` | Custom audio player component | ❌ Added |
| `src/server/services/storage.service.ts` | Supabase Storage upload wrapper | ✅ |
| `src/app/(backend)/api/v1/flashcards/media/upload/route.ts` | File upload endpoint | ✅ |
| `src/components/flashcards/flashcard-editor.tsx` | Rich Markdown editor with toolbar + preview | ❌ Added |
| `src/components/flashcards/flashcard-editor-dialog.tsx` | Dialog wrapper for editor | ❌ Added |
| `src/lib/markdown-converter.ts` | HTML ↔ Markdown conversion utility | ❌ Added |

### Modified (10)

| Path | Changes | In Plan? |
|------|---------|----------|
| `supabase/config.toml` | Add `flashcard-media` bucket config | ✅ |
| `src/server/models/flashcard.model.ts` | Relax front/back max → 5000 | ✅ |
| `src/server/models/flashcard-import.model.ts` | Relax front/back max → 5000 | ✅ |
| `src/server/services/index.ts` | Barrel export for `storage.service.ts` | ✅ |
| `src/components/flashcards/flashcard-card.tsx` | MarkdownRenderer + flip fix + topic dots | ✅ (partially) |
| `src/components/flashcards/deck-detail-dialogs.tsx` | FlashcardEditorDialog, formatMarkdown | ✅ (different approach) |
| `src/app/(frontend)/app/flashcards/session/session-client.tsx` | MarkdownRenderer | ✅ |
| `src/components/flashcards/topic-management-screen.tsx` | MarkdownRenderer | ✅ |
| `src/components/flashcards/deck-detail-screen.tsx` | formatMarkdown on save, Editor button removed | ✅ (partially) |
| `src/i18n/messages/en.json` + `pl.json` | Editor component + MultiSelect keys | ✅ (different keys) |

### Skipped from plan

| Item | Reason |
|------|--------|
| `media-upload.tsx` component | Replaced by FlashcardEditor toolbar upload |
| `MediaItemSchema` (flashcard.model.ts) | Not needed — media is inline Markdown |
| `media` field on Flashcard type | Not needed — media is inline Markdown |
| `media` field on CRUD schemas | Not needed — media is inline Markdown |
| `media` threading in flashcard.service.ts | Not needed — media is inline in front/back |
| `deleteFile` on StorageService | Not implemented |
| `uploadMedia` controller method | Route calls service directly |
| `MediaUploadSchema` | Not implemented |
| 5 planned i18n keys | Replaced by editor component keys |
