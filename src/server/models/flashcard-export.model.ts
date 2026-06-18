import { z, registry } from '@/lib/zod';

export const ExportQuerySchema = registry.register(
  'ExportQuery',
  z.object({
    deckId: z.string().uuid().optional(),
    ids: z.string().optional(),
    deckIds: z.string().optional(),
  }),
);

export type ExportQuery = z.infer<typeof ExportQuerySchema>;
