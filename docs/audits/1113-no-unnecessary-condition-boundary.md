# Audit: `typescript/no-unnecessary-condition` and the data boundary

Date: 2026-11-12
Measured at: `main` = `fcec79e8` (`origin/main`)
Related: #1112 (tautology gates), #1113 (this rule), `docs/audits/173-bun-strictness-premise.md`

---

## 1. Verdict

**The rule cannot be turned on yet, and the blocker is not the code the rule points at — it is the
types the code is written against.**

905 findings across 278 files reproduce exactly as #1113 describes. Twelve files carried genuinely
dead code and are fixed in the PR that adds this note (890 findings left). The other ~98 % are not
tautologies: they are the compiler claiming that a value read across the Supabase/HTTP boundary can
never be missing, while the runtime — and this repo's own unit tests — depend on it being able to be.

Enabling the rule today therefore has exactly two honest outcomes, and both are wrong for one PR:

- delete the defensive code and change runtime behaviour on partial payloads (74 unit tests across
  22 files go red, see §3), or
- add ~700 inline `eslint-disable`s, which is the count-based parking lot that
  `scripts/check-suppressions-empty.ts` exists to prevent.

**Plan: harden the boundary first (§5), then enable the rule with no suppressions.** This audit is
the measurement that has to be re-run when each workstream lands.

---

## 2. Measurement

```bash
bun lint --no-script --rule 'typescript/no-unnecessary-condition: error' --format=json \
  apps/web/src packages __tests__ -o .tmp/nuc.json
```

The pretty reporter collapses the findings (`times="…"`); only the JSON format gives real counts.

| scope             | findings | files |
| ----------------- | -------: | ----: |
| `packages/server` |      297 |   ~50 |
| `apps/web/src`    |     ~160 |   ~60 |
| `packages/ui`     |        1 |     1 |
| `__tests__`       |      423 |   165 |

By message (`main` after the fixes in this PR, 890 total):

| message                        | count |
| ------------------------------ | ----: |
| unnecessary optional chain     |   322 |
| conditional always falsy       |   302 |
| `??` left-hand side never null |   231 |
| conditional always truthy      |    33 |
| types have no overlap          |     2 |

---

## 3. What the findings actually are

Three shapes cover almost all of them. Each is a **type-level false positive**, not dead code.

### 3.1 Absence-as-outcome reads (`if (!row) return failure('NOT_FOUND')`)

`@supabase/postgrest-js` declares `.single()` as a discriminated union:

```ts
{
  success: true;
  error: null;
  data: T;
}
{
  success: false;
  error: PostgrestError;
  data: null;
}
```

After `if (error) return toDbFailure(error)`, TypeScript narrows `data` to `T`, so the following
`if (!row) return failure('NOT_FOUND')` is unreachable _for the compiler_. The service contract,
and every unit test for it, says otherwise:

```ts
// __tests__/unit/services/quiz-teacher.service.test.ts
single.mockResolvedValue({ data: null, error: null });
expect(result.error).toBe('NOT_FOUND');
```

Deleting those guards raised `TypeError: Cannot read properties of null (reading 'organization_id')`
in 74 tests across 22 files. `.maybeSingle()` is the API whose type is honest about absence
(`T | null`), which is why it is workstream 1 below.

### 3.2 Partial rows (`data ?? []`, `row.flashcard_count?.[0]?.count ?? 0`)

A `select('*, flashcard_count:flashcards(count)')` types every embed as present. Test doubles and
partially cached payloads omit them, so the service maps with `?? []` / `?? 0` and the rule calls
that dead. The fix is a boundary that validates/marks embeds optional, not deleting the fallbacks.

### 3.3 Index access (`arr[i]`, `record[key]`)

`noUncheckedIndexedAccess` is **off** in this repo, so `arr[i]` is typed `T`, never `T | undefined`.
Every guard written for the missing index (`if (!entry) continue`, `if (!question) return null`,
`photos[id]?.length`, `cols[findIndex(...)] ?? ''`) is therefore reported as unnecessary even though
`findIndex` returning `-1` and a stale index after a refetch are normal runtime events.

The rest of the tree is small and already clean: `packages/authz` has zero findings, and
`packages/ui` had one (fixed here).

---

## 4. What this PR changes

Fixed (real dead code the rule found):

- `language-menu-row.tsx` — after `variant === 'menu'` returns, `variant === 'plain'` is always true.
- `question-bank.service.ts` / `topic.service.ts` — the inner `owner === 'mine'` re-check after
  `owner !== 'all'` was already excluded.
- `teacher-assignment.service.ts` — `teacher_points !== undefined` on a `number | null`; and a
  `question_answers` presence check on a row whose type is always an array.
- `question.service.ts` — `orderIndex ?? i` behind a Zod `.default(0)` (and the now-unused index).
- `AuthProvider.tsx` — `context === undefined` on a context created with a real default value.
- `carousel.tsx`, `markdown-renderer.tsx`, `activity.service.ts`, `org.service.ts`,
  `create-from-question-dialog.tsx`, `speed-dial.tsx` — fallbacks behind conditions that are
  always truthy or lists that are always arrays (each verified against the unit suite).

Not changed: the rule stays off in `bunfig.toml`. Turning it on without the hardening below would
either change runtime behaviour or require a suppression ledger.

---

## 5. Workstreams (in order)

1. **Absence as an outcome.** Read via `.maybeSingle()` wherever "no row" is a domain answer, so
   `T | null` (and the guard) is honest; keep `.single()` only where zero rows is a server error.
   Tests then mock `{ data: null, error: null }` against a type that allows it.
2. **`noUncheckedIndexedAccess`.** Turn it on in the tsconfig base and fix the fallout (bulk of it
   is `arr[i]` at UI/render sites). This converts index guards from "unnecessary" to "required",
   and is worth doing on its own merits.
3. **Payload validation at the edge.** One runtime schema per API response/DB row where the handler
   currently asserts a shape (Zod already ships in `packages/server/src/lib/zod`), so embeds and
   aggregates are typed as optional exactly where they can be missing.

After each workstream, re-run the command in §2; the count is the ratchet. When it reaches 0, add:

```toml
[lint.rules]
"typescript/no-unnecessary-condition" = "error"
```

and turn #1113 into the "on" PR.
