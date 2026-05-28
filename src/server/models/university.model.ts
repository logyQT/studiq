import { z, registry } from '@/lib/zod';
import { ValidationErrorCode } from '@/lib/validation-errors';

export const CreateUniversitySchema = registry.register(
  'CreateUniversityRequest',
  z.object({
    name: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .min(3, { error: ValidationErrorCode.TOO_SHORT })
      .max(64, { error: ValidationErrorCode.TOO_LONG }),
    slug: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .regex(/^[a-z0-9-]+$/, { error: ValidationErrorCode.NAME_INVALID_FORMAT })
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .min(2, { error: ValidationErrorCode.TOO_SHORT })
      .max(16, { error: ValidationErrorCode.TOO_LONG }),
  }),
);

export const UpdateUniversitySchema = registry.register(
  'UpdateUniversityRequest',
  z
    .object({
      name: z
        .string({ error: ValidationErrorCode.REQUIRED })
        .nonempty({ error: ValidationErrorCode.REQUIRED })
        .min(3, { error: ValidationErrorCode.TOO_SHORT })
        .max(64, { error: ValidationErrorCode.TOO_LONG })
        .optional(),
      slug: z
        .string({ error: ValidationErrorCode.REQUIRED })
        .regex(/^[a-z0-9-]+$/, { error: ValidationErrorCode.NAME_INVALID_FORMAT })
        .nonempty({ error: ValidationErrorCode.REQUIRED })
        .min(2, { error: ValidationErrorCode.TOO_SHORT })
        .max(16, { error: ValidationErrorCode.TOO_LONG })
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
    id: z.uuid({ error: ValidationErrorCode.UUID_INVALID }),
    name: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .min(3, { error: ValidationErrorCode.TOO_SHORT })
      .max(64, { error: ValidationErrorCode.TOO_LONG }),
    slug: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .regex(/^[a-z0-9-]+$/, { error: ValidationErrorCode.NAME_INVALID_FORMAT })
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .min(2, { error: ValidationErrorCode.TOO_SHORT })
      .max(16, { error: ValidationErrorCode.TOO_LONG }),
    created_at: z.iso.datetime(),
  }),
);

export type CreateUniversityInput = z.infer<typeof CreateUniversitySchema>;
export type UpdateUniversityInput = z.infer<typeof UpdateUniversitySchema>;
export type UniversityIdParams = z.infer<typeof UniversityIdParamsSchema>;
export type UniversityResponse = z.infer<typeof UniversityResponseSchema>;
