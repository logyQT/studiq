# Audit: `typescript/no-unnecessary-condition` and the data boundary

Date: 2026-11-12
Status: **resolved** — the rule is on (`bunfig.toml` → `[lint.rules]`) with zero findings and an
empty suppression ledger.
Related: #1112 (tautology gates), #1113 (tracking issue), #1121 (the hardening), #1122 (the first
dead-condition pass), `docs/audits/173-bun-strictness-premise.md`

---

## 1. Verdict

905 findings reproduced on `main` when the rule was measured. #1122 removed the 16 that were
genuinely dead code; the remaining 889 were **not** tautologies — they were the compiler claiming
that a value read across the Supabase/HTTP boundary can never be missing while the runtime, and
this repo's own tests, depend on it being able to be.

Enabling the rule on that state had exactly two dishonest outcomes: delete the defensive code and
change runtime behaviour on partial payloads (74 unit tests across 22 files went red), or add
~700 inline disables, which is the count-based parking lot `scripts/check-suppressions-empty.ts`
exists to prevent.

So the types were fixed first. The rule is now enabled as an `error` and reports **0 findings**
across `apps/web/src`, `packages` and `__tests__`, with an empty suppression ledger and no
`@ts-expect-error`. One justified inline disable survives (§4.4): the browser-side
`question_answers` embed, which the server-only row helper cannot type.

---

## 2. Measurement

```bash
bun lint --no-script --rule 'typescript/no-unnecessary-condition: error' --format=json \
  apps/web/src packages __tests__ -o .tmp/nuc.json
```

Use `--format=json`; the pretty reporter collapses the findings (`times="…"`). The count is the
ratchet — it had to reach 0 before the rule could move from the command line into `bunfig.toml`.

| state                                     | findings | files |
| ----------------------------------------- | -------: | ----: |
| `main` before #1122                       |      905 |   278 |
| `main` after #1122 (dead conditions only) |      889 |   273 |
| after `noUncheckedIndexedAccess`          |      653 |   155 |
| after the boundary helpers (§4)           |    **0** |     0 |

---

## 3. What the findings actually were

Three shapes covered almost all of them. Each was a **type-level false positive**, not dead code.

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

`.maybeSingle()` is the API whose type is honest about absence (`T | null`), which is why reads
whose absence is a domain answer now use it (§4.1).

### 3.2 Partial rows (`data ?? []`, `row.flashcard_count?.[0]?.count ?? 0`)

A `select('*, flashcard_count:flashcards(count)')` types every embed as present. Test doubles and
partially cached payloads omit them, so services map with `?? []` / `?? 0` and the rule calls that
dead. The fix is a boundary that marks those reads optional, not deleting the fallbacks (§4.3).

The same lie lives in third-party result objects: the AI SDK types `step.usage` and
`finish.totalUsage` as complete, but a provider that reports no usage leaves them out — which
`__tests__/unit/api/ai-chat-route.test.ts` pins ("does not throw when totalUsage is missing").

### 3.3 Index access (`arr[i]`, `record[key]`)

`noUncheckedIndexedAccess` was **off**, so `arr[i]` was typed `T`, never `T | undefined`. Every
guard written for the missing index (`if (!entry) continue`, `if (!question) return null`,
`photos[id]?.length`) was therefore reported as unnecessary even though `findIndex` returning `-1`
and a stale index after a refetch are normal runtime events.

---

## 4. What landed

### 4.1 Absence as an outcome

- Reads where "no row" is a domain answer use `.maybeSingle()`: get-by-id, membership/scope
  lookups, ownership fetches, settings reads, attempt lookups. The few helpers that keep
  `.single()` (e.g. `verifyOwnership` in `teacher-assignment.service.ts`) rely on `PGRST116`
  mapping to `NOT_FOUND`, which is the same outcome.
- `.single()` stays where zero rows is a server fault: insert/update `.select().single()` and the
  reads backing a `PGRST116` branch. Their `if (!row)` guards were genuinely dead and are gone.
- Unit tests keep mocking `{ data: null, error: null }` for the absence path — that is exactly
  what `maybeSingle()` returns — and the shared test chains alias `maybeSingle` to the same
  terminal as `single`.

### 4.2 `noUncheckedIndexedAccess`

Enabled in `tsconfig.json`, `apps/web/tsconfig.json`, `apps/admin/tsconfig.json` and
`packages/tsconfig/base.json`. The fallout was fixed in app code (loop/destructuring/index guards),
services, scripts and the test suites. Index guards are now load-bearing instead of decorative:
`arr[arr.length - 1]` became `.at(-1)` plus a real guard, `split(':')` destructuring is guarded,
and a non-null assertion survives only where bounds are proven in the same statement.

### 4.3 Payloads at the edge

`packages/server/src/lib/supabase/rows.ts` states the PostgREST runtime contract once:

- `dbRows(data)` — a list projection that may be `null`, or an embed a partial payload omitted;
- `dbCount(embed)` — a `child(count)` embed, empty when the relation has no rows;
- `dbNested(value)` — a single-object embed a partial payload can omit.

`packages/server/src/lib/partial-result.ts` does the same for third-party result objects:
`partialList`, `partialObject`, `partialText`. Because the helper parameter is the widened
(`| null | undefined`) type, the fallback is required by the type rather than hidden behind an
assertion — and the rule stops reporting it.

Untyped boundaries keep using Zod: RPC JSON payloads go through `parseRpcJson(schema, …)`
(`flashcard-practice.service.ts`), and model-supplied tool arguments are typed by their
`inputSchema` (e.g. `extract_concepts` marks `terms` optional because the model may omit it and
the tool echoes whatever it received).

### 4.4 Dead code the rule did find

Fixed rather than accommodated: always-true `canCreate*` flags whose branches were dead
(`topic-management-screen`, `deck-management-screen`), `vendor?.app_metadata?.` chains where the
nested property is required, a second `?.` narrowed by an earlier optional-chain comparison
(`BreadcrumbProvider`), unused `?? default` on `NOT NULL` columns and Zod `.default(…)` fields,
and `JSON.stringify(x) ?? ''` where `stringify`'s lib type is optimistic.

One suppression was **removed**: `markdown-renderer.tsx` no longer needs an inline disable because
the `div` attribute list now carries the same type-required fallback as `span`.

One remains, deliberately: `create-from-question-dialog.tsx` reads a question whose
`question_answers` embed a partial client payload can omit. The boundary helpers are server
modules, so the browser keeps its documented `?? []` with an inline disable — allowed by
`scripts/check-suppressions-empty.ts`, which guards the _ledger_, not justified inline disables.

---

## 5. Keeping it at zero

The rule is only cheap to keep while the boundary stays honest. New code:

- takes list reads through `dbRows(...)`, count embeds through `dbCount(...)`, and single-row reads
  through `.maybeSingle()` when absence is an answer;
- reads third-party result objects through `partialList` / `partialObject` / `partialText` instead
  of asserting the library's complete shape;
- validates genuinely untyped input (RPC JSON, webhook payloads, model output) with the shared Zod
  instance from `@studiq/server/lib/zod` instead of a cast.

When the rule fires on new code, decide which side is wrong: if the value really can be missing,
widen the type at the boundary; if it cannot, the fallback is dead and goes. Never suppress.
