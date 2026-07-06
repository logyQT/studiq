import { ValidationErrorCode } from '@/lib/validation-errors';
import { registry, z } from '@/lib/zod';

export const CreateSubscriptionPlanSchema = registry.register(
  'CreateSubscriptionPlanRequest',
  z.object({
    key: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .min(1, { error: ValidationErrorCode.TOO_SHORT })
      .max(32, { error: ValidationErrorCode.TOO_LONG }),
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
    priceMonthly: z
      .number({ error: ValidationErrorCode.NUMBER })
      .int({ error: ValidationErrorCode.INTEGER })
      .min(0, { error: ValidationErrorCode.TOO_SMALL })
      .optional()
      .default(0),
    priceYearly: z
      .number({ error: ValidationErrorCode.NUMBER })
      .int({ error: ValidationErrorCode.INTEGER })
      .min(0, { error: ValidationErrorCode.TOO_SMALL })
      .optional()
      .default(0),
    sortOrder: z
      .number({ error: ValidationErrorCode.NUMBER })
      .int({ error: ValidationErrorCode.INTEGER })
      .optional()
      .default(0),
    isActive: z.boolean({ error: ValidationErrorCode.BOOL }).optional().default(true),
  }),
);

export const UpdateSubscriptionPlanSchema = registry.register(
  'UpdateSubscriptionPlanRequest',
  z.object({
    key: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .min(1, { error: ValidationErrorCode.TOO_SHORT })
      .max(32, { error: ValidationErrorCode.TOO_LONG })
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
    priceMonthly: z
      .number({ error: ValidationErrorCode.NUMBER })
      .int({ error: ValidationErrorCode.INTEGER })
      .min(0, { error: ValidationErrorCode.TOO_SMALL })
      .optional(),
    priceYearly: z
      .number({ error: ValidationErrorCode.NUMBER })
      .int({ error: ValidationErrorCode.INTEGER })
      .min(0, { error: ValidationErrorCode.TOO_SMALL })
      .optional(),
    sortOrder: z
      .number({ error: ValidationErrorCode.NUMBER })
      .int({ error: ValidationErrorCode.INTEGER })
      .optional(),
    isActive: z.boolean({ error: ValidationErrorCode.BOOL }).optional(),
  }),
);

export const SubscriptionPlanIdParamsSchema = registry.register(
  'SubscriptionPlanIdParams',
  z.object({
    id: z.uuid({ error: ValidationErrorCode.INVALID_INPUT }),
  }),
);

export type CreateSubscriptionPlanInput = z.infer<typeof CreateSubscriptionPlanSchema>;
export type UpdateSubscriptionPlanInput = z.infer<typeof UpdateSubscriptionPlanSchema>;
export type SubscriptionPlanIdParams = z.infer<typeof SubscriptionPlanIdParamsSchema>;
