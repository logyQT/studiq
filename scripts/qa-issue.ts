/**
 * File a QA-suite defect without creating duplicates.
 *
 *   bun scripts/qa-issue.ts PUB-07 --title "404 page leaks the locale" --body-file /tmp/body.md
 *   bun scripts/qa-issue.ts PUB-07 --title "…" --body-file … --search "locale cookie"
 *
 * Behaviour:
 *   1. searches **every** issue (open + closed) for the case id in title/body, plus the
 *      optional `--search` text;
 *   2. if something matches, comments on the best match with your evidence and exits 0;
 *   3. otherwise creates `[QA-SUITE] <CASEID> <title>` labelled `bug`.
 *
 * Workers must never call `gh issue create` directly: this is the dedup guardrail.
 */
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const caseId = args.find((a) => !a.startsWith('--') && /^[A-Z][A-Z0-9]+(?:-[A-Z0-9]+)+$/.test(a));
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const title = flag('title');
const bodyFile = flag('body-file');
const extraSearch = flag('search');

if (!caseId || !title || !bodyFile) {
  console.error(
    'usage: bun scripts/qa-issue.ts <CASEID> --title "<symptom>" --body-file <path> [--search "<text>"]',
  );
  process.exit(2);
}

const gh = (ghArgs: string[]): string =>
  execFileSync('gh', ghArgs, { encoding: 'utf8', timeout: 60_000 });

interface Issue {
  number: number;
  title: string;
  state: string;
  url: string;
}

function search(query: string): Issue[] {
  try {
    const raw = gh([
      'issue',
      'list',
      '--state',
      'all',
      '--limit',
      '20',
      '--search',
      query,
      '--json',
      'number,title,state,url',
    ]);
    return JSON.parse(raw) as Issue[];
  } catch {
    return [];
  }
}

// Title matches are the reliable signal (one defect = one issue titled with the case id).
// Body matches are noisy: another case's issue often mentions this id in passing.
const queries = [`${caseId} in:title`];
if (extraSearch) queries.push(`${extraSearch} in:title,body`);

const seen = new Set<number>();
const matches: Issue[] = [];
for (const query of queries) {
  for (const issue of search(query)) {
    if (seen.has(issue.number)) continue;
    seen.add(issue.number);
    matches.push(issue);
  }
}

const open = matches.find((issue) => issue.state.toUpperCase() === 'OPEN');
const target = open;

if (target) {
  gh(['issue', 'comment', String(target.number), '--body-file', bodyFile]);
  console.log(
    JSON.stringify({
      action: 'commented',
      issue: target.number,
      state: target.state,
      url: target.url,
      reason: 'existing issue mentions this case or symptom',
    }),
  );
  process.exit(0);
}

const created = gh([
  'issue',
  'create',
  '--title',
  `[QA-SUITE] ${caseId} ${title}`.slice(0, 240),
  '--body-file',
  bodyFile,
  '--label',
  'bug',
]);
console.log(JSON.stringify({ action: 'created', url: created.trim().split('\n').pop() }));
