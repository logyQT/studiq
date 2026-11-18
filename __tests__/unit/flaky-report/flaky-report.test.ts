import { describe, expect, it } from 'vitest';
import { loadFlakyReport } from '#test/unit/flaky-report/load';

const { parseReport, aggregate, verdictOf, exitCode, windowOf } = await loadFlakyReport();

const ROOT = '/ci/checkout';

function spec(file: string, title: string, tests: unknown[]): unknown {
  return { title, file, tests };
}

function test(project: string, status: string, results: unknown[]): unknown {
  return { projectName: project, status, results };
}

function passed(duration: number): unknown {
  return { status: 'passed', duration, errors: [] };
}

function timedOut(duration: number, message: string): unknown {
  return { status: 'timedOut', duration, errors: [{ message }] };
}

function report(suites: unknown[]): unknown {
  return { config: { rootDir: ROOT }, suites };
}

const FLAKY_REPORT = report([
  {
    suites: [
      {
        file: 'manage-invites.spec.ts',
        suites: [],
        specs: [
          spec('manage-invites.spec.ts', 'invites a member', [
            test('firefox', 'flaky', [
              timedOut(4_120, 'TimeoutError: locator.click\nwaiting for getByRole'),
              passed(900),
            ]),
          ]),
        ],
      },
    ],
  },
]);

const GREEN_REPORT = report([
  {
    suites: [
      {
        file: 'manage-invites.spec.ts',
        specs: [
          spec('manage-invites.spec.ts', 'invites a member', [
            test('firefox', 'expected', [passed(800)]),
          ]),
        ],
      },
    ],
  },
]);

const RED_REPORT = report([
  {
    suites: [
      {
        file: 'manage-members.spec.ts',
        specs: [
          spec('manage-members.spec.ts', 'changes a role', [
            test('chromium', 'unexpected', [
              timedOut(4_000, 'Error: expect(locator).toBeVisible()'),
              timedOut(4_050, 'Error: expect(locator).toBeVisible()'),
            ]),
          ]),
        ],
      },
    ],
  },
]);

describe('parseReport', () => {
  it('resolves each spec against the report root and keeps the failure detail', () => {
    const [observed] = parseReport(FLAKY_REPORT);

    expect(observed.file).toBe('manage-invites.spec.ts');
    expect(observed.project).toBe('firefox');
    expect(observed.status).toBe('flaky');
    expect(observed.slowestFailureMs).toBe(4_120);
    expect(observed.error).toBe('TimeoutError: locator.click');
  });

  it('reads a spec nested inside a describe block', () => {
    const nested = report([
      {
        suites: [
          {
            file: 'nested.spec.ts',
            specs: [],
            suites: [
              {
                specs: [
                  spec('nested.spec.ts', 'inner case', [
                    test('chromium', 'flaky', [timedOut(1, 'x'), passed(1)]),
                  ]),
                ],
              },
            ],
          },
        ],
      },
    ]);

    expect(parseReport(nested).map((entry) => entry.title)).toEqual(['inner case']);
  });

  it('returns nothing for JSON that is not a Playwright report', () => {
    expect(parseReport({ some: 'attachment' })).toEqual([]);
    expect(parseReport([])).toEqual([]);
  });

  it('does not invent a spec path when the report has no rootDir', () => {
    const [observed] = parseReport({
      suites: [
        {
          file: 'a.spec.ts',
          specs: [spec('a.spec.ts', 'x', [test('chromium', 'expected', [passed(1)])])],
        },
      ],
    });

    expect(observed.file).toBe('a.spec.ts');
  });
});

describe('aggregate', () => {
  it('counts a retried pass and a still-red test separately', () => {
    const entries = aggregate([
      { tests: parseReport(FLAKY_REPORT) },
      { tests: parseReport(RED_REPORT) },
    ]);

    expect(entries.map((entry) => [entry.title, entry.flaky, entry.failed])).toEqual([
      ['invites a member', 1, 0],
      ['changes a role', 0, 1],
    ]);
  });

  it('keeps the slowest failure across reports as the triage signal', () => {
    const slower = report([
      {
        suites: [
          {
            file: 'manage-invites.spec.ts',
            specs: [
              spec('manage-invites.spec.ts', 'invites a member', [
                test('firefox', 'flaky', [timedOut(3_990, 'a'), passed(1)]),
              ]),
            ],
          },
        ],
      },
    ]);

    const [entry] = aggregate([
      { tests: parseReport(FLAKY_REPORT) },
      { tests: parseReport(slower) },
    ]);

    expect(entry.seenIn).toBe(2);
    expect(entry.flaky).toBe(2);
    expect(entry.slowestFailureMs).toBe(4_120);
  });

  it('ranks by how often the test wobbles', () => {
    const twice = report([
      {
        suites: [
          {
            file: 'a.spec.ts',
            specs: [
              spec('a.spec.ts', 'rare', [test('firefox', 'flaky', [timedOut(1, 'x'), passed(1)])]),
            ],
          },
          {
            file: 'b.spec.ts',
            specs: [
              spec('b.spec.ts', 'often', [test('firefox', 'flaky', [timedOut(1, 'y'), passed(1)])]),
            ],
          },
        ],
      },
    ]);
    const once = report([
      {
        specs: [
          spec('a.spec.ts', 'rare', [test('firefox', 'flaky', [timedOut(1, 'z'), passed(1)])]),
        ],
      },
    ]);

    const entries = aggregate([{ tests: parseReport(twice) }, { tests: parseReport(once) }]);

    expect(entries.map((entry) => [entry.title, entry.flaky])).toEqual([
      ['rare', 2],
      ['often', 1],
    ]);
  });

  it('does not count a skipped observation as a run', () => {
    const skipped = report([
      {
        suites: [
          {
            file: 'manage-invites.spec.ts',
            specs: [
              spec('manage-invites.spec.ts', 'invites a member', [test('firefox', 'skipped', [])]),
            ],
          },
        ],
      },
    ]);

    const entries = aggregate([
      { tests: parseReport(FLAKY_REPORT) },
      { tests: parseReport(skipped) },
      { tests: parseReport(GREEN_REPORT) },
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0].seenIn).toBe(2);
  });

  it('builds a replay command that surfaces the flake instead of hiding it', () => {
    const [entry] = aggregate([{ tests: parseReport(RED_REPORT) }]);

    expect(entry.reproduce).toContain('manage-members.spec.ts');
    expect(entry.reproduce).toContain('--repeat-each=5');
    expect(entry.reproduce).toContain('--retries=0');
    expect(entry.reproduce).toContain('--project=chromium');
  });

  it('replays a QA case through the QA config, and drops a project that does not exist', () => {
    const qa = report([
      {
        suites: [
          {
            file: '__tests__/qa/STU/STU-03.spec.ts',
            specs: [
              spec('__tests__/qa/STU/STU-03.spec.ts', 'student edits a deck', [
                test('', 'flaky', [timedOut(1, 'x'), passed(1)]),
              ]),
            ],
          },
        ],
      },
    ]);

    const [entry] = aggregate([{ tests: parseReport(qa) }]);

    // testDir differs between the two runners, so a replay without `-c` would
    // not find the spec at all.
    expect(entry.reproduce).toContain('-c __tests__/qa/playwright.qa.config.ts');
    expect(entry.reproduce).not.toContain('--project=');
    // Shell-quoted, not bare: a path with a space or a glob character would
    // otherwise be split by the caller's shell.
    expect(entry.reproduce).toContain("'__tests__/qa/STU/STU-03.spec.ts'");
  });

  it('escapes regex metacharacters in the title so -g matches the literal case', () => {
    const parens = report([
      {
        suites: [
          {
            file: 'a.spec.ts',
            specs: [
              spec('a.spec.ts', 'adds a row (v2)', [
                test('chromium', 'flaky', [timedOut(1, 'x'), passed(1)]),
              ]),
            ],
          },
        ],
      },
    ]);

    const [entry] = aggregate([{ tests: parseReport(parens) }]);

    expect(entry.reproduce).toContain('\\(v2\\)');
  });

  it('quote-escapes an apostrophe so the replay command still runs', () => {
    // Polish UI copy uses typographic quotes, but a title with an ASCII `'` is
    // routine too — unescaped it would close the shell quote and break the command.
    const apostrophe = report([
      {
        suites: [
          {
            file: 'manage-invites.spec.ts',
            specs: [
              spec('manage-invites.spec.ts', "the admin's „Odrzuć” row", [
                test('firefox', 'flaky', [timedOut(1, 'x'), passed(1)]),
              ]),
            ],
          },
        ],
      },
    ]);

    const [entry] = aggregate([{ tests: parseReport(apostrophe) }]);

    expect(entry.reproduce).toContain(`admin'\\''s`);
    expect(entry.reproduce).toContain('„Odrzuć”');
  });

  it('reports the slowest failed attempt, not the last one', () => {
    // The timing is the triage signal: a 4.0 s miss is a slow tail, a 0.4 s miss
    // is a race. Taking the last attempt instead would pick either at random.
    const twoFails = report([
      {
        suites: [
          {
            file: 'a.spec.ts',
            specs: [
              spec('a.spec.ts', 'wobbles', [
                test('firefox', 'unexpected', [timedOut(400, 'fast'), timedOut(4_100, 'slow')]),
              ]),
            ],
          },
        ],
      },
    ]);

    const [entry] = aggregate([{ tests: parseReport(twoFails) }]);

    expect(entry.slowestFailureMs).toBe(4_100);
  });

  it('returns nothing when every report is green', () => {
    // The filter is the whole point of the ledger: a green suite must produce an
    // empty list, not a list of tests that happened to run.
    expect(aggregate([{ tests: parseReport(GREEN_REPORT) }])).toEqual([]);
  });
});

describe('windowOf', () => {
  it('dates the verdict so an old failure cannot read as a current one', () => {
    expect(
      windowOf([
        { tests: [], startedAt: '2026-11-10T03:00:00.000Z' },
        { tests: [], startedAt: '2026-11-17T03:00:00.000Z' },
        { tests: [] },
      ]),
    ).toEqual({ earliest: '2026-11-10T03:00:00.000Z', latest: '2026-11-17T03:00:00.000Z' });
  });

  it('stays empty when no report carries a start time', () => {
    expect(windowOf([{ tests: [] }])).toEqual({});
  });
});

describe('verdict and exit code (the documented agent contract)', () => {
  it('maps each verdict to the exit code the docs promise', () => {
    expect(exitCode('clean', false)).toBe(0);
    expect(exitCode('flaky', false)).toBe(1);
    expect(exitCode('failing', false)).toBe(1);
    // A missing report is its own answer: reporting it as clean would be a lie.
    expect(exitCode('no-data', false)).toBe(3);
  });

  it('never fails a leg in summary mode', () => {
    expect(exitCode('no-data', true)).toBe(0);
    expect(exitCode('flaky', true)).toBe(0);
    expect(exitCode('failing', true)).toBe(0);
  });

  it('calls a read with no reports no-data even when the entries are empty', () => {
    expect(verdictOf([], 0)).toBe('no-data');
    expect(verdictOf([], 3)).toBe('clean');
  });

  it('prefers failing over flaky when both are present', () => {
    const entries = aggregate([
      { tests: parseReport(FLAKY_REPORT) },
      { tests: parseReport(RED_REPORT) },
    ]);

    expect(verdictOf(entries, 2)).toBe('failing');
  });
});
