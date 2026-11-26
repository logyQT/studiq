import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { qaAppUrl, resolveQaAppUrl } from '#test/helpers/qa-pointer';

/**
 * `qaAppUrl` is the one place that decides which app a QA run talks to (#1286). The shared
 * `:3010` app belongs to another checkout, so outside CI it is never a silent default.
 */

const PRINTED = 'http://localhost:3456';
const POINTED = 'http://localhost:4567';
const SHARED = 'http://localhost:3010';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'qa-pointer-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writePointer(content: string): void {
  mkdirSync(join(root, 'qa'), { recursive: true });
  writeFileSync(join(root, 'qa', 'env.json'), content);
}

describe('qaAppUrl', () => {
  it('prefers an explicit QA_APP_URL over the pointer', () => {
    writePointer(JSON.stringify({ appUrl: POINTED }));

    expect(qaAppUrl(root, { QA_APP_URL: PRINTED })).toBe(PRINTED);
  });

  it('reads the pointer written by env:share when QA_APP_URL is not set', () => {
    writePointer(JSON.stringify({ appUrl: POINTED }));

    expect(qaAppUrl(root, {})).toBe(POINTED);
  });

  it('treats an empty QA_APP_URL as not set', () => {
    writePointer(JSON.stringify({ appUrl: POINTED }));

    expect(qaAppUrl(root, { QA_APP_URL: '' })).toBe(POINTED);
  });

  it('fails with an actionable message outside CI when there is neither', () => {
    expect(() => qaAppUrl(root, {})).toThrow(/QA_APP_URL is not set/);
    expect(() => qaAppUrl(root, {})).toThrow(/bun run env:run -- bun run test:qa/);
    expect(() => qaAppUrl(root, {})).toThrow(/env:share --write/);
    expect(() => qaAppUrl(root, {})).toThrow(/QA_APP_URL=http:\/\/localhost:3010/);
  });

  it('fails for an empty QA_APP_URL with no pointer, too', () => {
    expect(() => qaAppUrl(root, { QA_APP_URL: '' })).toThrow(/QA_APP_URL is not set/);
  });

  it('falls back to the shared app in CI, which exports QA_APP_URL and CI itself', () => {
    expect(qaAppUrl(root, { CI: '1' })).toBe(SHARED);
  });

  it('still lets QA_APP_URL win in CI', () => {
    expect(qaAppUrl(root, { CI: '1', QA_APP_URL: SHARED })).toBe(SHARED);
    expect(qaAppUrl(root, { CI: '1', QA_APP_URL: PRINTED })).toBe(PRINTED);
  });

  it('reads a malformed pointer as no pointer', () => {
    writePointer('{ not json');

    expect(() => qaAppUrl(root, {})).toThrow(/QA_APP_URL is not set/);
    expect(qaAppUrl(root, { CI: '1' })).toBe(SHARED);
  });

  it('ignores a pointer without an appUrl', () => {
    writePointer(JSON.stringify({ supabaseUrl: 'http://localhost:54321' }));

    expect(() => qaAppUrl(root, {})).toThrow(/QA_APP_URL is not set/);
  });
});

describe('the CI carve-out', () => {
  it.each(['1', 'true', 'TRUE', ' 1 '])('treats CI=%j as CI', (CI) => {
    expect(resolveQaAppUrl(root, { CI })).toBe(SHARED);
  });

  it.each(['false', '0', ''])('treats CI=%j as not CI', (CI) => {
    expect(resolveQaAppUrl(root, { CI })).toBeNull();
    expect(() => qaAppUrl(root, { CI })).toThrow(/QA_APP_URL is not set/);
  });
});

describe('resolveQaAppUrl (the config half: it never throws)', () => {
  it('returns null outside CI when nobody told the run which app to hit', () => {
    expect(resolveQaAppUrl(root, {})).toBeNull();
    expect(resolveQaAppUrl(root, { QA_APP_URL: '' })).toBeNull();
  });

  it('resolves like qaAppUrl everywhere else', () => {
    writePointer(JSON.stringify({ appUrl: POINTED }));

    expect(resolveQaAppUrl(root, { QA_APP_URL: PRINTED })).toBe(PRINTED);
    expect(resolveQaAppUrl(root, {})).toBe(POINTED);
    expect(resolveQaAppUrl(path.join(root, 'nowhere'), { CI: '1' })).toBe(SHARED);
  });

  it('reads a malformed pointer as no pointer without throwing', () => {
    writePointer('{ not json');

    expect(resolveQaAppUrl(root, {})).toBeNull();
  });
});
