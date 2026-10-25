/**
 * Storage object-key helpers for the public image buckets (#281).
 *
 * Replacing an org logo uploads a *new* randomly named object and only repoints
 * `organizations.logo_url`, so the previous object stayed publicly reachable.
 * Cleaning it up is only safe if the URL we read back from the row cannot be
 * turned into "delete any object in the project": `logo_url` accepts an
 * arbitrary URL (`UpdateOrganizationSchema.logoUrl` is a bare `z.url()`), so
 * every delete has to stay inside one bucket and one `<prefix>/` segment.
 *
 * Everything here is pure (no client, no IO) and unit-tested directly.
 */

const PUBLIC_URL_MARKER = '/storage/v1/object/public/';

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function decodeSegment(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    // Malformed percent-encoding — not a path we wrote.
    return null;
  }
}

/**
 * Public storage URL → object key, but only for objects in `bucket`.
 *
 * Returns `null` for anything else: foreign buckets, signed/authenticated URLs,
 * non-http(s) schemes, malformed URLs, empty / `.` / `..` segments and any
 * segment that decodes to something containing a path separator (traversal).
 */
export function storagePathFromPublicUrl(bucket: string, url: string): string | null {
  if (!bucket) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  // `parsed.pathname` excludes `?`/`#`, so a query string cannot smuggle extra
  // segments into the object key.
  const markerIndex = parsed.pathname.indexOf(PUBLIC_URL_MARKER);
  if (markerIndex === -1) return null;

  const rawSegments = parsed.pathname.slice(markerIndex + PUBLIC_URL_MARKER.length).split('/');

  const decodedBucket = decodeSegment(rawSegments[0] ?? '');
  if (decodedBucket !== bucket) return null;

  const segments: string[] = [];
  for (const raw of rawSegments.slice(1)) {
    if (!raw) return null; // empty segment / trailing slash
    const decoded = decodeSegment(raw);
    if (!decoded || decoded === '.' || decoded === '..') return null;
    if (decoded.includes('/') || decoded.includes('\\')) return null;
    segments.push(decoded);
  }

  if (segments.length === 0) return null;
  return segments.join('/');
}

/**
 * True when `path` is a real object below `prefix/` — never the prefix itself,
 * never a sibling that merely starts with the same characters.
 */
export function isStoragePathWithinPrefix(path: string, prefix: string): boolean {
  if (!prefix) return false;
  const expected = `${prefix}/`;
  return path.startsWith(expected) && path.length > expected.length;
}

export type LogoOrgReference = { id: string; logoUrl: string | null };

export type LogoOrphanPlan = {
  /** Objects nobody references any more — safe to delete. */
  orphans: string[];
  /** Objects a live org row still points at. */
  kept: string[];
  /** Objects we refuse to judge — never deleted. */
  skipped: { path: string; reason: string }[];
};

/**
 * Decision logic for the one-off sweep (`scripts/storage-orphan-sweep.ts`), no
 * IO. Objects are matched to an org by their first path segment; the second
 * segment belongs to the file name, so only an exact match on the org's current
 * logo path counts as referenced.
 */
export function planOrphanedLogoDeletes(
  bucket: string,
  orgs: readonly LogoOrgReference[],
  objectPaths: readonly string[],
): LogoOrphanPlan {
  // `null` = the org has no logo (so nothing under its prefix is referenced).
  const referenced = new Map<string, string | null>();
  // An unparsable `logo_url` is not proof of an orphan — skip that org entirely.
  const unusable = new Set<string>();

  for (const org of orgs) {
    if (org.logoUrl === null || org.logoUrl === '') {
      referenced.set(org.id, null);
      continue;
    }
    const path = storagePathFromPublicUrl(bucket, org.logoUrl);
    if (path === null) {
      unusable.add(org.id);
      continue;
    }
    referenced.set(org.id, path);
  }

  const plan: LogoOrphanPlan = { orphans: [], kept: [], skipped: [] };

  for (const path of objectPaths) {
    const prefix = path.split('/')[0] ?? '';
    if (!UUID_SHAPE.test(prefix)) {
      plan.skipped.push({ path, reason: 'first path segment is not an organization id' });
      continue;
    }

    if (unusable.has(prefix)) {
      plan.skipped.push({ path, reason: 'organization logo_url is not a usable storage URL' });
      continue;
    }

    if (!referenced.has(prefix)) {
      plan.orphans.push(path);
      continue;
    }

    if (referenced.get(prefix) === path) plan.kept.push(path);
    else plan.orphans.push(path);
  }

  return plan;
}
