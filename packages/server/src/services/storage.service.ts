import { AppError } from '@studiq/server/lib/errors';
import { createServiceClient } from '@studiq/server/lib/supabase/service';

const BUCKET = 'flashcard-media';

const ALLOWED_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
];
const MAX_SIZE = 50 * 1024 * 1024;

function validateFile(file: File): void {
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new AppError('UNPROCESSABLE_ENTITY');
  }
  if (file.size > MAX_SIZE) {
    throw new AppError('UNPROCESSABLE_ENTITY');
  }
}

export class StorageService {
  async uploadFile(userId: string, file: File): Promise<{ url: string }> {
    validateFile(file);

    const supabase = createServiceClient();
    const ext = file.name.split('.').pop() ?? 'bin';
    const storagePath = `${userId}/${crypto.randomUUID()}.${ext}`;

    const { error } = await supabase.storage.from(BUCKET).upload(storagePath, file, {
      contentType: file.type,
      upsert: false,
    });

    if (error) throw new AppError('INTERNAL_SERVER');

    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);

    return { url: urlData.publicUrl };
  }

  async uploadToBucket(
    _userId: string,
    file: File,
    bucket: string,
    pathPrefix: string,
  ): Promise<{ url: string }> {
    const allowedImageTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
    if (!allowedImageTypes.includes(file.type)) {
      throw new AppError('UNPROCESSABLE_ENTITY');
    }
    if (file.size > 10 * 1024 * 1024) {
      throw new AppError('UNPROCESSABLE_ENTITY');
    }

    const supabase = createServiceClient();
    const ext = file.name.split('.').pop() ?? 'png';
    const storagePath = `${pathPrefix}/${crypto.randomUUID()}.${ext}`;

    const { error } = await supabase.storage.from(bucket).upload(storagePath, file, {
      contentType: file.type,
      upsert: false,
    });

    if (error) throw new AppError('INTERNAL_SERVER');

    const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(storagePath);

    return { url: urlData.publicUrl };
  }
}

export const storageService = new StorageService();
