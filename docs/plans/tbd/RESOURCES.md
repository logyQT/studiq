# My Resources Feature — Implementation Plan

## Overview
A global per-user resource management system at `/app/resources` with database-backed folders, plus a side panel in the flashcard editor for quick resource insertion.

---

## 1. Database Schema

**Migration:** `supabase/migrations/20260620000000_resources.sql`
**Schema file:** `supabase/schemas/resources.sql`

```sql
-- Folders for organizing resources
CREATE TABLE public.resource_folders (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name       text NOT NULL,
  parent_id  uuid REFERENCES public.resource_folders(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, parent_id, name)
);

-- Resource metadata (actual files live in Supabase storage)
CREATE TABLE public.resources (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  folder_id     uuid REFERENCES public.resource_folders(id) ON DELETE SET NULL,
  original_name text NOT NULL,
  display_name  text NOT NULL,
  storage_path  text NOT NULL UNIQUE,
  mime_type     text NOT NULL,
  file_size     bigint NOT NULL,
  created_at    timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX idx_resources_user_id ON public.resources(user_id);
CREATE INDEX idx_resources_folder_id ON public.resources(folder_id);
CREATE INDEX idx_resource_folders_user_id ON public.resource_folders(user_id);
CREATE INDEX idx_resource_folders_parent_id ON public.resource_folders(parent_id);
```

---

## 2. Services

### `src/server/services/resource.service.ts` (new)

```
ResourceService:
  // Folders
  listFolders(userId, parentId?) → ResourceFolder[]
  createFolder(userId, name, parentId?) → ResourceFolder
  renameFolder(userId, folderId, name) → ResourceFolder
  deleteFolder(userId, folderId) → void  (cascades to subfolders + resources)

  // Resources
  listResources(userId, folderId?) → Resource[]
  uploadResource(userId, file, folderId?, displayName?) → Resource
  renameResource(userId, resourceId, displayName) → Resource
  moveResource(userId, resourceId, folderId | null) → Resource
  deleteResource(userId, resourceId) → void  (also deletes from storage)
```

### `src/server/services/storage.service.ts` (update)

Add methods:
- `listFiles(userId, prefix?)` — list files in user's storage folder
- `deleteFile(userId, storagePath)` — delete a file from storage
- `getSignedUrl(userId, storagePath)` — get temporary signed URL

---

## 3. API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/resources` | List resources (optional `?folderId=`) |
| `POST` | `/api/v1/resources/upload` | Upload a resource (FormData) |
| `PATCH` | `/api/v1/resources/[id]` | Rename/move resource |
| `DELETE` | `/api/v1/resources/[id]` | Delete resource + storage file |
| `GET` | `/api/v1/resources/folders` | List folders |
| `POST` | `/api/v1/resources/folders` | Create folder |
| `PATCH` | `/api/v1/resources/folders/[id]` | Rename folder |
| `DELETE` | `/api/v1/resources/folders/[id]` | Delete folder (cascading) |

**Route config** (`src/server/config/routes.config.ts`):
```typescript
{
  matcher: /^\/api\/v1\/resources(\/.*)?$/,
  requireAuth: true,
  allowedRoles: [UserRole.STUDENT, UserRole.FREE, UserRole.PREMIUM],
}
```

---

## 4. Models

**`src/server/models/resource.model.ts`** (new)

Zod schemas:
- `CreateFolderSchema` — `{ name: string, parentId?: string }`
- `UpdateResourceSchema` — `{ displayName?: string, folderId?: string | null }`
- `RenameFolderSchema` — `{ name: string }`

---

## 5. Controllers

**`src/server/controllers/resource.controller.ts`** (new)

Standard controller pattern with `withErrorHandling`, returning `ControllerResponse`.

---

## 6. Frontend — Resource Management Page

**Route:** `/app/resources`

**Files:**
- `src/app/(frontend)/app/resources/page.tsx` — thin wrapper
- `src/components/resources/resource-management-screen.tsx` — main component

**UI Layout:**
```
┌─────────────────────────────────────────────────┐
│ My Resources                          [+ Upload]│
├─────────────────────────────────────────────────┤
│ 📂 Root  >  📂 Chapter 1                       │
├─────────────────────────────────────────────────┤
│ 📂 Subfolder A    📂 Subfolder B    [+ Folder]  │
├─────────────────────────────────────────────────┤
│ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐      │
│ │ img │ │ img │ │ wav │ │ mp3 │ │ png │      │
│ │ 👆  │ │ 🖼️  │ │ 🔊  │ │ 🔊  │ │ 👆  │      │
│ │name │ │name │ │name │ │name │ │name │      │
│ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘      │
└─────────────────────────────────────────────────┘
```

**Features:**
- Breadcrumb navigation (Root > Folder > Subfolder)
- Grid view with thumbnails (images) or icons (audio)
- Upload button (drag-and-drop zone or file picker)
- Right-click context menu: Rename, Move, Delete
- Folder creation inline (type name, press Enter)
- Sort by name, date, size
- Search/filter

---

## 7. Frontend — Resource Side Panel (Flashcard Editor)

**File:** `src/components/resources/resource-side-panel.tsx` (new)

**Integration:** Added to `FlashcardEditor` component as a toggleable side panel.

**UI Layout:**
```
┌──────────────────┬──────────────────────────────┐
│ Flashcard Editor │ Resource Panel               │
│                  │ ┌──────────────────────────┐ │
│ Front: [textarea]│ │ 📂 All  📂 Chapter 1     │ │
│                  │ ├──────────────────────────┤ │
│ Back:  [textarea]│ │ ┌──┐ ┌──┐ ┌──┐ ┌──┐    │ │
│                  │ │ │🖼│ │🔊│ │🖼│ │🔊│    │ │
│                  │ │ └──┘ └──┘ └──┘ └──┘    │ │
│                  │ │ (drag to insert)         │ │
│                  │ └──────────────────────────┘ │
└──────────────────┴──────────────────────────────┘
```

**Features:**
- Toggle button in editor toolbar (📁 icon)
- Compact grid of resources with thumbnails
- Drag-and-drop onto the textarea inserts the resource
- Click inserts at cursor position
- Folder navigation within the panel
- Quick upload from the panel

**Drag-and-drop flow:**
1. User drags a resource from the side panel
2. `onDrop` handler on the textarea detects the resource data
3. Inserts `![name](url)` for images or `<audio controls src="url"></audio>` for audio at cursor position

---

## 8. Sidebar Navigation

**Update `src/components/layout/DashboardLayout.tsx`:**

Add to `NAV_ITEMS['/app']`:
```typescript
{ titleKey: 'app_resources', href: '/app/resources', icon: FolderOpen },
```

Position: after `app_my_questions`, before `app_statistics`.

---

## 9. Barrel Exports

- `src/server/services/index.ts` — add `resourceService`
- `src/server/controllers/index.ts` — add `resourceController`
- `src/server/models/index.ts` — add resource models

---

## 10. Query Keys

**Update `src/lib/query-keys.ts`:**
```typescript
export const resourceKeys = {
  all: ['resources'] as const,
  list: (folderId?: string) => ['resources', 'list', folderId] as const,
  folders: (parentId?: string) => ['resources', 'folders', parentId] as const,
};
```

---

## 11. i18n Keys

**New namespace `ResourcePage` in both `en.json` and `pl.json`:**
- `title`, `upload`, `new_folder`, `folder_name_placeholder`, `empty_folder`, `empty_root`
- `rename`, `move`, `delete`, `delete_confirm_title`, `delete_confirm_desc`
- `display_name_label`, `display_name_placeholder`
- `drag_to_insert`, `click_to_insert`
- `resource_panel_toggle`

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `supabase/migrations/20260620000000_resources.sql` | Create |
| `supabase/schemas/resources.sql` | Create |
| `src/server/services/resource.service.ts` | Create |
| `src/server/services/storage.service.ts` | Add listFiles, deleteFile |
| `src/server/controllers/resource.controller.ts` | Create |
| `src/server/models/resource.model.ts` | Create |
| `src/app/(backend)/api/v1/resources/route.ts` | Create |
| `src/app/(backend)/api/v1/resources/[id]/route.ts` | Create |
| `src/app/(backend)/api/v1/resources/folders/route.ts` | Create |
| `src/app/(backend)/api/v1/resources/folders/[id]/route.ts` | Create |
| `src/app/(frontend)/app/resources/page.tsx` | Create |
| `src/components/resources/resource-management-screen.tsx` | Create |
| `src/components/resources/resource-side-panel.tsx` | Create |
| `src/components/flashcards/flashcard-editor.tsx` | Add side panel toggle |
| `src/components/layout/DashboardLayout.tsx` | Add nav item |
| `src/server/config/routes.config.ts` | Add route rule |
| `src/lib/query-keys.ts` | Add resourceKeys |
| `src/server/services/index.ts` | Add barrel export |
| `src/server/controllers/index.ts` | Add barrel export |
| `src/i18n/messages/en.json` | Add keys |
| `src/i18n/messages/pl.json` | Add keys |

---

## Implementation Order

1. Database schema + migration
2. Services (resource + storage updates)
3. Models + Controllers
4. API routes + route config
5. Resource management page UI
6. Resource side panel
7. Flashcard editor integration
8. Sidebar nav + i18n
9. Barrel exports + query keys
