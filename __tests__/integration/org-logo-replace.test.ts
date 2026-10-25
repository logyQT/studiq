import { StorageService } from '@studiq/server/services/storage.service';
import { describe, expect, it } from 'vitest';
import { createServiceClient } from '#test/integration/helpers';

// Regression test for #281: re-uploading an org logo must delete the object the
// row used to point at, so the old public URL stops resolving. Runs against the
// live local Supabase (integration suite); the path prefix is a random UUID so
// no real organization is touched.
const BUCKET = 'org-logos';
const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

function logoFile(name: string): File {
  return new File([PNG], name, { type: 'image/png' });
}

describe('org logo replacement (#281)', () => {
  it('deletes the replaced object and keeps the new one public', async () => {
    const service = new StorageService(() => createServiceClient());
    const storage = createServiceClient();
    const prefix = crypto.randomUUID();

    const first = await service.uploadToBucket('user-1', logoFile('first.png'), BUCKET, prefix);
    const second = await service.uploadToBucket('user-1', logoFile('second.png'), BUCKET, prefix);

    try {
      expect((await fetch(first.url)).status).toBe(200);

      await expect(service.deleteObjectByPublicUrl(BUCKET, first.url, prefix)).resolves.toBe(true);

      // storage-api answers 400 for a missing object on self-hosted Supabase and
      // 404 on the hosted CDN; both mean the public URL no longer resolves.
      expect([400, 404]).toContain((await fetch(first.url)).status);
      expect((await fetch(second.url)).status).toBe(200);
    } finally {
      await storage.storage.from(BUCKET).remove([first.url, second.url].map(objectPath));
    }
  });

  it("refuses to delete an object outside the caller's prefix", async () => {
    const service = new StorageService(() => createServiceClient());
    const storage = createServiceClient();
    const owner = crypto.randomUUID();
    const other = crypto.randomUUID();

    const victim = await service.uploadToBucket('user-1', logoFile('victim.png'), BUCKET, owner);

    try {
      await expect(service.deleteObjectByPublicUrl(BUCKET, victim.url, other)).resolves.toBe(false);
      expect((await fetch(victim.url)).status).toBe(200);
    } finally {
      await storage.storage.from(BUCKET).remove([objectPath(victim.url)]);
    }
  });
});

/** Public URL → object key (the test only ever sees URLs the service returned). */
function objectPath(url: string): string {
  const marker = '/storage/v1/object/public/';
  const path = new URL(url).pathname;
  return decodeURIComponent(path.slice(path.indexOf(marker) + marker.length + BUCKET.length + 1));
}
