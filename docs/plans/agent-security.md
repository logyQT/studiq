# Agent Security Audit & Hardening Plan

**Date:** 2026-09-15
**Scope:** AI agent system (`/api/v1/ai/chat`, agent tools, data access patterns)
**Status:** Audit complete, hardening plan proposed

---

## Current State

### What the agent is

"Agent Q" is a runtime AI chat session built with Vercel AI SDK's `streamText()`. It is **not** a persistent database entity — there is no `agents` table, no agent CRUD, no lifecycle management. The agent exists only within a single HTTP request to `POST /api/v1/ai/chat`.

### What the agent can do (8 tools)

| Tool | Side Effects | DB Access |
|------|-------------|-----------|
| `create_plan` | Logs to trace DB | None |
| `ask_user` | Logs to trace DB, triggers SSE stop | None |
| `fetch_material` | Nested LLM call (`generateText`) | None |
| `webfetch` | External HTTP `fetch()` to arbitrary URLs | None |
| `extract_concepts` | Logs to trace DB | None |
| `evaluate_quality` | No-op (always returns `passed: true`) | None |
| `generate_flashcards` | Validates/parses flashcard data | None |
| `finish` | Logs to trace DB | None |

**No tool accesses the database.** Flashcard saving happens client-side through normal authenticated API routes (`POST /api/v1/flashcards/decks`, `POST /api/v1/flashcards/batch/create`), which go through full RBAC.

### Auth context

The AI chat route does **not** use the standard `withAuth()` wrapper:

```typescript
// src/app/(backend)/api/v1/ai/chat/route.ts
const supabase = await createClient();
const { data: { user } } = await supabase.auth.getUser();
if (!user) {
  return toNextResponse({ success: false, statusCode: 401, error: 'UNAUTHORIZED' });
}
// ← No RequestContext built. No RBAC. No account type check. No token budget.
```

Compare with the standard `withAuth()` which builds a full `RequestContext` with `userId`, `accountType`, `orgRoleId`, `activeOrgId`, `groupIds`, `permissionScopes`.

### Route config vs enforcement mismatch

The route config declares:

```typescript
{
  matcher: /^\/api\/v1\/ai(\/.*)?$/,
  requireAuth: true,
  allowedAccountTypes: [AccountType.STUDENT, AccountType.EDUCATOR],
  isApi: true,
}
```

But the middleware skips all `/api/` routes entirely (line 28 of `src/proxy.ts`), and the route handler doesn't enforce `allowedAccountTypes`. **Any authenticated user can access the agent.**

---

## Findings

### 🔴 F1: No account type enforcement

**Severity:** High
**Impact:** Plan/billing bypass

The `STUDENT`/`EDUCATOR` restriction is declared in route config but never enforced. `FREE` and `PREMIUM` users can access the agent endpoint. Combined with the missing token budget enforcement on the agent route (the simpler `ChatController` path enforces limits via `planResolver.getUsage()`), this gives unauthorized users unlimited AI usage.

### 🔴 F2: SSRF via `webfetch` tool

**Severity:** High
**Impact:** Server-side request forgery

The `webfetch` tool makes arbitrary HTTP requests to any URL the LLM decides to fetch. No allowlist, no URL validation, no private IP blocking. A crafted prompt could:

- Probe internal services (`http://localhost:xxxx`, `http://169.254.169.254` for cloud metadata)
- Access internal Supabase/PostgREST endpoints
- Exfiltrate data via out-of-band HTTP requests

### 🔴 F3: No `RequestContext` in agent execution

**Severity:** High
**Impact:** No authorization infrastructure for future tools

The agent runs with no `RequestContext` — no org context, no permission scopes, no group IDs. Right now this doesn't matter because tools don't access the DB. But:

- If any future tool reads flashcards, questions, or user data, there's no permission infrastructure to constrain it
- There's no way to prove the agent operates within a user's permission scope
- The agent can't be scoped to a specific organization or group

### 🟡 F4: No rate limiting

**Severity:** Medium
**Impact:** Abuse, cost overruns

The agent route has no rate limiting at the route level. The simpler `ChatController` path enforces token budgets via `planResolver.getUsage()`, but the agent route bypasses this entirely.

### 🟡 F5: RLS disabled system-wide

**Severity:** Medium (design decision, not a bug)
**Impact:** No defense-in-depth

RLS is intentionally disabled (documented in migration `20260703000008`). All authenticated roles have `GRANT ALL` on all tables. Security depends entirely on application-layer checks (`buildQueryFilter`, `check`, `accessibleFilter`).

This is not a direct agent risk (agents don't access the DB), but it means any application-layer bug in agent-adjacent code could expose all data.

### 🟢 F6: Agent tools are stateless

**Severity:** Low (positive finding)
**Impact:** Current tool set is safe

All 8 tools are stateless processors. They receive input from the LLM, process it, and return results. No database reads or writes. This is the primary reason the agent system isn't currently exploitable for data access.

---

## Hardening Plan

### Priority 0 — Immediate (before next release)

| # | Action | Effort | Files |
|---|--------|--------|-------|
| H1 | **Add account type check to agent route** — enforce `allowedAccountTypes` in the handler, not just route config | Small | `src/app/(backend)/api/v1/ai/chat/route.ts` |
| H2 | **URL allowlist for `webfetch`** — block private IPs, localhost, metadata endpoints, internal Supabase URLs | Small | `src/server/agents/tools/generic/webfetch.tool.ts` |
| H3 | **Add token budget enforcement** — mirror `ChatController`'s `planResolver.getUsage()` check in the agent route | Small | `src/app/(backend)/api/v1/ai/chat/route.ts` |

### Priority 1 — Next iteration

| # | Action | Effort | Files |
|---|--------|--------|-------|
| H4 | **Build `RequestContext` in agent route** — same pattern as `withAuth()`, pass via `AsyncLocalStorage` | Medium | `src/app/(backend)/api/v1/ai/chat/route.ts`, new `src/lib/agent-context.ts` |
| H5 | **Re-enable RLS on sensitive tables** — defense-in-depth on `flashcards`, `flashcard_decks`, `questions`, `org_members` | Medium | `supabase/migrations/` |
| H6 | **Add rate limiting** — per-user, per-org on `/api/v1/ai/chat` | Medium | `src/app/(backend)/api/v1/ai/chat/route.ts` |

### Priority 2 — Near-term

| # | Action | Effort | Files |
|---|--------|--------|-------|
| H7 | **Define `AgentScope` type** — formal contract for what each tool can access | Medium | `src/server/agents/tools/types.ts` |
| H8 | **Tool-level permission checks** — each tool's `execute` function accepts `ctx` and validates scope | Medium | `src/server/agents/tools/generic/*.tool.ts` |
| H9 | **Audit trail** — link agent trace events to user ID (partially exists via `agent-trace.service.ts`) | Small | `src/server/agents/tools/generic/*.tool.ts` |
| H10 | **Architectural constraint doc** — formalize "tools never touch DB" as a documented rule | Small | `docs/plans/agent-security.md` |

### Priority 3 — Planned

| # | Action | Effort |
|---|--------|--------|
| H11 | Playwright E2E tests verifying 401/403 from agent endpoint for unauthorized users | Small |
| H12 | Tool dependency audit — verify no tool imports Supabase clients | Small |
| H13 | Penetration test of `webfetch` SSRF after allowlist is in place | Small |

---

## Proposed `AgentScope` Design

The `AgentScope` type formalizes what an agent session is allowed to do. Every tool declares what scope it requires, and the execution layer verifies the agent's scope before running any tool.

```typescript
/**
 * Declares the exact boundaries of an agent session.
 * Created once per request in the route handler, passed to all tools via AsyncLocalStorage.
 * Tools declare their required scope; execution is blocked if scope is insufficient.
 */
interface AgentScope {
  // Identity
  userId: string;
  orgId: string | null;
  accountType: AccountType;

  // Data access — what the agent can read/write
  dataAccess: {
    flashcards: 'none' | 'own';
    decks: 'none' | 'own';
    questions: 'none' | 'own';
    orgData: 'none' | 'read';  // org-level data (members, settings)
  };

  // External access — network boundaries
  network: {
    allowedDomains: string[];          // webfetch allowlist
    maxExternalRequests: number;       // per conversation
    blockedIPRanges: string[];         // private IPs, metadata endpoints
  };

  // Resource limits
  limits: {
    maxTokens: number;                 // per conversation
    maxSteps: number;                  // tool call loop limit (currently 30)
    maxToolCalls: number;              // total tool invocations
    timeLimitMs: number;               // hard timeout
  };

  // Audit
  conversationId: string;
  startedAt: Date;
}
```

### How it works

1. **Route handler creates scope** based on the authenticated user's permissions and subscription plan
2. **Scope is stored in `AsyncLocalStorage`** so all tool executions can access it
3. **Each tool declares its required scope** in its definition:

```typescript
const webfetchTool = tool({
  description: 'Fetch content from a URL',
  inputSchema: z.object({ url: z.string().url() }),
  requiredScope: { network: { minExternalRequests: 1 } },
  execute: async (input, scope) => {
    // scope.network.allowedDomains is checked before fetch()
    if (!isUrlAllowed(input.url, scope.network)) {
      throw new Error('URL not in allowed domains');
    }
    // ... fetch logic
  },
});
```

4. **Execution layer verifies** before running any tool:

```typescript
function verifyScope(tool, scope): boolean {
  // Check tool's requiredScope against scope
  // Return false if insufficient
}
```

5. **Audit trail logs** the scope object with every tool invocation

### Proving narrow scope

With `AgentScope` in place, you can prove the agent has narrow boundaries by:

1. **Static analysis**: Inspect the `AgentScope` type — it's a closed set of capabilities, no `any`, no escape hatches
2. **Runtime inspection**: Log the scope object at request start — inspectable in trace DB
3. **Unit tests**: Verify each tool respects its declared scope boundary
4. **E2E tests**: Verify an unauthorized user gets 401, a FREE user gets 403, and a STUDENT can't access another org's data

---

## Documented Architectural Constraints

These rules should be enforced as project conventions:

1. **Tools never touch the database.** All data access goes through client-side API calls with proper RBAC. If a tool needs user data, it returns structured data to the client, which saves via authenticated endpoints.

2. **Agent sessions are stateless.** No persistent state beyond the conversation's `AsyncLocalStorage`. If cross-session memory is needed, it goes through authenticated API endpoints.

3. **Every tool must validate its inputs.** Zod schemas on all tool inputs. No raw string interpolation, no unvalidated URLs.

4. **Network calls require allowlists.** `webfetch` and any future network-calling tools must validate URLs against an allowlist before making requests.

5. **The agent route must build a `RequestContext`.** No tool execution without authorization context, even if the current tool set doesn't use it. This prevents authorization gaps when new tools are added.

6. **Usage limits apply to the agent.** No bypass. The agent route must enforce the same token budgets and rate limits as other AI endpoints.

---

## Relevant Files

| File | Role |
|------|------|
| `src/app/(backend)/api/v1/ai/chat/route.ts` | Agent entry point — auth, tool registration |
| `src/server/agents/tools/generic/*.tool.ts` | 8 tool definitions |
| `src/server/agents/system.ts` | Agent Q system prompt |
| `src/server/agents/core/base.agent.ts` | ReAct loop |
| `src/server/services/agent-trace.service.ts` | Trace event logging |
| `src/lib/with-auth.ts` | Standard auth wrapper (reference for RequestContext) |
| `src/lib/request-context.ts` | RequestContext type definition |
| `src/server/config/routes.config.ts` | Route protection rules |
| `src/lib/rbac.ts` | RBAC utilities (`hasPermission`, `checkPermission`, `buildQueryFilter`) |
| `src/lib/access.ts` | Newer access control (`can`, `check`, `accessibleFilter`) |
