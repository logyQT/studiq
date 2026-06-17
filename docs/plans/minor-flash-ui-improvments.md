# Minor Flashcard UI Improvements

## 1. Flashcard Card (`flashcard-card.tsx`)

- [x] Add 3D flip animation (CSS perspective + rotateY) — currently swaps front/back via visibility toggle with no transition
- [ ] Show three-dot menu on touch devices — currently `opacity-0 group-hover:opacity-100`, invisible and unreachable on mobile
- [ ] Show topic dots on touch devices — same hover-only issue, users never see which topics a card belongs to
- [ ] Handle long content — add scroll or gradient fade instead of silent clip at `max-h-96`

## 2. Deck List (`deck-management-screen.tsx`)

- [ ] Remove inline edit/delete buttons from cards → context menu on both platforms
- [ ] Remove mobile "Manage" dropdown → context menu + FAB replaces all its actions
- [ ] Add floating "+" FAB for new deck on mobile (bottom-right fixed position)
- [ ] Add context menu with: Select, Edit, Delete, Import CSV, Export CSV
- [ ] Improve empty state — currently bare text, needs icon + "Create your first deck" CTA button
- [ ] Extract `GRADIENTS` / `getGradient` to shared utility (duplicated in deck-detail-screen)

## 3. Deck Detail (`deck-detail-screen.tsx`)

- [ ] Move header action buttons (edit, import, export, delete) to context menu
- [ ] Fix flashcard count — currently shows `flashcards.length` (loaded slice), should use `currentDeck.flashcard_count` or API total
- [ ] Add back-to-top button after scrolling through many cards via infinite scroll
- [ ] Improve empty state with descriptive subtitle ("This deck is empty. Add your first flashcard to start studying.")
- [ ] Extract `GRADIENTS` / `getGradient` to shared utility

## 4. Topics (`topic-management-screen.tsx`)

- [ ] Add context menu for edit/delete on both platforms (currently hover-only buttons)
- [ ] Improve empty state — currently bare text, needs icon + "Create your first topic" CTA button
- [ ] Fix color distribution — currently `name.length % 10`, should use a proper hash function
- [ ] Extract `TOPIC_COLORS` / `getTopicColor` to shared utility (duplicated in flashcard-card.tsx)

## 5. Flashcard Editor (`flashcard-editor.tsx`)

- [ ] Add `min-h-[120px]` to textareas — on short mobile viewports they shrink to 2-3 lines
- [ ] Remove H4-H6 from toolbar — rarely used, adds clutter (3 fewer buttons)
- [ ] Add drag-and-drop visual feedback — currently no indicator when dragging files over editor
- [ ] Use `Button variant="ghost"` instead of `Toggle` for insert actions (bold, italic, headings, etc.) — Toggle is semantically wrong for one-shot actions

## 6. Study Session (`session-client.tsx`)

- [ ] Add 3D flip animation — same as flashcard-card, core study UX feels abrupt
- [ ] Style answer buttons — red tint for Again/Hard, green tint for Good/Easy (currently all same variant, only icon colors differ)
- [ ] Hide keyboard shortcut toast on mobile — irrelevant to touch users, wastes 3 seconds of screen time
- [ ] Add swipe gestures for card flip on mobile (swipe up to reveal answer)
- [ ] Move exit button to bottom-left on mobile — currently top-right, hard to reach
- [ ] Add progress indicator for unlimited mode — currently no sense of progress or completion

## 7. Shared / Cross-cutting

- [ ] Standardize responsive breakpoints — deck list uses `lg`, deck detail uses `md`, causes inconsistent layout on tablets
- [ ] Extract duplicated utilities — `GRADIENTS`/`getGradient` (2 copies), `TOPIC_COLORS`/`getTopicColor` (2 copies)

---

## Priority Tiers

| Tier                   | Items                                                         | Rationale                       |
| ---------------------- | ------------------------------------------------------------- | ------------------------------- |
| **P0 — Core UX**       | Flip animation, touch device menus, content overflow          | Broken or unreachable on mobile |
| **P1 — Mobile polish** | FAB, empty states, breakpoint consistency, toast hiding       | Mobile experience gaps          |
| **P2 — Nice to have**  | Editor toolbar cleanup, session button styling, scroll-to-top | Polish, not blocking            |
