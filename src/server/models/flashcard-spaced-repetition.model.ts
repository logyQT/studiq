import { z, registry } from '@/lib/zod';
import { ValidationErrorCode } from '@/lib/validation-errors';

export const DueCardsQuerySchema = registry.register(
  'DueCardsQuery',
  z.object({
    topicIds: z
      .string({ error: ValidationErrorCode.INVALID_INPUT })
      .optional(),
    spaceIds: z
      .string({ error: ValidationErrorCode.INVALID_INPUT })
      .optional(),
    limit: z
      .string({ error: ValidationErrorCode.INVALID_INPUT })
      .optional()
      .default('20'),
  }),
);

export type DueCardsQueryInput = z.infer<typeof DueCardsQuerySchema>;
