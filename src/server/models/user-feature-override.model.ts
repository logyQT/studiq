import { ValidationErrorCode } from '@/lib/validation-errors';
import { registry, z } from '@/lib/zod';
import { isFeatureKey } from '@/server/services/feature.resolver';

export const CreateUserFeatureOverrideSchema = registry.register(
  'CreateUserFeatureOverrideRequest',
  z.object({
    userId: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED }),
    featureKey: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .regex(/^[a-z][a-z0-9.]*$/, { error: ValidationErrorCode.NAME_INVALID_FORMAT })
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .refine((k) => isFeatureKey(k), {
        message: ValidationErrorCode.INVALID_INPUT,
        path: ['featureKey'],
      }),
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
