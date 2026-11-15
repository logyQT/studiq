import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Where the shipped fixtures live. */
export const FAKE_LLM_CASES_DIR = join(REPO_ROOT, 'scripts', 'fake-llm', 'cases');

/** Engine sources, which must stay free of product vocabulary. */
export const FAKE_LLM_ENGINE_FILES = [
  'server.ts',
  'engine.ts',
  'stream.ts',
  'journal.ts',
  'fixtures.ts',
  'types.ts',
].map((name) => join(REPO_ROOT, 'scripts', 'fake-llm', name));

export interface JournalEntryShape {
  id: number;
  outcome: string;
  fixture: string | null;
  conversation: string | null;
  turn: number | null;
  fault: string | null;
  request: unknown;
  wire: string;
  durationMs: number;
}

export interface FixtureShape {
  key: string;
  case: string;
  match: Record<string, unknown>;
  maxTurns?: number;
  turns: Record<string, unknown>[];
}

export interface FakeLlmApi {
  handle(request: Request): Promise<Response>;
  reset(): void;
  journal: { list(): readonly JournalEntryShape[]; get(id: number): JournalEntryShape | undefined };
}

export interface FakeLlmModules {
  FakeLlm: new (fixtures: readonly FixtureShape[]) => FakeLlmApi;
  parseFixture(value: unknown, source: string): FixtureShape;
  loadFixtures(dir: string): FixtureShape[];
}

function loadModule(name: string): Promise<Record<string, unknown>> {
  return import(pathToFileURL(join(REPO_ROOT, 'scripts', 'fake-llm', name)).href);
}

/**
 * Loads the real engine and fixture loader of `scripts/fake-llm`.
 *
 * `scripts/**` has no alias and `__tests__` may not use relative specifiers, so
 * the modules are imported by absolute file URL, like the `scripts/env` tests do.
 */
export async function loadFakeLlm(): Promise<FakeLlmModules> {
  const [engine, fixtures] = await Promise.all([
    loadModule('engine.ts'),
    loadModule('fixtures.ts'),
  ]);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the shapes above mirror the shipped exports
  return { ...engine, ...fixtures } as unknown as FakeLlmModules;
}
