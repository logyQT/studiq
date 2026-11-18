import type { ParsedCommand } from '../atoms';
import { collectSnapshot } from '../lib/snapshot';
import { printJson, writeLine } from '../lib/output';
import type { ManifestReport, StatusSnapshot } from '../lib/json';
import { formatBuildSlots } from '../lib/locks';
import type { SnapshotStatus } from '../lib/build-cache';

function orDash(value: string | number | boolean | null): string {
  if (value === null) return '-';
  if (value === '') return '-';
  return String(value);
}

/**
 * The record's fingerprint, labelled `recorded` when the artifact is stale: the
 * number describes the build the record names, not the tree on disk, and an
 * unlabelled one after the word `stale` reads as the tree's.
 */
function buildFingerprintLabel(build: StatusSnapshot['build']): string {
  if (build.fingerprint === null) return '';
  if (build.state === 'current') return ` ${build.fingerprint.slice(0, 12)}`;
  if (build.state === 'stale') return ` (recorded ${build.fingerprint.slice(0, 12)})`;
  return '';
}

function megabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * The snapshot by the numbers the manifest already carries: never a `du`, never a
 * live commit distance, and `unknown` where a field could not be read.
 */
function snapshotLines(snapshot: SnapshotStatus | null): string[] {
  if (snapshot === null) {
    return ['snapshot    none (no published snapshot; every worktree builds cold)'];
  }
  const size = snapshot.sizeBytes === null ? 'unknown' : megabytes(snapshot.sizeBytes);
  const files = snapshot.fileCount === null ? 'unknown' : `${snapshot.fileCount} files`;
  const commit = snapshot.commit ?? 'unknown';
  const age = snapshot.ageDays === null ? 'unknown' : `${snapshot.ageDays.toFixed(1)} days old`;
  const lines = [
    `snapshot    ${size}, ${files}, commit ${commit} (at publish), ${age}`,
    `turbopack   ${snapshot.turbopack === null ? 'unknown' : snapshot.turbopack.join(', ') || 'none'}`,
  ];
  if (snapshot.behindCommits !== null) {
    lines.push(`behind      ${snapshot.behindCommits} commits behind origin/main (at publish)`);
  }
  return lines;
}

/**
 * One line for `.dev/env.json`: the cheap path's agreement with this probe, or
 * the command that creates it. Status is the authority, so a disagreement is
 * reported as staleness rather than as the file's claim.
 */
function manifestLine(manifest: ManifestReport): string {
  if (!manifest.present) {
    return `absent (no command has recorded state here yet; run 'bun run env:ensure --profile web')`;
  }
  if (manifest.error !== null) {
    return `unreadable: ${manifest.error} (rewrite it with 'bun run env:ensure --profile web')`;
  }
  if (manifest.agrees === false) {
    return `stale: ${manifest.differences.join('; ')} (run 'bun run env:ensure --profile web')`;
  }
  return `current (written ${orDash(manifest.writtenAt)})`;
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
    `build       ${snapshot.build.state ?? 'unknown'}${buildFingerprintLabel(snapshot.build)}`,
  );
  writeLine(`slots       ${formatBuildSlots(snapshot.build.slots)}`);
  for (const line of snapshotLines(snapshot.snapshot)) writeLine(line);
  // Only when there is one: a failed build moves its artifact aside instead of
  // deleting it, and this is how an agent learns the directory exists.
  for (const failed of snapshot.build.failed) writeLine(`failed      ${failed}`);
  writeLine(`manifest    ${manifestLine(snapshot.manifest)}`);
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
