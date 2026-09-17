# Frontend Component Testing — Discussion Document

> Status: DECISIONS LOCKED (Q1-Q7 resolved). Do not implement until `docs/plans/foundation-agentic-testing.md` Phase C (monorepo restructure) is complete.
>
> Created: 2026-09-16 | Last updated: 2026-09-16

---

## Chosen approach: Vitest Browser Mode

**`@vitest/browser` + `vitest-browser-react`** — component tests run in a real browser via Playwright. This replaces jsdom/happy-dom entirely.

### Why this over jsdom/happy-dom

1. **Playwright already installed** — `@vitest/browser-playwright` reuses the same browser binaries, zero extra installs
2. **Radix UI everywhere** — shadcn/ui uses portals, focus trapping, overlays. jsdom/happy-dom notoriously struggle with these; real browser = no issues
3. **Single test runner** — same Vitest, same config, no separate toolchain
4. **Stable since Vitest 4.0** (Oct 2025, now at v5.0.1) — not experimental
5. **Built-in extras** — auto-retrying assertions (`expect.element()`), ARIA snapshots, visual browser UI for debugging, built-in `userEvent` via CDP (higher fidelity than jsdom's synthetic dispatch)

### Dependencies to install

```bash
bun add -d @vitest/browser @vitest/browser-playwright vitest-browser-react
```

No `happy-dom`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, or `@testing-library/user-event` needed — browser mode replaces all of them.

### API surface (replaces Testing Library)

```ts
// Instead of 3 Testing Library packages:
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';

// Auto-retrying assertions (replaces waitFor + toBeInTheDocument):
await expect.element(page.getByText('Save')).toBeInTheDocument();

// Real browser interactions via page locators (replaces userEvent from RTL):
await page.getByRole('button', { name: /submit/i }).click();
await page.getByLabelText(/email/i).fill('user@example.com');
```

### Open items specific to browser mode

- **Provider wrappers** still needed (QueryClient, next-intl, next/navigation, etc.) — same regardless of DOM approach
- **MSW (Mock Service Worker)** is Vitest's recommended approach for API mocking in browser mode; evaluate whether to adopt or stick with `vi.mock()`
- **Speed trade-off** — real browser has startup overhead per file, but still much faster than Playwright E2E. Component tests run in isolation (single component in iframe) vs full page navigation. **Not a concern for us** — CI runs locally (lefthook pre-push), there's no remote CI bottleneck or merge queue waiting on test results. Accuracy matters more than shaving seconds off a local run.

---

---

## Why now (and why not yet)

The project has 116 server-side tests (unit + integration) and 10 E2E specs, but **zero** frontend component or hook tests. Every frontend bug found so far (markdown streaming status, flashcard readOnly/skeleton, plan step tracking) was caught in production or manually, then patched without a regression safety net.

The `flashcard-testing-pipeline.md` doc already scoped a focused test effort for the AI chat components — this document zooms out to the full frontend testing story.

**Blocker:** Phase C of the foundation plan moves UI primitives into `packages/ui` and splits the app into `apps/web` + `apps/admin`. Any component test infrastructure built now would need to be reworked when that lands. The discussion below is intentionally written **pre-restructure** — we decide the strategy now, build it on the stable foundation.

---

## Current state summary

| What exists | What's missing |
|---|---|
| Vitest with `node` environment | No browser mode config for component tests |
| 116 server tests (services, controllers, models, guards) | Zero `.test.tsx` files |
| 100+ app components (`src/components/`) | No `vitest-browser-react` or rendering helpers |
| 30+ UI primitives (`packages/ui/src/components/ui/`) | No provider wrappers (QueryClient, next-intl, etc.) |
| `@/` and `#test/` aliases in Vitest + tsconfig | No component test setup |
| 10 Playwright E2E specs (`__tests__/e2e/`) | No component-level interaction tests |
| `flashcard-testing-pipeline.md` scoped for AI chat | Not yet executed |

---

## Open questions (need discussion)

### Q1: DOM environment ✅ DECIDED — Vitest Browser Mode

**Decision:** Neither jsdom nor happy-dom. We use `@vitest/browser` with Playwright — components run in a real browser.

This eliminates the jsdom/happy-dom trade-off entirely. Radix portals, focus management, CSS layout, `getBoundingClientRect`, etc. all work correctly out of the box.

### Q2: Test library stack ✅ DECIDED — vitest-browser-react

**Decision:** `vitest-browser-react` replaces `@testing-library/react` + `@testing-library/jest-dom` + `@testing-library/user-event`. No Testing Library packages needed.

| Old (Testing Library) | New (Browser Mode) | Replacement |
|---|---|---|
| `@testing-library/react` (`render`, `screen`) | `vitest-browser-react` (`render`) + `page` from `vitest/browser` | Direct replacement |
| `@testing-library/jest-dom` (`.toBeInTheDocument()`) | `expect.element()` auto-retrying assertions | Built into Vitest browser assertions |
| `@testing-library/user-event` | `userEvent` from `vitest/browser` | Higher fidelity — drives events via CDP, not synthetic dispatch |

**Rejected alternatives:**

| Alternative | Why rejected |
|---|---|
| **Testing Library with jsdom/happy-dom** | We chose browser mode; Testing Library is redundant |
| **Storybook interaction tests** | Separate build system; underpowered vs Vitest; adds maintenance burden |
| **React `test-utils`** | `act()` only, no query helpers, no matchers — not worth it |

### Q3: Where do component tests live? — STILL OPEN (browser mode doesn't change this)

Browser mode doesn't affect file locations — this remains a monorepo structure question for Phase C.

Currently server tests live under `__tests__/`. After Phase C, the monorepo has `packages/ui/` and `apps/web/` (plus `apps/admin/`). Several options:

| Option | Structure | Pros | Cons |
|---|---|---|---|
| **A. Keep in `__tests__/`** | `__tests__/components/*.test.tsx` next to existing `__tests__/unit/` | Consistent with current structure; single test runner config | Mixes server + client tests; doesn't follow monorepo boundaries |
| **B. Colocate in `packages/ui/`** | `packages/ui/src/components/ui/__tests__/*.test.tsx` or `packages/ui/__tests__/` | UI primitive tests live with the code; natural after Phase C | Only covers `packages/ui` — app-level components (`src/components/`) still need a home |
| **C. Colocate everywhere** | `src/components/flashcards/__tests__/deck-card.test.tsx` | Tests next to the code they cover | Breaks the `__tests__/` convention; lots of scattered `__tests__/` dirs |
| **D. Hybrid: `packages/ui/__tests__/` + `__tests__/components/`** | UI primitives tested in the package; app components tested in the root `__tests__/` | Follows monorepo boundaries; app tests stay centralized | Two locations to maintain; slightly inconsistent |
| **E. Per-app `__tests__/`** | `apps/web/__tests__/components/` | Clean monorepo structure | Requires moving the existing `__tests__/` dir into `apps/web/` — big migration |

**Questions for discussion:**
- After Phase C, should `apps/web/` absorb the current `src/` and `__tests__/` entirely?
- Do we want component tests discoverable via `bun test:components` from root, or per-workspace `bun --filter @studiq/web test:components`?
- What does the Vitest workspace config look like post-restructure?

### Q4: Vitest project/workspace configuration

Today everything runs through a single `vitest.config.ts` at root. With a DOM environment for components, we need at minimum two "projects":

```
vitest.config.ts  (root)
├── project "server"    → environment: 'node'
│   └── __tests__/unit/**/*.test.ts + __tests__/integration/**/*.test.ts
├── project "components" → environment: 'happy-dom' (or 'jsdom')
│   └── __tests__/components/**/*.test.tsx
└── (post Phase C, possibly more projects for packages/ui, apps/web, apps/admin)
```

**Options:**

| Approach | How | When to use |
|---|---|---|
| **Vitest `projects` (inline)** | Multiple config objects in root `vitest.config.ts` | Simple, keeps one config file |
| **Vitest workspace file** | `vitest.workspace.ts` pointing to per-package configs | Post Phase C, when packages have their own vitest configs |
| **Per-file `@vitest-environment` docblock** | `// @vitest-environment happy-dom` at top of each `.test.tsx` | Quick start, no config changes; doesn't scale |
| **Per-directory env override** | `environment: { 'src/**/*.tsx': 'happy-dom' }` in vitest config | Middle ground — one line per directory pattern |

**Question:** Do we want to do the minimal thing now (per-file docblock or per-directory env) and fully clean up during Phase C, or do we go straight to the multi-project config?

### Q5: Provider mocking strategy

This is the hardest part. Most app components depend on multiple providers:

| Dependency | Used by | Mocking options |
|---|---|---|
| `QueryClientProvider` (TanStack) | All data-fetching components | **Real** provider (no mock) — fast, in-memory, standard pattern |
| `next-intl` (i18n) | Nearly everything | Three options (see below) |
| `next/navigation` (router) | Components with `useRouter`, `usePathname`, `useSearchParams` | `vi.mock('next/navigation')` with `vi.fn()` stubs |
| `next-themes` | Theme-aware components | `vi.mock()` returning `{ theme: 'light' }` |
| `useCan()` / auth context | RBAC-gated UI | Mock to return permissive defaults; override per test |
| `sonner` (toasts) | Action-triggering components | `vi.mock()` to no-op or spy |
| `@dnd-kit/*` | Drag-and-drop components | Real provider (dnd-kit works in happy-dom) or mock if slow |

**next-intl mocking — the deep question:**

| Option | How | Pros | Cons |
|---|---|---|---|
| **A. Mock the hook** | `vi.mock('next-intl/navigation', () => ({ useTranslations: () => (key) => key }))` | Simple, no locale setup; key IS the visible text | Doesn't test actual translations; can't verify correct key usage |
| **B. Mock with lookup** | Provide `en.json` messages; mock returns `messages[locale][key]` | Tests actual translated text; catches missing keys | Slower; need to import message files; coupling to message structure |
| **C. Skip mocking** | Wrap in real `NextIntlClientProvider` with `en` messages | Full integration; no mocking | Heavy setup; every render needs message files; fragile to message changes |
| **D. Per-component choice** | Let test authors pick A, B, or C per file | Flexible | Inconsistent; no team standard |

**Question:** Which approach should be the **default**? (Individual tests can always deviate with explicit justification.)

### Q6: Scope — what gets tested at the component level?

The testing pyramid for frontend:

```
        ┌─────────────┐
        │   E2E (10)  │  ← Playwright (existing)
        ├─────────────┤
        │  Component  │  ← NEW — this document
        ├─────────────┤
        │   Hooks     │  ← Pure logic, no DOM needed
        ├─────────────┤
        │   Utils     │  ← Pure functions (existing: zero)
        └─────────────┘
```

**Possible tiers:**

| Tier | What | Example components | Testing approach |
|---|---|---|---|
| **Tier 0: Pure hooks** | `useMemo`/`useCallback` with no provider deps | `use-ai-chat.ts` (transformation logic) | `renderHook()` from `@testing-library/react`, no provider wrappers needed |
| **Tier 1: UI primitives** | Shadcn components with zero or minimal app deps | `Badge`, `Alert`, `Spinner`, `Button`, `Card` | Render + assert DOM; no provider wrappers |
| **Tier 2: Layout/shared** | Components with 1-2 provider deps | `LanguageToggle`, `ThemeToggle`, `PageToolbar`, `Footer` | Render with provider wrapper; mock router + i18n |
| **Tier 3: Feature screens** | Full screens with data fetching, RBAC, routing | `DeckManagementScreen`, `QuestionBankManagementScreen` | Heavy mocking; may not be worth it vs. E2E |
| **Tier 4: Complex interactions** | Drag-and-drop, rich text editor, multi-step forms | `FlashcardEditor`, `ImportDialog` | Interaction testing with `user-event`; slow, fragile |

**Questions for discussion:**
- Do we stop at Tiers 0-2 (high ROI, fast, stable) and leave Tiers 3-4 to E2E?
- Or do we push into Tier 3 for critical user flows (deck CRUD, flashcard save)?
- Is the `flashcard-testing-pipeline.md` scope (AI chat components) Tier 2 or Tier 3?

### Q7: Snapshot / visual testing? — PARTIALLY DECIDED

**Decision:** Browser mode's built-in ARIA snapshots (`toMatchInlineAriaSnapshot`) replace `jest-axe` for accessibility testing — no extra dependency needed.

| Approach | Tool | Status |
|---|---|---|
| **ARIA snapshots** | `expect.element(modal).toMatchInlineAriaSnapshot()` — built into Vitest browser mode | ✅ Use this |
| **DOM snapshots** | `toMatchSnapshot()` | ❌ Brittle to CSS/classname changes; skip |
| **Visual regression** | Chromatic, Percy, Playwright screenshot | ❌ Heavy CI cost; revisit when design system is mature |
| **jest-axe** | Accessibility assertions | ❌ Redundant — ARIA snapshots cover this in browser mode |

**Question:** Do we want DOM snapshots at all, or is "assert specific elements exist" sufficient? Should we add `jest-axe` for accessibility checks as a separate concern?

---

## Implementation dependencies

```
foundation-agentic-testing.md
├── Phase A ✅ (test foundation — complete)
├── Phase B ✅ (flags/perms/limits — complete)
├── Phase B.5 ⬜ (seat licensing cleanup — not started)
├── Phase C  ⬜ (monorepo restructure — BLOCKS component testing)
│   ├── C1: Bun workspace scaffold
│   ├── C2: Move pure logic → packages/authz, UI primitives → packages/ui
│   ├── C3-C7: Admin panel detach
│   └── C8: RLS hardening
└── Phase D  ⬜ (agentic testing — runs on stable foundation)

frontend-component-testing (THIS DOCUMENT)
└── Depends on: Phase C complete
    ├── packages/ui/ exists and is stable
    ├── vitest workspace config reflects monorepo structure
    ├── Clear boundary: what lives in packages/ui vs apps/web
    └── Then: install deps, configure environment, build helpers, write tests
```

**Key dependency:** Phase C moves UI primitives into `packages/ui`. Component tests for those primitives should live in (or alongside) `packages/ui`, not in the root `__tests__/`. Building the test infrastructure before knowing the final package structure means rework.

**However:** The `flashcard-testing-pipeline.md` scope (AI chat hooks + components in `src/components/ai/`) is less affected by Phase C — those components stay in the main app. If we want to start sooner, we could begin with that narrowly-scoped effort.

---

## Proposed execution order (after Phase C)

This is **not a plan** — it's a sequence of decisions to make and work to do, roughly ordered.

### Decision phase

1. ~~**Lock DOM environment:** jsdom or happy-dom (Q1)~~ → ✅ Vitest Browser Mode
2. ~~**Lock test library stack:** Testing Library + jest-dom + user-event, or alternatives (Q2)~~ → ✅ `vitest-browser-react` + built-in `page`/`userEvent`
3. **Lock test file locations:** Where do component tests live post-monorepo (Q3) — still open, depends on Phase C
4. **Lock Vitest config approach:** Multi-project vs workspace vs docblock (Q4) — browser mode uses `browser.enabled` config, not environment strings
5. **Lock provider mocking default:** next-intl strategy especially (Q5) — still open
6. **Lock testing scope:** Tiers 0-2 only, or deeper (Q6) — still open
7. ~~**Decide on snapshots/a11y:** DOM snapshots, jest-axe, or neither (Q7)~~ → ✅ ARIA snapshots (built-in), skip DOM/visual snapshots

### Infrastructure phase (once decisions are locked)

1. Install dependencies
2. Configure Vitest (project/workspace, environment, setup files)
3. Build provider wrapper (`__tests__/components/helpers/render.tsx` or equivalent)
4. Build mock modules (`next-navigation.ts`, `next-intl.ts`, etc.)
5. Write 2-3 smoke tests to validate the setup works end-to-end
6. Add npm scripts (`test:components`, `test:hooks`, etc.)
7. Update CI pipeline to run component tests

### Coverage phase (iterative)

| Wave | What | Est. effort |
|---|---|---|
| **Wave 1** | Pure hooks (`use-ai-chat.ts` etc.) — `renderHook()`, no DOM | Small |
| **Wave 2** | UI primitives from `packages/ui/` — Badge, Alert, Button, Spinner | Small |
| **Wave 3** | Layout components — LanguageToggle, ThemeToggle, Footer, PageToolbar | Medium |
| **Wave 4** | Shared components — DeleteConfirmDialog, BulkActionBar, MarkdownRenderer | Medium |
| **Wave 5** | Feature components (if in scope) — DeckCard, FlashcardToolbar, etc. | Large |

---

## Alternatives considered and rejected

| Alternative | Why rejected |
|---|---|
| **jsdom** | Simulated DOM — Radix portals, focus management, CSS layout don't work correctly. Redundant with browser mode which gives us a real browser for free (Playwright already installed) |
| **happy-dom** | Same as jsdom — simulated DOM, lighter but still inaccurate. No advantage over browser mode when Playwright is already in the stack |
| **Testing Library + jsdom/happy-dom** | We chose browser mode; `vitest-browser-react` replaces the entire Testing Library stack |
| **Cypress Component Testing** | Different toolchain from existing Vitest; heavier runner; no benefit over Vitest browser mode for our needs |
| **Storybook as primary test surface** | Adds a parallel build system, separate config, and a whole UI to maintain. Interaction tests in Storybook are underpowered vs. Vitest. Could be added later for documentation/design system purposes, but not as a testing strategy |
| **Skip component tests, rely only on E2E** | E2E is slow, flaky by nature, and expensive to maintain. Can't test edge cases, error states, or accessibility at scale. Component tests are the fast feedback loop |
| **Only test `packages/ui` (skip app components)** | Misses the actual bug surface — all past frontend bugs were in app components (`src/components/ai/`), not in shadcn primitives |
| **Full visual regression (Chromatic/Percy)** | Heavy CI cost, requires dedicated infrastructure, overkill for current project stage. Browser mode's ARIA snapshots cover accessibility; revisit visual regression when design system is mature |

---

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Phase C takes longer than expected | Component testing delayed further | Start with `flashcard-testing-pipeline.md` scope (AI chat) as a narrow proof of concept that's less affected by restructure |
| Provider mocking becomes a maintenance burden | Tests break when providers change | Keep the wrapper thin; prefer real providers over mocks where possible (QueryClient is real, not mocked) |
| Team adoption: writing tests is slower than writing code | Feature velocity concern | Start with Tier 0-1 (fast, obvious value); make it easy to run (`bun test:components`); demonstrate bug-catching ROI early |

---

## Related docs

- `docs/plans/foundation-agentic-testing.md` — the restructure plan that must land first
- `docs/plans/flashcard-testing-pipeline.md` — scoped AI chat testing effort (hooks + components + backend)
- `docs/plans/coverage-improvement-handoff.md` — server-side coverage improvement (parallel effort)
- `AGENTS.md` — testing conventions, import aliases, Vitest config
