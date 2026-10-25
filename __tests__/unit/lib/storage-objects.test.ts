import {
  isStoragePathWithinPrefix,
  planOrphanedLogoDeletes,
  storagePathFromPublicUrl,
} from '@studiq/server/lib/storage-objects';
import { describe, expect, it } from 'vitest';

const ORG_A = '00000000-0000-4000-8000-000000000001';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const PROJECT = 'https://project.supabase.co';

function publicUrl(bucket: string, path: string): string {
  return `${PROJECT}/storage/v1/object/public/${bucket}/${path}`;
}

describe('storagePathFromPublicUrl', () => {
  it('parses a public org-logos URL into its object key', () => {
    const url = publicUrl('org-logos', `${ORG_A}/6e0e12cb-8349-42e9-a34c-59677c8c558f.png`);

    expect(storagePathFromPublicUrl('org-logos', url)).toBe(
      `${ORG_A}/6e0e12cb-8349-42e9-a34c-59677c8c558f.png`,
    );
  });

  it('ignores the query string and fragment', () => {
    const url = `${publicUrl('org-logos', `${ORG_A}/logo.png`)}?v=2#top`;

    expect(storagePathFromPublicUrl('org-logos', url)).toBe(`${ORG_A}/logo.png`);
  });

  it('decodes each segment exactly once', () => {
    const url = publicUrl('org-logos', `${ORG_A}/my%20logo.png`);

    expect(storagePathFromPublicUrl('org-logos', url)).toBe(`${ORG_A}/my logo.png`);
  });

  it('rejects another bucket', () => {
    const url = publicUrl('assignment-images', `${ORG_A}/logo.png`);

    expect(storagePathFromPublicUrl('org-logos', url)).toBeNull();
  });

  it('rejects a URL without the public object marker', () => {
    // Signed (authenticated) URLs are not the shape we write into logo_url.
    const signed = `${PROJECT}/storage/v1/object/sign/org-logos/${ORG_A}/logo.png?token=abc`;
    const authenticated = `${PROJECT}/storage/v1/object/authenticated/org-logos/${ORG_A}/logo.png`;

    expect(storagePathFromPublicUrl('org-logos', signed)).toBeNull();
    expect(storagePathFromPublicUrl('org-logos', authenticated)).toBeNull();
  });

  it('rejects an external URL', () => {
    expect(storagePathFromPublicUrl('org-logos', 'https://evil.test/org-logos/a/b.png')).toBeNull();
  });

  it.each([
    'not a url',
    'ftp://project.supabase.co/storage/v1/object/public/org-logos/a/b.png',
    'javascript:alert(1)',
  ])('rejects a malformed or non-http URL: %s', (url) => {
    expect(storagePathFromPublicUrl('org-logos', url)).toBeNull();
  });

  it('rejects malformed percent-encoding', () => {
    const url = `${PROJECT}/storage/v1/object/public/org-logos/${ORG_A}/%E0%A4%A.png`;

    expect(storagePathFromPublicUrl('org-logos', url)).toBeNull();
  });

  it('rejects traversal and encoded separators', () => {
    const urls = [
      `${PROJECT}/storage/v1/object/public/org-logos/${ORG_A}/..%2Flogo.png`,
      `${PROJECT}/storage/v1/object/public/org-logos/${ORG_A}/a%2Fb.png`,
      `${PROJECT}/storage/v1/object/public/org-logos/${ORG_A}/a%5Cb.png`,
      `${PROJECT}/storage/v1/object/public/org-logos/${ORG_A}//logo.png`,
      `${PROJECT}/storage/v1/object/public/org-logos/${ORG_A}/`,
    ];

    for (const url of urls) {
      expect(storagePathFromPublicUrl('org-logos', url), url).toBeNull();
    }
  });

  it('normalises bare dot segments, so the prefix guard is what rejects them', () => {
    // `new URL()` resolves `..` before we ever see the path, so the result can
    // point at another org — the bucket + prefix guard in the caller is the
    // boundary that stops the delete, not the parser.
    const url = `${PROJECT}/storage/v1/object/public/org-logos/${ORG_A}/../${ORG_B}/logo.png`;
    const path = storagePathFromPublicUrl('org-logos', url);

    expect(path).toBe(`${ORG_B}/logo.png`);
    expect(path && isStoragePathWithinPrefix(path, ORG_A)).toBe(false);
  });

  it('rejects a bare bucket URL with no object path', () => {
    expect(
      storagePathFromPublicUrl('org-logos', `${PROJECT}/storage/v1/object/public/org-logos/`),
    ).toBeNull();
  });
});

describe('isStoragePathWithinPrefix', () => {
  it('accepts an object below the exact prefix', () => {
    expect(isStoragePathWithinPrefix(`${ORG_A}/logo.png`, ORG_A)).toBe(true);
  });

  it('rejects a sibling prefix that only shares characters', () => {
    expect(isStoragePathWithinPrefix(`${ORG_A}-2/logo.png`, ORG_A)).toBe(false);
  });

  it("rejects another org's object", () => {
    expect(isStoragePathWithinPrefix(`${ORG_B}/logo.png`, ORG_A)).toBe(false);
  });

  it('rejects the prefix itself and an empty prefix', () => {
    expect(isStoragePathWithinPrefix(ORG_A, ORG_A)).toBe(false);
    expect(isStoragePathWithinPrefix(`${ORG_A}/logo.png`, '')).toBe(false);
  });
});

describe('planOrphanedLogoDeletes', () => {
  it('keeps the referenced object and deletes the superseded one (issue #281 repro)', () => {
    const stale = `${ORG_A}/6e0e12cb-8349-42e9-a34c-59677c8c558f.png`;
    const current = `${ORG_A}/58bca681-ce61-44e7-9605-fd6833042dd8.png`;

    const plan = planOrphanedLogoDeletes(
      'org-logos',
      [{ id: ORG_A, logoUrl: publicUrl('org-logos', current) }],
      [stale, current],
    );

    expect(plan.kept).toEqual([current]);
    expect(plan.orphans).toEqual([stale]);
    expect(plan.skipped).toEqual([]);
  });

  it('treats every object as orphaned when the org has no logo', () => {
    const path = `${ORG_A}/logo.png`;

    const plan = planOrphanedLogoDeletes('org-logos', [{ id: ORG_A, logoUrl: null }], [path]);

    expect(plan.orphans).toEqual([path]);
    expect(plan.kept).toEqual([]);
  });

  it('deletes objects whose organization no longer exists', () => {
    const path = `${ORG_B}/logo.png`;

    const plan = planOrphanedLogoDeletes(
      'org-logos',
      [{ id: ORG_A, logoUrl: publicUrl('org-logos', `${ORG_A}/logo.png`) }],
      [path],
    );

    expect(plan.orphans).toEqual([path]);
  });

  it('skips (never deletes) objects of an org with an unparsable logo_url', () => {
    const path = `${ORG_A}/logo.png`;

    const plan = planOrphanedLogoDeletes(
      'org-logos',
      [{ id: ORG_A, logoUrl: 'https://cdn.example.com/logo.png' }],
      [path],
    );

    expect(plan.orphans).toEqual([]);
    expect(plan.skipped).toEqual([
      { path, reason: 'organization logo_url is not a usable storage URL' },
    ]);
  });

  it('reports objects whose first segment is not an organization id', () => {
    const plan = planOrphanedLogoDeletes('org-logos', [], ['stray-file.png', 'notes/a.png']);

    expect(plan.orphans).toEqual([]);
    expect(plan.skipped.map((entry) => entry.path)).toEqual(['stray-file.png', 'notes/a.png']);
  });

  it('skips an object pointed at by another bucket URL', () => {
    const path = `${ORG_A}/logo.png`;

    const plan = planOrphanedLogoDeletes(
      'org-logos',
      [{ id: ORG_A, logoUrl: publicUrl('assignment-images', path) }],
      [path],
    );

    expect(plan.orphans).toEqual([]);
    expect(plan.skipped).toHaveLength(1);
  });
});
