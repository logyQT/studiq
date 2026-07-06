import { ValidationErrorCode } from '@/lib/validation-errors';
import { registry, z } from '@/lib/zod';

export const CreateUserFeatureOverrideSchema = registry.register(
  'CreateUserFeatureOverrideRequest',
  z.object({
    userId: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED }),
    featureKey: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED }),
    isEnabled: z.boolean({ error: ValidationErrorCode.BOOL }),
    reason: z
      .string({ error: ValidationErrorCode.INVALID_INPUT })
      .max(256, { error: ValidationErrorCode.TOO_LONG })
      .optional()
      .nullable()
      .default(null),
    expiresAt: z
      .string({ error: ValidationErrorCode.INVALID_INPUT })
      .optional()
      .nullable()
      .default(null),
  }),
);

export const UpdateUserFeatureOverrideSchema = registry.register(
  'UpdateUserFeatureOverrideRequest',
  z.object({
    isEnabled: z.boolean({ error: ValidationErrorCode.BOOL }).optional(),
    reason: z
      .string({ error: ValidationErrorCode.INVALID_INPUT })
      .max(256, { error: ValidationErrorCode.TOO_LONG })
      .optional()
      .nullable(),
    expiresAt: z.string({ error: ValidationErrorCode.INVALID_INPUT }).optional().nullable(),
  }),
);

export const UserFeatureOverrideIdParamsSchema = registry.register(
  'UserFeatureOverrideIdParams',
  z.object({
    id: z.uuid({ error: ValidationErrorCode.INVALID_INPUT }),
  }),
);

export type CreateUserFeatureOverrideInput = z.infer<typeof CreateUserFeatureOverrideSchema>;
export type UpdateUserFeatureOverrideInput = z.infer<typeof UpdateUserFeatureOverrideSchema>;
export type UserFeatureOverrideIdParams = z.infer<typeof UserFeatureOverrideIdParamsSchema>;
