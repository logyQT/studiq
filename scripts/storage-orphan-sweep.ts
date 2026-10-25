/**
 * One-off operator backstop for leaked `org-logos` objects (#281).
 *
 * Logo replacement used to upload a new randomly named object and only repoint
 * `organizations.logo_url`, leaving the previous file publicly reachable. The
 * app now deletes the replaced object, but this sweep clears the objects that
 * already leaked and the ones left behind by deleted organizations.
 *
 * Deletion is opt-in: without `--apply` this only reports.
 *
 * Usage:
 *   bun scripts/storage-orphan-sweep.ts                 # report only (dry run)
 *   bun scripts/storage-orphan-sweep.ts --apply         # delete the reported orphans
 *   bun scripts/storage-orphan-sweep.ts --org <uuid>    # restrict to one organization
 */
import { planOrphanedLogoDeletes, type LogoOrgReference } from '@studiq/server/lib/storage-objects';
import { createServiceClient } from '@studiq/server/lib/supabase/service';
import type { SupabaseClient } from '@supabase/supabase-js';

const BUCKET = 'org-logos';
const PAGE_SIZE = 100;
/** Supabase `remove()` accepts at most 100 keys per call. */
const DELETE_BATCH_SIZE = 100;
/** Hard stop so a pagination bug cannot loop forever against the provider. */
const MAX_PAGES = 1000;

type StoredObject = { path: string; size: number };

function fail(message: string): never {
  console.error(`storage-orphan-sweep: ${message}`);
  process.exit(1);
}

function argValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) fail(`${flag} requires a value`);
  return value;
}

async function loadOrganizations(
  supabase: SupabaseClient,
  orgId: string | null,
): Promise<LogoOrgReference[]> {
  const orgs: LogoOrgReference[] = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    let query = supabase.from('organizations').select('id, logo_url').order('id');
    if (orgId) query = query.eq('id', orgId);
    const { data, error } = await query.range(from, from + PAGE_SIZE - 1);

    if (error) fail(`organizations query failed: ${error.message}`);

    const rows = (data ?? []) as { id: string; logo_url: string | null }[];
    for (const row of rows) orgs.push({ id: row.id, logoUrl: row.logo_url });
    if (rows.length < PAGE_SIZE) break;
  }

  return orgs;
}

/** Lists one folder level, following the provider's pagination. */
async function listLevel(
  supabase: SupabaseClient,
  prefix: string,
): Promise<{ folders: string[]; files: StoredObject[] }> {
  const folders: string[] = [];
  const files: StoredObject[] = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error } = await supabase.storage.from(BUCKET).list(prefix, {
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      sortBy: { column: 'name', order: 'asc' },
    });

    if (error) fail(`listing "${prefix || '/'}" failed: ${error.message}`);

    const entries = data ?? [];
    for (const entry of entries) {
      // Folder entries have no id; the name is the next prefix segment.
      if (entry.id === null) {
        folders.push(prefix ? `${prefix}/${entry.name}` : entry.name);
        continue;
      }
      const size = Number((entry.metadata as { size?: number } | null)?.size ?? 0);
      files.push({ path: prefix ? `${prefix}/${entry.name}` : entry.name, size });
    }

    if (entries.length < PAGE_SIZE) break;
  }

  return { folders, files };
}

async function collectObjects(
  supabase: SupabaseClient,
  orgId: string | null,
): Promise<StoredObject[]> {
  const objects: StoredObject[] = [];

  if (orgId) {
    const { files } = await listLevel(supabase, orgId);
    objects.push(...files);
    return objects;
  }

  const root = await listLevel(supabase, '');
  // Files sitting directly in the bucket root have no org prefix, so the
  // planner reports them as skipped — we never guess what they belong to.
  objects.push(...root.files);

  for (const folder of root.folders) {
    const { files } = await listLevel(supabase, folder);
    objects.push(...files);
  }

  return objects;
}

async function main(): Promise<void> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) fail('NEXT_PUBLIC_SUPABASE_URL is not set');
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) fail('SUPABASE_SERVICE_ROLE_KEY is not set');

  const apply = process.argv.includes('--apply');
  const orgId = argValue('--org');
  const supabase = createServiceClient();

  const orgs = await loadOrganizations(supabase, orgId);
  if (orgId && orgs.length === 0) fail(`organization ${orgId} not found`);

  const objects = await collectObjects(supabase, orgId);
  const plan = planOrphanedLogoDeletes(
    BUCKET,
    orgs,
    objects.map((object) => object.path),
  );

  const sizeByPath = new Map(objects.map((object) => [object.path, object.size]));
  const rows = [
    ...plan.kept.map((path) => ({ decision: 'kept', path })),
    ...plan.orphans.map((path) => ({ decision: 'ORPHAN', path })),
    ...plan.skipped.map((entry) => ({ decision: 'skipped', path: entry.path })),
  ];

  for (const row of rows) {
    console.log(`${row.decision.padEnd(8)} ${row.path} (${sizeByPath.get(row.path) ?? 0} B)`);
  }
  for (const entry of plan.skipped) {
    console.log(`  skipped reason: ${entry.path} — ${entry.reason}`);
  }

  console.log(
    `\n${rows.length} object(s): ${plan.kept.length} kept, ${plan.orphans.length} orphaned, ${plan.skipped.length} skipped.`,
  );

  if (!apply) {
    console.log('Dry run — nothing deleted. Re-run with --apply to delete the orphans.');
    return;
  }

  if (plan.orphans.length === 0) {
    console.log('Nothing to delete.');
    return;
  }

  let deleted = 0;
  for (let index = 0; index < plan.orphans.length; index += DELETE_BATCH_SIZE) {
    const batch = plan.orphans.slice(index, index + DELETE_BATCH_SIZE);
    const { data, error } = await supabase.storage.from(BUCKET).remove(batch);
    if (error) fail(`delete failed: ${error.message}`);
    deleted += (data ?? []).length;
  }

  const remaining = new Set((await collectObjects(supabase, orgId)).map((object) => object.path));
  const stillPresent = plan.orphans.filter((path) => remaining.has(path));
  if (stillPresent.length > 0) {
    console.error(`still present after delete:\n  ${stillPresent.join('\n  ')}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `Deleted ${deleted} of ${plan.orphans.length} orphaned object(s); re-list confirms they are gone.`,
  );
}

await main();
