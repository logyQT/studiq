#!/usr/bin/env bun
/**
 * Fake inference server: speaks the OpenAI chat-completions wire format and
 * replays per-case fixtures, so the AI suite can feed the app bad model output
 * deterministically, offline, without a provider key.
 *
 *   bun scripts/fake-llm/server.ts [--port 4321] [--fixtures scripts/fake-llm/cases]
 *
 * Point the app at it with `LLM_BASE_URL=http://127.0.0.1:4321/v1`. The design
 * and the fixture contract are in `docs/ai/fake-inference-server.md`.
 *
 * The port is a flag, not an env var: `check-env-inventory` requires every
 * `process.env` read under `scripts/` to be declared in `.env.schema`, and this
 * process has no configuration worth a schema entry.
 */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { FakeLlm } from './engine';
import { FixtureError, loadFixtures } from './fixtures';

export const DEFAULT_PORT = 4321;

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: String(DEFAULT_PORT) },
    fixtures: { type: 'string', default: resolve(import.meta.dir, 'cases') },
  },
});

const port = Number(values.port);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  console.error(`fake-llm: --port must be 1-65535, got "${values.port}"`);
  process.exit(2);
}

let llm: FakeLlm;
try {
  llm = new FakeLlm(loadFixtures(resolve(values.fixtures)));
} catch (error) {
  // A broken fixture must stop the server: a half-loaded set would turn into
  // `unmatched` failures far away from the file that caused them.
  console.error(error instanceof FixtureError ? error.message : error);
  process.exit(1);
}

const server = Bun.serve({
  hostname: '127.0.0.1',
  port,
  // A paced stream (`delay`) may stay silent for a while; do not cut it off.
  idleTimeout: 120,
  fetch: (request) => llm.handle(request),
});

console.log(`fake-llm listening on http://127.0.0.1:${server.port} (fixtures: ${values.fixtures})`);
