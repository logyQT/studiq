/**
 * Deterministic review gates, wired into `verify.yml` and named by
 * `.agents/skills/studiq-review/SKILL.md` (Step 5).
 *
 * `bun run lint` covers what oxlint can express. It cannot see the three
 * tautology shapes that matter in review — an assertion whose two sides are
 * the same AST node (`no-self-compare` only catches the literal `x === x`;
 * `expect(f(x)).toBe(f(x))` has a different node on each side), a label that
 * repeats its placeholder, and a comment that narrates a diff — so those live
 * in `sgconfig.yml` and run here. CodeRabbit is manual-only; this script is the
 * gate that is always on.
 *
 * Usage:
 *   bun scripts/review-static.ts                  # oxlint + rule tests + rules
 *   bun scripts/review-static.ts --changed origin/main   # review scope
 *   bun scripts/review-static.ts --rules-only     # CI: oxlint already ran
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const changedIndex = argv.indexOf('--changed');
const changed = changedIndex >= 0 ? argv[changedIndex + 1] : undefined;
const rulesOnly = argv.includes('--rules-only');

const LINT_SCOPE = ['apps/web/src', 'packages', '__tests__'];
const RULE_DIR = join(process.cwd(), 'rules');
const RULE_TEST_DIR = join(process.cwd(), '__tests__', 'rules');

function run(label: string, cmd: string[]): boolean {
  process.stdout.write(`\n=== ${label}\n`);
  // `stderr` is piped only to drop the ast-grep shim's postinstall notice
  // (this repo blocks install scripts); everything else passes through.
  const result = Bun.spawnSync({ cmd, stdout: 'inherit', stderr: 'pipe' });
  const noise = /postinstall script did not run|Enable postinstall/;
  const stderr = result.stderr
    .toString()
    .split('\n')
    .filter((line) => !noise.test(line))
    .join('\n')
    .trimEnd();
  if (stderr) process.stderr.write(`${stderr}\n`);
  return result.exitCode === 0;
}

/** Rule ids declared in `dir`, read straight from YAML as `ast-grep test` sees them. */
function ruleIds(dir: string): string[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.yml'))
    .map((file) => readFileSync(join(dir, file), 'utf8').match(/^id:\s*(\S+)/m)?.[1])
    .filter((id): id is string => id !== undefined);
}

/**
 * `ast-grep test` reports 0 tests and exits 0 when a test file names an id that
 * no rule has, so a renamed rule would silently drop its safety net.
 */
function everyRuleHasATest(): boolean {
  process.stdout.write('\n=== rule test coverage\n');
  const tested = new Set(ruleIds(RULE_TEST_DIR));
  const untested = ruleIds(RULE_DIR).filter((id) => !tested.has(id));
  if (untested.length > 0) {
    process.stderr.write(`rules without a test in __tests__/rules/: ${untested.join(', ')}\n`);
    return false;
  }
  process.stdout.write('every rule has a test in __tests__/rules/.\n');
  return true;
}

// `bun run review:static` puts node_modules/.bin on PATH; a direct
// `bun scripts/review-static.ts` call does not, so resolve it explicitly.
const localAstGrep = join(process.cwd(), 'node_modules', '.bin', 'ast-grep');
const astGrep = existsSync(localAstGrep) ? localAstGrep : 'ast-grep';

const lintCmd = ['bun', 'lint', '--no-script', ...LINT_SCOPE];
if (changed) lintCmd.push(`--changed=${changed}`);

const results = [
  // CI runs `bun run lint` first, so the oxlint half would be a second pass.
  ...(rulesOnly ? [] : [run(changed ? `oxlint (changed since ${changed})` : 'oxlint', lintCmd)]),
  everyRuleHasATest(),
  run('ast-grep rule tests', [astGrep, 'test', '--config', 'sgconfig.yml']),
  run('ast-grep (tautology rules)', [astGrep, 'scan', '--config', 'sgconfig.yml']),
];

if (results.some((ok) => !ok)) {
  process.stdout.write('\nreview:static failed — a block above is non-zero.\n');
  process.exit(1);
}

process.stdout.write('\nreview:static: clean.\n');
