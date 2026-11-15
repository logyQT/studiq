import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  FAKE_LLM_CASES_DIR,
  FAKE_LLM_ENGINE_FILES,
  loadFakeLlm,
} from '#test/unit/qa/fake-llm-load';

/**
 * The engine knows HTTP, SSE and the chat-completions schema. Every product
 * fact (tool names, entities, copy) lives in a fixture or a spec, so a new AI
 * feature adds a fixture and never touches the engine. Vitest only collects
 * `__tests__/{unit,integration}`, which is why this guard lives here and not
 * beside the engine.
 */
const PRODUCT_VOCABULARY =
  /flashcard|deck|quiz|create_plan|fetch_material|extract_concepts|evaluate_quality|ask_user/i;

describe('fake-llm engine purity', () => {
  it.each(FAKE_LLM_ENGINE_FILES.map((file) => [file.split(/[\\/]/).pop(), file] as const))(
    '%s names no product concept',
    (_name, file) => {
      const source = readFileSync(file, 'utf8');
      const hit = PRODUCT_VOCABULARY.exec(source);
      expect(hit?.[0], `product vocabulary in the engine: "${hit?.[0]}"`).toBeUndefined();
    },
  );
});

describe('fake-llm shipped fixtures', () => {
  it('all load and carry unique keys', async () => {
    const { loadFixtures } = await loadFakeLlm();
    const fixtures = loadFixtures(FAKE_LLM_CASES_DIR);
    expect(fixtures.length).toBeGreaterThan(0);
    expect(new Set(fixtures.map((fixture) => fixture.key)).size).toBe(fixtures.length);
  });
});
