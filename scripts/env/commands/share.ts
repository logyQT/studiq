import type { ParsedCommand } from '../atoms';
import { EXIT_CONFLICT, EXIT_START_FAILED, EnvFailure } from '../lib/exit';
import { collectSnapshot } from '../lib/snapshot';
import { printJson, writeLine, writeStderrLine } from '../lib/output';
import { buildPointer, pointerPath, writePointer, type QaPointer } from '../lib/pointer';

/**
 * Hand this checkout's environment to other worktrees.
 *
 * The topology it serves: one checkout owns the app + stack, N agent worktrees
 * run specs against it. The pointer carries URLs only, so the service-role key
 * never leaves the owner's `.env.local`; consumers set `SUPABASE_SHARED=1` and
 * keep their own keys.
 */
export async function runShare(parsed: ParsedCommand): Promise<number> {
  const snapshot = await collectSnapshot();
  if (snapshot.shared) {
    throw new EnvFailure(
      EXIT_CONFLICT,
      'this checkout is in shared mode (SUPABASE_SHARED=1) and owns no stack to share; ' +
        'run env:share in the checkout that started the environment',
    );
  }
  if (!snapshot.ready || !snapshot.urls.supabase) {
    throw new EnvFailure(
      EXIT_START_FAILED,
      'nothing to share: the app or Supabase is not answering — ' +
        'run `bun run env:ensure --profile web` first',
    );
  }

  const pointer = buildPointer(snapshot);
  const write = parsed.share?.write ?? false;
  const result = write ? writePointer(pointer, { force: parsed.share?.force ?? false }) : null;

  if (parsed.json) {
    printJson(pointer);
    if (result && !parsed.quiet) {
      writeStderrLine(`env:share: ${result.state} ${result.path}`);
    }
    return 0;
  }

  printHuman(pointer, result, parsed.quiet);
  return 0;
}

function printHuman(
  pointer: QaPointer,
  result: { path: string; state: string } | null,
  quiet: boolean,
): void {
  const path = pointerPath();
  writeLine('▸ Sharing this checkout’s environment');
  writeLine(`  app        ${pointer.appUrl}`);
  writeLine(`  supabase   ${pointer.supabaseUrl}`);
  writeLine(`  mail       ${pointer.mailpitUrl ?? '-'}`);
  writeLine(
    `  stack      ${pointer.stackId ? pointer.stackId.slice(0, 12) : '-'}` +
      `${pointer.branch ? ` @ ${pointer.branch}` : ''}${pointer.commit ? ` (${pointer.commit})` : ''}`,
  );
  if (result) {
    writeLine(`  pointer    ${result.path} (${result.state})`);
  } else {
    writeLine(`  pointer    not written — re-run with --write to create ${path}`);
  }
  if (quiet) return;
  writeLine('');
  writeLine('  Each consumer worktree (one app, many agents — no stack of its own):');
  writeLine(`    1. cp ${path} <worktree>/qa/env.json`);
  writeLine('    2. set SUPABASE_SHARED=1 in <worktree>/.env.local');
  writeLine(
    '    3. copy NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY from this checkout',
  );
  writeLine('    4. bun run env:status --json   # expect shared: true');
  writeLine('  The pointer carries URLs only: the keys stay in each checkout’s .env.local.');
}
