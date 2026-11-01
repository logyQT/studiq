/**
 * File a QA-suite defect without creating duplicates.
 *
 *   bun scripts/qa-issue.ts PUB-07 --title "404 page leaks the locale" --body-file /tmp/body.md \
 *     --attach dashboard/shots/qa-env-3-20261029-101500.png
 *   bun scripts/qa-issue.ts PUB-07 --title "…" --body-file … --search "locale cookie" --attach …
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
import { existsSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const caseId = args.find((a) => !a.startsWith('--') && /^[A-Z][A-Z0-9]+(?:-[A-Z0-9]+)+$/.test(a));
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const title = flag('title');
const bodyFile = flag('body-file');
const extraSearch = flag('search');
const attachments = args.flatMap((a, i) =>
  a === '--attach' && args[i + 1] && !args[i + 1].startsWith('--') ? [args[i + 1]] : [],
);

if (!caseId || !title || !bodyFile) {
  console.error(
    'usage: bun scripts/qa-issue.ts <CASEID> --title "<symptom>" --body-file <path> ' +
      '[--search "<text>"] [--attach <image> ...]',
  );
  process.exit(2);
}

// A local path is not evidence: nobody outside this box can open it. Refuse early
// instead of publishing a dead reference into an issue.
const bodyText = readFileSync(bodyFile, 'utf8');
const pathPattern =
  /(?:\/workspaces\/|\/home\/[^\s]+\/|\/tmp\/[^\s]+|dashboard\/shots\/|\.worktrees\/)[^\s`)\]]*/g;
const leaked = [...new Set(bodyText.match(pathPattern) ?? [])];
if (leaked.length > 0) {
  console.error(
    'refusing to file: the body contains local filesystem path(s), which no reader can open:\n' +
      leaked.map((l) => `  ${l}`).join('\n') +
      '\n\nUpload the image(s) with --attach and reference them only through the upload, e.g.\n' +
      '  --attach dashboard/shots/qa-env-3-20261029-101500.png\n' +
      'and drop the path from the markdown body.',
  );
  process.exit(3);
}

for (const file of attachments) {
  if (!existsSync(file)) {
    console.error(`--attach not found: ${file}`);
    process.exit(4);
  }
}

const attachArgs = attachments.flatMap((file) => ['--attach', file]);

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
  gh(['issue', 'comment', String(target.number), '--body-file', bodyFile, ...attachArgs]);
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
  ...attachArgs,
]);
console.log(JSON.stringify({ action: 'created', url: created.trim().split('\n').pop() }));
