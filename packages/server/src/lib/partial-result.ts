/**
 * Result objects from external libraries — AI SDK steps and finish results,
 * provider payloads — are typed as if every field is present. A partial
 * response can still leave one out: a provider that reports no usage, a stream
 * that ends before the final step. The route tests pin exactly that tolerance,
 * so these helpers read a field as the wire can deliver it instead of
 * asserting the library's complete shape.
 */

/** A list field a partial result can leave out. */
export function partialList<T>(value: readonly T[] | null | undefined): readonly T[] {
  return value ?? [];
}

/** An object field (usage, metadata) a partial result can leave out; every property stays optional. */
export function partialObject<T extends object>(value: T | null | undefined): Partial<T> {
  return value ?? {};
}

/** A text field a partial result can leave out. */
export function partialText(value: string | null | undefined): string {
  return value ?? '';
}
