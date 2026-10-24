/**
 * Bun version guard, wired into `bun run lint` / `bun run format`.
 *
 * `bun lint` and `bun fmt` are built into Bun >= 1.4.4. On older versions
 * `bun lint` only runs the `lint` package script — which is this repo's lint
 * script — so the command recurses instead of linting.
 *
 * Usage: `bun scripts/check-bun-version.ts`
 */
const MINIMUM: readonly [number, number, number] = [1, 4, 4];

const [major = 0, minor = 0, patch = 0] = Bun.version.split('.').map((part) => {
  return Number.parseInt(part, 10) || 0;
});

const [minMajor, minMinor, minPatch] = MINIMUM;
const tooOld =
  major < minMajor ||
  (major === minMajor && minor < minMinor) ||
  (major === minMajor && minor === minMinor && patch < minPatch);

if (tooOld) {
  console.error(
    `✖ Bun ${Bun.version} is too old — the built-in linter and formatter need Bun >= ${MINIMUM.join('.')}.`,
  );
  console.error('');
  console.error('  Upgrade Bun, then re-run the command:');
  console.error('    bun upgrade');
  console.error('    # or, while 1.4.4 is still unreleased:');
  console.error('    bun upgrade --canary');
  console.error('');
  console.error('  See AGENTS.md → Commands.');
  process.exit(1);
}
