import { AppError } from '@studiq/server/lib/errors';
import {
  extensionForMimeType,
  sniffMimeType,
  UPLOAD_MIME_TYPES,
  type UploadMimeType,
} from '@studiq/server/lib/file-signature';
import { error as logError } from '@studiq/server/lib/log';
import {
  isStoragePathWithinPrefix,
  storagePathFromPublicUrl,
} from '@studiq/server/lib/storage-objects';
import { createServiceClient } from '@studiq/server/lib/supabase/service';
import type { SupabaseClient } from '@supabase/supabase-js';

const BUCKET = 'flashcard-media';

/** Flashcard media cap. Keep `MAX_REQUEST_BYTES` in sync with next.config.mjs. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
/** Upload body cap: the file plus the multipart envelope headroom. */
export const MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + 1024 * 1024;

/**
 * Hard caps for the image buckets we write to. Must stay in sync with
 * `storage.buckets.file_size_limit` in the migrations — a file that passes this
 * check but not the bucket's is rejected by the provider, which turns our
 * clean 413 into a provider-status-dependent error (#271).
 */
const IMAGE_BUCKET_MAX_BYTES = {
  'org-logos': 5 * 1024 * 1024, // supabase/migrations/20260920000002_org_branding.sql
  'assignment-images': 10 * 1024 * 1024, // supabase/migrations/20260713000001_teacher_assignments.sql
} as const;

type ImageBucket = keyof typeof IMAGE_BUCKET_MAX_BYTES;

const IMAGE_MIME_TYPES: readonly UploadMimeType[] = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
];

/** Bytes read from the head of the file for signature sniffing. */
const SNIFF_BYTES = 32;

/**
 * Validates an upload by content, not by the client-declared Content-Type: the
 * declared type must be allow-listed **and** the actual bytes must sniff to that
 * same type. Returns the sniffed type, which is what the caller must persist.
 */
async function validateUpload(
  file: File,
  allowed: readonly UploadMimeType[],
  maxBytes: number,
): Promise<UploadMimeType> {
  if (!allowed.includes(file.type as UploadMimeType)) {
    throw new AppError('UNPROCESSABLE_ENTITY');
  }
  if (file.size === 0) {
    throw new AppError('UNPROCESSABLE_ENTITY');
  }
  if (file.size > maxBytes) {
    throw new AppError('PAYLOAD_TOO_LARGE');
  }

  const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
  const detected = sniffMimeType(head);
  if (!detected || detected !== file.type) {
    throw new AppError('UNPROCESSABLE_ENTITY');
  }

  return detected;
}

/** Provider errors carry the HTTP status under two different keys. */
function storageErrorStatus(error: unknown): number {
  const status = Number(
    (error as { status?: number }).status ?? (error as { statusCode?: string }).statusCode,
  );
  return Number.isFinite(status) ? status : 0;
}

/** Never leak provider messages to the client; keep them in the log instead. */
function throwStorageError(bucket: string, error: unknown): never {
  const statusForLog = storageErrorStatus(error);

  logError('Storage upload failed', { bucket, status: statusForLog });

  if (statusForLog === 413) throw new AppError('PAYLOAD_TOO_LARGE');
  throw new AppError('INTERNAL_SERVER');
}

export class StorageService {
  constructor(private createClient: () => SupabaseClient = createServiceClient) {}

  async uploadFile(userId: string, file: File): Promise<{ url: string }> {
    const mimeType = await validateUpload(file, UPLOAD_MIME_TYPES, MAX_UPLOAD_BYTES);

    const supabase = this.createClient();
    // Path/extension/Content-Type all come from the sniffed bytes — never from
    // the attacker-controlled file name or declared type.
    const storagePath = `${userId}/${crypto.randomUUID()}.${extensionForMimeType(mimeType)}`;

    const { error } = await supabase.storage.from(BUCKET).upload(storagePath, file, {
      contentType: mimeType,
      upsert: false,
    });

    if (error) throwStorageError(BUCKET, error);

    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);

    return { url: urlData.publicUrl };
  }

  async uploadToBucket(
    _userId: string,
    file: File,
    bucket: ImageBucket,
    pathPrefix: string,
  ): Promise<{ url: string }> {
    const mimeType = await validateUpload(file, IMAGE_MIME_TYPES, IMAGE_BUCKET_MAX_BYTES[bucket]);

    const supabase = this.createClient();
    const storagePath = `${pathPrefix}/${crypto.randomUUID()}.${extensionForMimeType(mimeType)}`;

    const { error } = await supabase.storage.from(bucket).upload(storagePath, file, {
      contentType: mimeType,
      upsert: false,
    });

    if (error) throwStorageError(bucket, error);

    const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(storagePath);

    return { url: urlData.publicUrl };
  }

  /**
   * Deletes one object. Best-effort by contract (#281): never throws and never
   * surfaces a provider error. A failed delete leaves an orphan for
   * `scripts/storage-orphan-sweep.ts`, which is worse than a broken logo but far
   * better than turning a successful upload into a user-visible 500.
   */
  async deleteObject(bucket: ImageBucket, storagePath: string): Promise<boolean> {
    try {
      const supabase = this.createClient();
      const { error } = await supabase.storage.from(bucket).remove([storagePath]);

      if (error) {
        logError('Storage delete failed', {
          bucket,
          path: storagePath,
          status: storageErrorStatus(error),
        });
        return false;
      }

      return true;
    } catch (error) {
      logError('Storage delete failed', {
        bucket,
        path: storagePath,
        status: storageErrorStatus(error),
      });
      return false;
    }
  }

  /**
   * Deletes the object a public URL points at, but only when it parses to
   * `bucket` **and** lives below `pathPrefix/`. `organizations.logo_url` accepts
   * an arbitrary URL, so this bucket + prefix guard is the authorization
   * boundary that keeps the cleanup from becoming a cross-tenant delete.
   */
  async deleteObjectByPublicUrl(
    bucket: ImageBucket,
    url: string,
    pathPrefix: string,
  ): Promise<boolean> {
    const path = storagePathFromPublicUrl(bucket, url);
    if (!path || !isStoragePathWithinPrefix(path, pathPrefix)) return false;
    return this.deleteObject(bucket, path);
  }
}

export const storageService = new StorageService();
