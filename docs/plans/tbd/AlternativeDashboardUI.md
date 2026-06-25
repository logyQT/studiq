# Alternative Dashboard UI — Topbar Removal & Sidebar Restructure

> **This is NOT a final spec, just a proposition.** Treat this as a design exploration — not approved for implementation yet.

## Current State

The dashboard has a full-width topbar containing:
- StudiQ logo (desktop only)
- SidebarTrigger hamburger (mobile only)
- AppSearch inline input (on /app and /edu routes)
- UserMenu avatar dropdown (right side)

The sidebar sits below the topbar, offset by `top-14` (3.5rem), with `h-[calc(100svh-3.5rem)]`.

## Proposed Change

**Remove the topbar entirely.** Move its elements into the sidebar and a global search dialog.

---

## Sidebar Structure (New)

### Collapsed State (48px / icon mode)

```
┌──────┐
│ [Q]  │  ← StudiQ icon, hover → becomes toggle
│      │
│ 📊   │
│ 🤖   │
│ 📝   │
│ ...  │
│      │
│ [👤] │  ← avatar only
└──────┘
```

- **Top**: StudiQ GraduationCap icon, centered. On hover, gains a subtle background and becomes a toggle button that expands the sidebar.
- **Middle**: Nav items (unchanged).
- **Bottom**: User avatar only (centered). Opens the same dropdown menu.

### Expanded State (256px)

```
┌────────────────────────┐
│ [Q] StudiQ      [◀]   │  ← logo text + collapse trigger
│                        │
│ 📊 Overview            │
│ 🤖 Q Assistant         │
│ 📝 Flashcards          │
│ ...                    │
│                        │
│ [👤] Teacher           │  ← avatar + first name
└────────────────────────┘
```

- **Top**: StudiQ icon + "StudiQ" text on the left. `<SidebarTrigger />` (PanelLeft icon) on the top-right to collapse.
- **Middle**: Nav items (unchanged).
- **Bottom**: Avatar + first name. Opens the same dropdown menu.

---

## Search — Command Palette Dialog

The inline `AppSearch` input is replaced by a **dialog popup** triggered by **Ctrl+K** (or **Cmd+K** on macOS).

- No search bar visible in the UI at any time
- Keyboard shortcut opens a centered dialog with an autofocus search input
- Results appear below the input as the user types (same debounced API query)
- Escape or click outside closes the dialog
- Search logic (API call, result rendering, keyboard navigation) stays identical to current implementation

---

## Topbar Removal

The entire `<header>` element is deleted from `DashboardLayout.tsx`:

| Element | Before | After |
|---|---|---|
| StudiQ logo | Topbar (desktop) | Sidebar header |
| SidebarTrigger | Topbar (mobile) | Sidebar header (always visible) |
| AppSearch | Topbar (inline) | Global Ctrl+K dialog |
| UserMenu | Topbar (right) | Sidebar footer |

### Sidebar Height Update

- Before: `!top-14 !h-[calc(100svh-3.5rem)]` (offset for topbar)
- After: `!top-0 !h-svh` (full viewport height)

---

## Files Affected

| File | Change |
|---|---|
| `src/components/layout/DashboardLayout.tsx` | Remove topbar, restructure sidebar with SidebarHeader/Footer, update height classes |
| `src/components/layout/app-search.tsx` | Rewrite from inline input to Ctrl+K dialog |
| `src/components/layout/user-menu.tsx` | Add `compact` prop for avatar-only mode |

No changes to: breadcrumbs, main content, fullWidth logic, i18n keys (except optional tooltip key for search shortcut).

---

## Open Questions

1. **Collapsed sidebar hover behavior**: Should the icon morph into a PanelLeft toggle, or should the icon stay and a separate toggle button fades in on top?
2. **Mobile behavior**: The current mobile sheet sidebar works well. Should the trigger stay as a hamburger icon, or become the StudiQ icon that opens the sheet on tap?
3. **Search dialog styling**: Plain dialog, or command palette style (like VS Code / Linear / Raycast)?
4. **UserMenu expanded layout**: Avatar + name on one line, or stacked (avatar above name)?

---

*Created: 2026-06-17 | Status: Proposition — not approved*
