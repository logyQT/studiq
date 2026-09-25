/**
 * 3× side-by-side concurrency helpers for integration tests.
 *
 * Each `it()` in the wrapped describe block is triplicated: three independent
 * copies run concurrently (enabled by `sequence.concurrent: true` in vitest.config).
 * Each copy gets a unique `copyId` for naming DB resources and cleanup scopes.
 *
 * Mock isolation: each copy registers a mock user for its copyId in a per-copy
 * `beforeEach`.  The outer `beforeEach` calls `applyRegisteredMock(copyId)` which
 * applies the registered mock *before* the test body runs — no race condition.
 *
 * Why this design (and not alternatives):
 *
 * ── NOT `--repeat` ──
 *   `vitest --repeat 3` runs replicas *sequentially*, proving nothing about isolation.
 *
 * ── NOT 3 separate vitest processes ──
 *   Three parallel `vitest run` processes would each need their own DB data namespace,
 *   dramatically increase DB load, and produce noisy constraint-violation errors that
 *   are hard to distinguish from real bugs.
 *
 * ── NOT `maxConcurrency: 3` ──
 *   That's a global concurrency *cap*, a different concept.
 *
 * ── Wrapper approach chosen ──
 *   The `forEachCopy` helper registers N copies of each `it()` at parse time.
 *   At runtime, `sequence.concurrent: true` runs all copies in the same worker
 *   concurrently.  Each copy gets a unique `copyId` passed into `setup()`, so every
 *   DB resource it creates is namespaced.
 *
 * Trade-offs:
 *   - Each copy creates its own data → 3× DB inserts per test.  Acceptable for
 *     ~186 tests; total DB write count stays well under 1 000.
 *   - Cleanup per-copy → 3× cleanup calls per test.  `cleanupOrganizationDeep`
 *     already handles missing rows gracefully (no-op).
 *   - `beforeAll`-created shared fixtures (e.g. the `teacher` user) are still shared
 *     across copies.  This is fine when copies only *read* shared data or when shared
 *     data is immutable (user IDs, role names).  When copies *mutate* shared data,
 *     each copy must create its own copy.
 */

const HEX = '0123456789abcdef';

function randomHex(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += HEX[Math.floor(Math.random() * 16)];
  return out;
}

/**
 * Generate N unique copyId strings.  Call once per `forEachCopy` invocation.
 * @param count Number of copies (default 3)
 * @param prefix Optional prefix for readability (e.g. "q" for questions)
 */
export function generateCopyIds(count = 3, prefix = ''): string[] {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    ids.push(`${prefix}${randomHex(8)}`);
  }
  return ids;
}

// ── Per-copy mock registration ─────────────────────────────────

/**
 * Registry for per-copy mock users.  Each `beforeEach` registers the correct
 * mock for its copy *before* the test body runs.  `applyRegisteredMock(copyId)`
 * (from integration/helpers.ts) reads from this registry and applies the mock.
 *
 * The registry is per-file (module-scoped).  Each test file has its own registry
 * because the module is loaded once per Vitest worker (one worker per file with
 * `fileParallelism: true`).
 */
const mockRegistry = new Map<string, { id: string; role: string } | null>();

/**
 * Register a mock user for a specific copyId.
 * Call this in the describe block (not in a hook) so it's evaluated at parse time.
 * The registered value is read by `applyRegisteredMock` in `beforeEach`.
 *
 * @param copyId The unique copy identifier
 * @param user The mock user object (or null for real Supabase)
 */
export function registerMock(copyId: string, user: { id: string; role: string } | null): void {
  mockRegistry.set(copyId, user);
}

/**
 * Get the registered mock for a copyId.
 * Returns `null` if the copyId was registered with `null` (real Supabase).
 * Returns `undefined` if no mock was registered for this copyId.
 */
export function getRegisteredMock(copyId: string): { id: string; role: string } | null | undefined {
  return mockRegistry.get(copyId);
}

// ── Helper to build unique names with copyId ───────────────────

/**
 * Create a name with a copyId suffix to prevent collisions between concurrent copies.
 * Example: `uniqueName(copyId, 'org-test', 'create') → 'org-test-a1b2c3d4-create'`
 */
export function uniqueName(copyId: string, ...parts: string[]): string {
  return [...parts, copyId].join('-');
}

// ── Main 3× wrapper ───────────────────────────────────────────

/**
 * Register N copies (default 3) of a describe block.  Each copy gets a unique
 * `copyId` string passed to the `setup` callback.
 *
 * The `setup` callback MUST call `describe(copyId, () => { ... })` and register
 * the mock user via `registerMock(copyId, user)` inside the describe (at parse
 * time, not in a hook).
 *
 * Example:
 * ```ts
 * import { forEachCopy, registerMock } from '#test/helpers/concurrent';
 * import { applyRegisteredMock } from '#test/integration/helpers';
 *
 * forEachCopy((copyId) => {
 *   describe(`copy ${copyId}`, () => {
 *     registerMock(copyId, TEST_USERS.TEACHER);
 *
 *     beforeEach(() => {
 *       vi.clearAllMocks();
 *       applyRegisteredMock(copyId); // applies the registered mock atomically
 *     });
 *
 *     it('does something', async () => {
 *       mockUser(TEST_USERS.TEACHER);
 *       const res = await routeHandler(req);
 *       expect(res.status).toBe(200);
 *     });
 *   });
 * });
 * ```
 */
export function forEachCopy(setup: (copyId: string) => void, count = 3): void {
  const ids = generateCopyIds(count);
  for (const copyId of ids) {
    setup(copyId);
  }
}

export { randomHex };
