import type { ParsedCommand } from '../atoms';
import { collectSnapshot } from '../lib/snapshot';
import { printJson, writeLine } from '../lib/output';
import type { StatusSnapshot } from '../lib/json';

function orDash(value: string | number | boolean | null): string {
  if (value === null) return '-';
  if (value === '') return '-';
  return String(value);
}

function printHuman(snapshot: StatusSnapshot): void {
  let project: string;
  if (snapshot.shared) {
    project = `${orDash(snapshot.projectId)} (shared${snapshot.sharedOwner ? `: ${snapshot.sharedOwner}` : ''})`;
  } else if (snapshot.stack) {
    project = `stack ${snapshot.stack.id.slice(0, 12)}${snapshot.stack.name !== 'default' ? ` (${snapshot.stack.name})` : ''}${snapshot.stack.branch ? ` @ ${snapshot.stack.branch}` : ''}`;
  } else {
    project = '(stopped; no stack for this branch)';
  }

  writeLine(`ready       ${snapshot.ready}`);
  writeLine(`project     ${project}`);
  if (snapshot.profile)
    writeLine(`profile     ${snapshot.profile}${snapshot.cold ? ' (cold)' : ''}`);
  if (snapshot.runtime) writeLine(`runtime     ${snapshot.runtime}`);
  writeLine(`worktree    ${snapshot.worktree}`);
  writeLine(
    `web         ${snapshot.web.url}  http=${snapshot.web.http}  pid=${orDash(snapshot.web.pid)}`,
  );
  writeLine(`supabase    ${orDash(snapshot.supabase.url)}  http=${snapshot.supabase.http}`);
  writeLine(`db          ${orDash(snapshot.dbUrl)}`);
  writeLine(`mail        ${orDash(snapshot.mailUrl)}`);
  writeLine(`studio      ${orDash(snapshot.urls.studio)}`);
  writeLine(
    `ports       app=${snapshot.ports.app} api=${snapshot.ports.api} db=${snapshot.ports.db} studio=${snapshot.ports.studio} mail=${snapshot.ports.mail}`,
  );
  writeLine(`seeded      ${orDash(snapshot.seeded)}`);
  writeLine(
    `build       ${snapshot.build.present} ${orDash(snapshot.build.fingerprint?.slice(0, 12) ?? null)}`,
  );
  writeLine(`registry    ${snapshot.registry}`);
  if (snapshot.owner) writeLine(`owner       ${snapshot.owner}`);
  for (const warning of snapshot.warnings) writeLine(`warning     ${warning}`);
}

export async function runStatus(parsed: ParsedCommand): Promise<number> {
  const snapshot = await collectSnapshot();
  if (parsed.json) printJson(snapshot);
  else printHuman(snapshot);
  return 0;
}
