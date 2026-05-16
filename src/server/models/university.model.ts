import { z, registry } from '@/lib/zod';
import { ValidationErrorCode } from '@/lib/validation-errors';

export const CreateUniversitySchema = registry.register(
  'CreateUniversityRequest',
  z.object({
    name: z
      .string({ error: ValidationErrorCode.NAME_REQUIRED })
      .min(3, { error: ValidationErrorCode.NAME_TOO_SHORT }),
    slug: z
      .string({ error: ValidationErrorCode.INVALID_INPUT })
      .min(2, { error: ValidationErrorCode.INVALID_INPUT })
      .regex(/^[a-z0-9-]+$/, { error: ValidationErrorCode.NAME_INVALID_FORMAT }),
  }),
);

export const UpdateUniversitySchema = registry.register(
  'UpdateUniversityRequest',
  z
    .object({
      name: z
        .string({ error: ValidationErrorCode.NAME_REQUIRED })
        .min(3, { error: ValidationErrorCode.NAME_TOO_SHORT })
        .optional(),
      slug: z
        .string({ error: ValidationErrorCode.INVALID_INPUT })
        .min(2, { error: ValidationErrorCode.INVALID_INPUT })
        .regex(/^[a-z0-9-]+$/, { error: ValidationErrorCode.NAME_INVALID_FORMAT })
        .optional(),
    })
    .refine((data) => data.name !== undefined || data.slug !== undefined, {
      message: ValidationErrorCode.INVALID_INPUT,
    }),
);

export const UniversityIdParamsSchema = registry.register(
  'UniversityIdParams',
  z.object({
    id: z.uuid({ error: ValidationErrorCode.INVALID_INPUT }),
  }),
);

export const UniversityResponseSchema = registry.register(
  'UniversityResponse',
  z.object({
    id: z.uuid(),
    name: z.string(),
    slug: z.string(),
    created_at: z.string().datetime(),
  }),
);

export type CreateUniversityInput = z.infer<typeof CreateUniversitySchema>;
export type UpdateUniversityInput = z.infer<typeof UpdateUniversitySchema>;
export type UniversityIdParams = z.infer<typeof UniversityIdParamsSchema>;
export type UniversityResponse = z.infer<typeof UniversityResponseSchema>;
