/** Typing helpers for the service doubles controller tests build. */
import type { Mock } from 'vitest';

/**
 * Presents a partial service double as the real service.
 *
 * Controller tests stub only the methods they exercise, with payloads shaped for
 * the assertion rather than the full DB row the service would return. Declaring
 * the double through this view keeps `new XController(double)` type-safe while the
 * object keeps its untyped `Mock` members, so each test can queue its own payload.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T names the service the double stands in for; it is the caller's only input
export function asService<T>(double: Record<string, Mock>): T {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- a partial service double cannot satisfy the class shape; the test asserts the calls it makes
  return double as T;
}
