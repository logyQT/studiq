import { describe, expect, it } from 'vitest';
import { createServiceClient, TEST_USERS } from '#test/integration/helpers';

// Regression tests for #185: `flashcard-media` must serve uploaded objects over
// the public URL returned by StorageService (buckets.public = true) WITHOUT a
// storage.objects SELECT policy — such a policy would also authorise the list
// endpoint for anon and expose every user's media (review-1-r1, finding #1).

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const BUCKET = 'flashcard-media';
const service = createServiceClient();
const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

describe('flashcard-media bucket (#185)', () => {
  it('serves uploaded objects over the public URL', async () => {
    const path = `${TEST_USERS.STUDENT.id}/${crypto.randomUUID()}.png`;
    const { error } = await service.storage
      .from(BUCKET)
      .upload(path, new Blob([PNG], { type: 'image/png' }), { contentType: 'image/png' });
    expect(error).toBeNull();

    try {
      const { data } = service.storage.from(BUCKET).getPublicUrl(path);
      const res = await fetch(data.publicUrl);

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('image/png');
    } finally {
      await service.storage.from(BUCKET).remove([path]);
    }
  });

  it('does not let anon enumerate the bucket', async () => {
    const res = await fetch(`${url}/storage/v1/object/list/${BUCKET}`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prefix: '', limit: 100 }),
    });

    // The list endpoint always answers 200; with no storage.objects SELECT
    // policy it must be an empty list for an anonymous caller.
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});
