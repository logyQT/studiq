# OpenCode Prompt: Flashcard Learning Application with i18n and Multi-Theme Support

## Design Requirements

Build a complete flashcard learning application with the following architecture and features. **CRITICAL: All design must be internationalization (i18n) ready and support multiple themes (light/dark mode at minimum). Use existing backend API architecture - all endpoints already exist, frontend only needs to send correct requests.**

---

## Application Structure & Navigation

### Hierarchical Flow

```
Dashboard (/app)
  ├─→ Flashcard Decks (/app/flashcards)
  │     ├─→ Individual Deck View (/app/flashcards/deck/:deckId)
  │     │     └─→ Create/View/Manage Flashcards within this deck
  │     └─→ Topics Manager (/app/flashcards/topics)
  │           └─→ Create/Delete/Browse topics and their flashcards
  └─→ Study Mode (copy the existing "practice" modes to a new view for example (/app/flashcards/practice) link should be on (/app/flashcards))
```

**Key Navigation Rules:**

- Users MUST select a deck before creating flashcards
- Each flashcard MUST be assigned to at least one deck (primary deck)
- Topics are managed separately but applied during flashcard creation

---

## 1. Dashboard (Flashcards "landing" page)

**Layout:**

- Hero section with app title and tagline
- 3 main action cards in grid layout (responsive: mobile stack, desktop 3-column)

**Action Cards:**

1. **Decks Card**
   - Icon: Layers/Deck icon with gradient background
   - Title: "Decks"
   - Description: Browse and manage flashcard decks
   - Action: Navigate to /app/flashcards
   - Visual: Hover effect with scale and border color change

2. **Topics Card**
   - Icon: Tags icon with gradient background
   - Title: "Topics"
   - Description: Organize and manage study topics
   - Action: Navigate to /app/flashcards/topics
   - Visual: Distinct gradient color from Decks

3. **Study Mode Card** (placeholder)
   - Icon: Book icon with gradient background
   - Title: "Study Mode"
   - Description: Start learning with flashcards
   - Actions: Naviagte to /app/flashcards/practice
   - Visual: Different gradient, future implementation

**Design Requirements:**

- Gradient backgrounds on cards and icons
- Smooth hover animations (scale, shadow, border)
- Responsive grid layout
- All text must use i18n keys (no hardcoded strings)
- Theme-aware colors and gradients

---

## 2. Decks System

### Deck List Page (/app/flashcards)

**Header:**

- Navigation breadcrumb: Back to Dashboard button
- Page title: "Flashcard Decks"
- Toggle buttons: "Decks" (active) | "Topics"
- "Create Deck" button (prominent, top-right)

**Deck Display:**

- Grid layout: 2-3 columns depending on viewport
- Each deck card shows:
  - Large gradient background header with icon (unique gradient per deck)
  - Deck name (bold, prominent)
  - Description text (optional, secondary style)
  - Flashcard count with icon
  - "Open" button
- Hover effects: elevation increase, scale transform, border highlight
- Click anywhere on card OR "Open" button → navigate to deck view

**Create Deck Dialog:**

- Modal/dialog overlay
- Fields:
  - Name (required, text input)
  - Description (optional, textarea)
- Actions: Cancel | Create Deck
- Auto-generate random gradient color on creation
- Toast notification on success

**i18n & Theme Notes:**

- All labels, buttons, placeholders must be translatable
- Gradient colors should respect theme (lighter in dark mode if needed)
- Respect RTL layout for appropriate languages

---

### Individual Deck View (/app/flashcards/deck/:deckId)

**Deck Header Section:**

- Full-width gradient banner (deck's assigned color)
- Deck icon + name (large heading)
- Description
- Flashcard count indicator (create a placeholder for due cound indicator - commented out for now)

**Flashcard Management Section:**

- Section title: "Flashcards"
- Instructions: "Click a card to flip and reveal the answer"
- "New Flashcard" button (prominent, with + icon)

**Flashcard Grid Display:**

- Responsive grid: 2-3 columns
- Empty state (no flashcards):
  - Centered empty icon
  - Message: "No flashcards yet"
  - Description: "Start creating flashcards to begin learning"
  - "Create Your First Flashcard" button

**Flashcard Card Component:**

- Min height ~200px
- Click to flip functionality
- Two states:
  - **Front (Question)**: White background, question text centered
  - **Back (Answer)**: Colored gradient background, answer text centered
- Visual flip indicator badge: "Question" | "Answer" (bottom-center)
- Topics section (bottom of card):
  - Colored pill badges showing assigned topics
  - Each pill: small colored dot + topic name
  - "No topics" text if empty
- **3-dot menu** (top-right corner):
  - Hidden by default
  - Shows on card hover with fade-in animation
  - Opens options dropdown menu

**Flashcard Options Menu (3-dot dropdown):**

Menu structure:

```
┌─ Flashcard Options ─────────────┐
├─ Edit Flashcard                 │
├─ Quick Topic Actions        ►   │ (submenu)
│  ├─ Add Topics                  │
│  ├─ Remove Topics                │
│  └─ View by Topic                │
├─────────────────────────────────│
├─ Link with Another Deck        │
├─ Copy to Another Deck           │
├─────────────────────────────────│
└─ Delete Flashcard (destructive semantics)    │
```

**Menu Actions Explained:**

1. **Edit Flashcard**: Opens edit dialog with pre-filled front/back/topics

2. **Quick Topic Actions** (submenu):
   - Add Topics: Quick-add topics to this card
   - Remove Topics: Quick-remove topics from this card
   - View by Topic: Filter/navigate to topic view

3. **Link with Another Deck**:
   - Opens modal dialog
   - Title: "Link Flashcard with Other Decks"
   - Description: "The SAME flashcard will be available in multiple decks. Changes will sync across all decks."
   - Shows list of available decks (excluding current deck)
   - Each deck: checkbox + name + description
   - Can select multiple decks
   - Action button: "Share with X deck(s)"
   - **Backend behavior**: Creates associations, same flashcard ID referenced in multiple decks

4. **Copy to Another Deck**:
   - Opens modal dialog
   - Title: "Copy Flashcard to Another Deck"
   - Description: "A NEW flashcard with the same content will be created in the selected deck. They will be independent."
   - Shows list of available decks (excluding current deck)
   - Each deck: radio button / selectable card + name + description + count
   - Can select only ONE deck
   - Action button: "Copy to Deck" (disabled until selection)
   - **Backend behavior**: Creates new flashcard with copied content, new ID
   - After actions: display a modal with "go to the new card" "stay here" with an x as closing indicator, user can also just close it by clicking anywhere that is not the modal body or by pressing ESCAPE

5. **Delete Flashcard**:
   - Confirmation (optional) or immediate delete
   - Toast notification
   - Removes from grid

**i18n & Theme Notes:**

- Flip animation should be smooth and accessible
- All menu labels translatable
- Different visual treatment for "Link" vs "Copy" to make distinction clear
- Modal descriptions must clearly explain sync vs independent behavior

---

## 3. Topics System

### Topics Manager Page (/app/flashcards/topics)

**Header:**

- Navigation breadcrumb: Back to Dashboard
- Page title: "Topics Manager"
- Toggle buttons: "Decks" | "Topics" (active)
- "Create Topic" button

**Topics Grid:**

- 3-4 column responsive grid
- Each topic card shows:
  - Colored square icon with tag symbol (topic's assigned color, hardcode colors for now based on (topic name length%10) to colors lookup table colors=["333", "444", ...etc]) [this needs to be implemented in the backend later]
  - Topic name
  - Flashcard count: "X flashcard(s)"
  - **3-dot menu** (visible on hover):
    - "View Flashcards" → opens flashcard browser dialog
    - "Delete Topic" (red, with confirmation)
  - "Browse Flashcards" button (primary action)

**Create Topic Dialog:**

- Modal overlay
- Field: Topic Name (required)
- Auto-assign random color from predefined palette (for now this will do nothing anyway)
- Actions: Cancel | Create Topic

**View Flashcards Dialog (for a topic):**

- Large modal (max-width ~800px, max-height 80vh)
- Header: Topic icon + name + flashcard count
- Scrollable list of flashcards with this topic
- Empty state: "No flashcards with this topic yet"
- Each flashcard item shows:
  - "Question" label + question text
  - Separator
  - "Answer" label + answer text
  - Separator
  - All assigned topics as colored pills
  - Created date (small, secondary text)
- Close button

**i18n & Theme Notes:**

- Color palette should have sufficient contrast in both themes
- All singular/plural forms handled ("1 flashcard" vs "X flashcards")
- Scrollable areas must be keyboard accessible

---

## 4. Create Flashcard Flow

**Trigger:** "New Flashcard" button in deck view

**Create Flashcard Dialog:**

- Large modal (max-width ~700px)
- Title: "Create New Flashcard"
- Description: "Add a new flashcard to this deck. You can assign multiple topics."

**Form Fields:**

1. **Front Side (Question)**
   - Label: "Front Side (Question)"
   - Input: Textarea (min-height ~100px)
   - Placeholder: "Enter the question or prompt..."
   - Required

2. **Back Side (Answer)**
   - Label: "Back Side (Answer)"
   - Input: Textarea (min-height ~100px)
   - Placeholder: "Enter the answer or explanation..."
   - Required

3. **Topics (Optional)**
   - Label: "Topics (Optional)"
   - Description: "Assign topics to organize and filter your flashcards"
   - Input: Combobox/searchable dropdown button
   - Button text: "Select topics..." with chevron icon
   - Opens dropdown with:
     - Search input: "Search topics..."
     - Scrollable list of all available topics
     - Each topic: checkmark (if selected) + colored dot + topic name
     - Click to toggle selection
   - **Selected topics display:**
     - Show below dropdown as colored pill badges
     - Each pill: colored dot + topic name + X remove button
     - Click X to remove topic
     - Pills container has background color (e.g., light gray)

**Form Actions:**

- Cancel button (secondary)
- "Create Flashcard" button (primary, disabled if front or back empty)

**Validation:**

- Both front and back required
- Topics optional (can be 0, 1, or many)

**On Success:**

- Close dialog
- Reset form
- Show toast: "Flashcard created successfully!"
- New flashcard appears at top of deck grid
- Backend receives: deckId, front, back, topicIds[]

**i18n & Theme Notes:**

- Placeholder text must be translatable
- Help text ("Assign topics to organize...") translatable
- Topic search should support native language topic names
- Form validation messages translatable

---

## 5. General UX Requirements

**Navigation:**

- Sticky header with breadcrumbs/back navigation
- Clear visual hierarchy
- Smooth page transitions

**Feedback:**

- Toast notifications for all actions (create, delete, share, copy)
- Loading states for async operations
- Error handling with user-friendly messages (i18n)

**Accessibility:**

- Keyboard navigation for all interactive elements
- Focus management in modals
- ARIA labels for icon buttons
- Screen reader support

**Responsive Design:**

- Mobile: Single column stacks, bottom sheets for modals
- Tablet: 2-column grids
- Desktop: 3-column grids, side-by-side layouts

---

## 6. i18n (Internationalization) Requirements

**Critical i18n Points:**

1. **No Hardcoded Strings:**
   - All UI text must use translation keys
   - Placeholders, button labels, titles, descriptions
   - Error messages, validation messages, toast notifications

2. **Dynamic Content:**
   - Singular/plural handling: "1 flashcard" vs "X flashcards"
   - Date formatting based on locale
   - Number formatting

3. **Translation Key Structure (example):**
   - read existing i18n files in /src/i18n/messages

---

## 7. Multi-Theme Support Requirements

**Theme System:**

- Support at minimum: Light mode, Dark mode
- Extensible for additional themes (e.g., high contrast, custom brand themes)

**Theme-Aware Elements:**

1. **Colors:**
   - Background colors (page, cards, modals)
   - Text colors (primary, secondary, muted)
   - Border colors
   - Gradient colors (may need adjustments for dark mode)
   - Accent colors (buttons, badges, highlights)

2. **Contrast:**
   - Ensure WCAG AA compliance in all themes
   - Colored pills/badges must have sufficient contrast
   - Gradient backgrounds maintain readability

3. **Theme Toggle:** (this is already implemented)
   - Provide theme switcher (user preference)
   - Persist theme choice
   - Respect system preference by default

4. **Component Adjustments:**
   - Cards: background and shadow changes
   - Modals: overlay opacity, background
   - Buttons: hover states adjust to theme
   - Inputs: background, border, focus states
   - Icons: may need color inversions

---

## 8. Backend Integration Notes

**CRITICAL: Backend APIs already exist. Frontend sends requests to existing endpoints.**

**Expected API Patterns:**

1. **Decks:**
   - GET /api/v1/flashcards/decks - list all decks
   - POST /api/v1/flashcards/decks - create deck (body: {name, description})
   - GET /api/v1/flashcards/decks/:id - get single deck (flashcard_deck_assignments:[] can be used for quickly calculating how many flashcards are in a deck, might implement count endpoints in the future)
   - DELETE /api/v1/flashcards/decks/:id - delete deck

2. **Flashcards:**
   - GET /api/v1/flashcards?deckIds=... - list flashcards in deck
   - POST /api/v1/flashcards - create flashcard (body: {deckId, front, back, topicIds[]})
   - PUT /api/v1/flashcards/:id - update flashcard
   - DELETE /api/v1/flashcards/:id - delete flashcard
   - POST /api/v1/flashcards/:id/share - share with decks (body: {deckIds[]})
   - POST /api/v1/flashcards/:id/copy - copy to deck (body: {targetDeckId})

3. **Topics:**
   - GET /api/v1/flashcards/topics - list all topics
   - POST /api/v1/flashcards/topics - create topic (body: {name})
   - GET /api/v1/flashcards?topicIds=... - get flashcards with topic
   - DELETE /api/v1/flashcards/topics/:id - delete topic

**Frontend Responsibilities:**

- Send correct HTTP methods and request bodies
- Handle loading states during requests !!! DO NOT USE UseEffect !!! Make use of skeleton loading (loading.tsx, page.tsx pattern with ...-client.tsx files)
- Parse and display response data
- Handle error responses with user-friendly messages
- Implement optimistic UI updates where appropriate

---

## 9. Technical Stack Recommendations

**Framework:** Next.js React with TypeScript
**Routing:** React Router (data router pattern)
**Styling:** Tailwind CSS v4 (utility-first, theme support)
**UI Components:** Shadcn/ui or similar (accessible, themeable)
**i18n Library:** react-i18next or similar
**Theme Library:** next-themes or custom CSS variables approach
**Icons:** Lucide React

---

## 10. Implementation Priorities

1. **Phase 1:** Dashboard + Deck List + Basic Deck View
2. **Phase 2:** Create Flashcard + View/Flip Flashcards
3. **Phase 3:** Topics Management + Topic Assignment
4. **Phase 4:** Flashcard Options (Share, Copy, Delete)
5. **Phase 5:** i18n Integration (all strings)
6. **Phase 6:** Multi-Theme Support + Accessibility Polish

---

## Design Philosophy

- **Clarity over complexity:** Clear visual hierarchy, obvious actions
- **Progressive disclosure:** Show advanced options (3-dot menu) on demand
- **Feedback-rich:** Every action gets acknowledgment
- **Accessible by default:** Keyboard, screen reader, color contrast
- **International from day one:** i18n structure from the start, not retrofitted
- **Theme-agnostic:** Design works beautifully in light and dark modes

---

**REMINDER: Use existing backend architecture. All endpoints exist. Frontend only needs to send correctly structured requests. Design must be i18n-ready (all text translatable, RTL support, locale-aware formatting) and multi-theme ready (color variables, theme context, theme switcher).**
