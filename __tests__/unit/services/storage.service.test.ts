import { StorageService } from '@studiq/server/services/storage.service';
import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const logErrorMock = vi.fn();
vi.mock('@studiq/server/lib/log', () => ({
  log: vi.fn(),
  warn: vi.fn(),
  error: (...args: unknown[]) => logErrorMock(...args),
}));

const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d];
const PNG_MIME = 'image/png';

function makeFile(bytes: number[], type: string, name = 'upload.png', sizeOverride?: number): File {
  const file = new Blob([Uint8Array.from(bytes)], { type }) as unknown as File;
  Object.defineProperty(file, 'name', { value: name });
  if (sizeOverride !== undefined) {
    Object.defineProperty(file, 'size', { value: sizeOverride });
  }
  return file;
}

function createStorageClient(
  uploadResult: unknown = { data: { path: 'p' }, error: null },
  removeResult: unknown = { data: [{ name: 'removed' }], error: null },
) {
  const upload = vi.fn().mockResolvedValue(uploadResult);
  const remove = vi.fn().mockResolvedValue(removeResult);
  const getPublicUrl = vi.fn((path: string) => ({
    data: { publicUrl: `https://storage.test/${path}` },
  }));
  const from = vi.fn(() => ({ upload, getPublicUrl, remove }));

  return {
    client: { storage: { from } } as unknown as SupabaseClient,
    upload,
    remove,
    getPublicUrl,
    from,
  };
}

describe('StorageService', () => {
  let storage: ReturnType<typeof createStorageClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    storage = createStorageClient();
  });

  const service = () => new StorageService(() => storage.client);

  describe('uploadFile', () => {
    it('rejects HTML bytes declared as image/png without touching storage', async () => {
      const file = makeFile(
        Array.from(new TextEncoder().encode('<html><script>alert(1)</script></html>')),
        PNG_MIME,
      );

      await expect(service().uploadFile('user-1', file)).rejects.toMatchObject({
        code: 'UNPROCESSABLE_ENTITY',
        statusCode: 422,
      });
      expect(storage.from).not.toHaveBeenCalled();
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('rejects an allow-listed type whose bytes sniff to something else', async () => {
      const gifBytes = Array.from(new TextEncoder().encode('GIF89a'));
      const file = makeFile(gifBytes, PNG_MIME);

      await expect(service().uploadFile('user-1', file)).rejects.toMatchObject({
        code: 'UNPROCESSABLE_ENTITY',
      });
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('rejects a type that is not on the allow-list', async () => {
      const file = makeFile(PNG_BYTES, 'image/svg+xml');

      await expect(service().uploadFile('user-1', file)).rejects.toMatchObject({
        code: 'UNPROCESSABLE_ENTITY',
      });
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('rejects an empty file', async () => {
      const file = makeFile([], PNG_MIME);

      await expect(service().uploadFile('user-1', file)).rejects.toMatchObject({
        code: 'UNPROCESSABLE_ENTITY',
      });
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('rejects files above 50 MB with PAYLOAD_TOO_LARGE', async () => {
      const file = makeFile(PNG_BYTES, PNG_MIME, 'big.png', 50 * 1024 * 1024 + 1);

      await expect(service().uploadFile('user-1', file)).rejects.toMatchObject({
        code: 'PAYLOAD_TOO_LARGE',
        statusCode: 413,
      });
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('stores a valid PNG under the user prefix with the sniffed extension and type', async () => {
      // A misleading file name must not influence the stored path.
      const file = makeFile(PNG_BYTES, PNG_MIME, 'evil.html');

      const result = await service().uploadFile('user-1', file);

      expect(storage.from).toHaveBeenCalledWith('flashcard-media');
      expect(storage.upload).toHaveBeenCalledTimes(1);

      const [path, , options] = storage.upload.mock.calls[0];
      expect(path).toMatch(/^user-1\/[0-9a-f-]{36}\.png$/);
      expect(options).toEqual({ contentType: 'image/png', upsert: false });
      expect(result).toEqual({ url: `https://storage.test/${path}` });
    });

    it('maps a storage 413 to PAYLOAD_TOO_LARGE', async () => {
      storage = createStorageClient({
        data: null,
        error: { status: 413, message: 'Payload too large' },
      });
      const file = makeFile(PNG_BYTES, PNG_MIME);

      await expect(service().uploadFile('user-1', file)).rejects.toMatchObject({
        code: 'PAYLOAD_TOO_LARGE',
      });
    });

    it('maps other storage failures to INTERNAL_SERVER without leaking the message', async () => {
      storage = createStorageClient({
        data: null,
        error: { status: 500, message: 'provider detail' },
      });
      const file = makeFile(PNG_BYTES, PNG_MIME);

      await expect(service().uploadFile('user-1', file)).rejects.toMatchObject({
        code: 'INTERNAL_SERVER',
        statusCode: 500,
      });
    });

    it('maps storage errors without a status to INTERNAL_SERVER', async () => {
      storage = createStorageClient({ data: null, error: { message: 'boom' } });
      const file = makeFile(PNG_BYTES, PNG_MIME);

      await expect(service().uploadFile('user-1', file)).rejects.toMatchObject({
        code: 'INTERNAL_SERVER',
      });
    });
  });

  describe('uploadToBucket', () => {
    it('accepts images only', async () => {
      const audio = makeFile(Array.from(new TextEncoder().encode('ID3')), 'audio/mpeg', 'a.mp3');

      await expect(
        service().uploadToBucket('user-1', audio, 'org-logos', 'org-1'),
      ).rejects.toMatchObject({ code: 'UNPROCESSABLE_ENTITY' });
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('rejects HTML bytes declared as image/png', async () => {
      const file = makeFile(
        Array.from(new TextEncoder().encode('<html><script>alert(1)</script></html>')),
        PNG_MIME,
      );

      await expect(
        service().uploadToBucket('user-1', file, 'assignment-images', 'org-1/a/b'),
      ).rejects.toMatchObject({ code: 'UNPROCESSABLE_ENTITY' });
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('rejects a plain-text file renamed fake.png for org-logos (issue #273 repro)', async () => {
      const file = makeFile(
        Array.from(new TextEncoder().encode('this is not an image\n')),
        PNG_MIME, // browser derives this from the .png extension
        'fake.png',
      );

      await expect(
        service().uploadToBucket('user-1', file, 'org-logos', 'org-1'),
      ).rejects.toMatchObject({ code: 'UNPROCESSABLE_ENTITY', statusCode: 422 });
      expect(storage.from).not.toHaveBeenCalled();
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('rejects bytes whose sniffed type differs from the declared type', async () => {
      const file = makeFile(PNG_BYTES, 'image/gif');

      await expect(
        service().uploadToBucket('user-1', file, 'org-logos', 'org-1'),
      ).rejects.toMatchObject({ code: 'UNPROCESSABLE_ENTITY' });
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('rejects org-logos files above the bucket 5 MB cap with PAYLOAD_TOO_LARGE', async () => {
      const file = makeFile(PNG_BYTES, PNG_MIME, 'logo.png', 5 * 1024 * 1024 + 1);

      await expect(
        service().uploadToBucket('user-1', file, 'org-logos', 'org-1'),
      ).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE', statusCode: 413 });
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('accepts an org-logos file at exactly the 5 MB cap', async () => {
      const file = makeFile(PNG_BYTES, PNG_MIME, 'logo.png', 5 * 1024 * 1024);

      await service().uploadToBucket('user-1', file, 'org-logos', 'org-1');

      expect(storage.upload).toHaveBeenCalledTimes(1);
    });

    it('rejects assignment-images files above the bucket 10 MB cap with PAYLOAD_TOO_LARGE', async () => {
      const file = makeFile(PNG_BYTES, PNG_MIME, 'answer.png', 10 * 1024 * 1024 + 1);

      await expect(
        service().uploadToBucket('user-1', file, 'assignment-images', 'org-1/a/b'),
      ).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE', statusCode: 413 });
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('accepts an assignment-images file at exactly the 10 MB cap', async () => {
      const file = makeFile(PNG_BYTES, PNG_MIME, 'answer.png', 10 * 1024 * 1024);

      await service().uploadToBucket('user-1', file, 'assignment-images', 'org-1/a/b');

      expect(storage.upload).toHaveBeenCalledTimes(1);
    });

    it('keeps the provided bucket and path prefix, using the sniffed extension', async () => {
      const file = makeFile(PNG_BYTES, PNG_MIME, 'logo.txt');

      const result = await service().uploadToBucket('user-1', file, 'org-logos', 'org-1');

      expect(storage.from).toHaveBeenCalledWith('org-logos');

      const [path, , options] = storage.upload.mock.calls[0];
      expect(path).toMatch(/^org-1\/[0-9a-f-]{36}\.png$/);
      expect(options).toEqual({ contentType: 'image/png', upsert: false });
      expect(result).toEqual({ url: `https://storage.test/${path}` });
    });
  });

  describe('deleteObject (#281)', () => {
    const PATH = 'org-1/6e0e12cb-8349-42e9-a34c-59677c8c558f.png';

    it('removes exactly the given object key', async () => {
      const deleted = await service().deleteObject('org-logos', PATH);

      expect(deleted).toBe(true);
      expect(storage.from).toHaveBeenCalledWith('org-logos');
      expect(storage.remove).toHaveBeenCalledTimes(1);
      expect(storage.remove).toHaveBeenCalledWith([PATH]);
    });

    it('logs a provider error and returns false instead of throwing', async () => {
      storage = createStorageClient(undefined, {
        data: null,
        error: { status: 500, message: 'provider detail' },
      });

      const deleted = await service().deleteObject('org-logos', PATH);

      expect(deleted).toBe(false);
      expect(logErrorMock).toHaveBeenCalledWith('Storage delete failed', {
        bucket: 'org-logos',
        path: PATH,
        status: 500,
      });
      // Provider messages never reach the log record.
      expect(JSON.stringify(logErrorMock.mock.calls)).not.toContain('provider detail');
    });

    it('never throws when the client itself blows up', async () => {
      const throwingClient = {
        storage: {
          from: () => ({
            remove: () => Promise.reject(new Error('network down')),
          }),
        },
      } as unknown as SupabaseClient;

      const deleted = await new StorageService(() => throwingClient).deleteObject(
        'org-logos',
        PATH,
      );

      expect(deleted).toBe(false);
      expect(logErrorMock).toHaveBeenCalledWith('Storage delete failed', {
        bucket: 'org-logos',
        path: PATH,
        status: 0,
      });
    });
  });

  describe('deleteObjectByPublicUrl (#281)', () => {
    const PUBLIC = 'https://project.supabase.co/storage/v1/object/public/org-logos';
    const previousUrl = `${PUBLIC}/org-1/6e0e12cb-8349-42e9-a34c-59677c8c558f.png`;

    it("deletes the previous org-logo object when it is inside the org's prefix", async () => {
      const deleted = await service().deleteObjectByPublicUrl('org-logos', previousUrl, 'org-1');

      expect(deleted).toBe(true);
      expect(storage.remove).toHaveBeenCalledWith([
        'org-1/6e0e12cb-8349-42e9-a34c-59677c8c558f.png',
      ]);
    });

    it.each([
      ['another organization', `${PUBLIC}/org-2/logo.png`, 'org-1'],
      ['a sibling prefix', `${PUBLIC}/org-1-2/logo.png`, 'org-1'],
      [
        'another bucket',
        `${PUBLIC.replace('org-logos', 'assignment-images')}/org-1/logo.png`,
        'org-1',
      ],
      ['an external URL without a storage path', 'https://evil.test/org-1/logo.png', 'org-1'],
      ['a traversal URL', `${PUBLIC}/org-1/../org-2/logo.png`, 'org-1'],
      ['a malformed URL', 'not a url', 'org-1'],
    ])('does not delete for %s', async (_label, url, prefix) => {
      const deleted = await service().deleteObjectByPublicUrl('org-logos', url, prefix);

      expect(deleted).toBe(false);
      expect(storage.remove).not.toHaveBeenCalled();
    });
  });
});
