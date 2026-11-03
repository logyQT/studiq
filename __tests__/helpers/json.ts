/**
 * Parsing helpers for the untyped JSON boundaries in tests.
 *
 * `Response.json()` / `Request.json()` are typed `any` by the platform, so every
 * call site would otherwise need its own cast (and trip `no-unsafe-*` on every
 * property read). Declaring the source as returning `T` keeps the untyped
 * platform signature on this one line; runtime expectations in the test still
 * verify the data it reads.
 */
export async function json<T>(source: { json(): Promise<T> }): Promise<T> {
  return source.json();
}

/** Give an already-parsed untyped value (`JSON.parse`) the shape the test asserts against. */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T types the caller's read, not the argument
export function asJson<T>(value: unknown): T {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the single any -> test-shape boundary
  return value as T;
}
