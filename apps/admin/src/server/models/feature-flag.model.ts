import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import { registry, z } from '@studiq/server/lib/zod';
import { isFeatureKey } from '@studiq/server/services/feature.resolver';

export const CreateFeatureFlagSchema = registry.register(
  'CreateFeatureFlagRequest',
  z.object({
    key: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .regex(/^[a-z][a-z0-9.]*$/, { error: ValidationErrorCode.NAME_INVALID_FORMAT })
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .min(1, { error: ValidationErrorCode.TOO_SHORT })
      .max(64, { error: ValidationErrorCode.TOO_LONG })
      .refine((k) => isFeatureKey(k), {
        message: ValidationErrorCode.INVALID_INPUT,
        path: ['key'],
      }),
    name: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .min(2, { error: ValidationErrorCode.TOO_SHORT })
      .max(64, { error: ValidationErrorCode.TOO_LONG }),
    description: z
      .string({ error: ValidationErrorCode.INVALID_INPUT })
      .max(256, { error: ValidationErrorCode.TOO_LONG })
      .optional()
      .nullable()
      .default(null),
    isEnabled: z.boolean({ error: ValidationErrorCode.BOOL }).optional().default(true),
    rolloutPercentage: z
      .number({ error: ValidationErrorCode.NUMBER })
      .int({ error: ValidationErrorCode.INTEGER })
      .min(0, { error: ValidationErrorCode.TOO_SMALL })
      .max(100, { error: ValidationErrorCode.TOO_BIG })
      .optional()
      .default(100),
  }),
);

export const UpdateFeatureFlagSchema = registry.register(
  'UpdateFeatureFlagRequest',
  z.object({
    key: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .regex(/^[a-z][a-z0-9.]*$/, { error: ValidationErrorCode.NAME_INVALID_FORMAT })
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .min(1, { error: ValidationErrorCode.TOO_SHORT })
      .max(64, { error: ValidationErrorCode.TOO_LONG })
      .refine((k) => isFeatureKey(k), {
        message: ValidationErrorCode.INVALID_INPUT,
        path: ['key'],
      })
      .optional(),
    name: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .min(2, { error: ValidationErrorCode.TOO_SHORT })
      .max(64, { error: ValidationErrorCode.TOO_LONG })
      .optional(),
    description: z
      .string({ error: ValidationErrorCode.INVALID_INPUT })
      .max(256, { error: ValidationErrorCode.TOO_LONG })
      .optional()
      .nullable(),
    isEnabled: z.boolean({ error: ValidationErrorCode.BOOL }).optional(),
    rolloutPercentage: z
      .number({ error: ValidationErrorCode.NUMBER })
      .int({ error: ValidationErrorCode.INTEGER })
      .min(0, { error: ValidationErrorCode.TOO_SMALL })
      .max(100, { error: ValidationErrorCode.TOO_BIG })
      .optional(),
  }),
);

export const FeatureFlagIdParamsSchema = registry.register(
  'FeatureFlagIdParams',
  z.object({
    id: z.uuid({ error: ValidationErrorCode.INVALID_INPUT }),
  }),
);

export type CreateFeatureFlagInput = z.infer<typeof CreateFeatureFlagSchema>;
export type UpdateFeatureFlagInput = z.infer<typeof UpdateFeatureFlagSchema>;
export type FeatureFlagIdParams = z.infer<typeof FeatureFlagIdParamsSchema>;
