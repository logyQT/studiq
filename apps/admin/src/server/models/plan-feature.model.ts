import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import { registry, z } from '@studiq/server/lib/zod';
import { isEntitlementKey } from '@studiq/authz';

const PlanEntitlementKeySchema = z
  .string({ error: ValidationErrorCode.REQUIRED })
  .regex(/^[a-z][a-z0-9.]*$/, { error: ValidationErrorCode.NAME_INVALID_FORMAT })
  .nonempty({ error: ValidationErrorCode.REQUIRED })
  .refine((k) => isEntitlementKey(k), {
    message: ValidationErrorCode.INVALID_INPUT,
    path: ['entitlementKey'],
  });

export const CreatePlanFeatureSchema = registry.register(
  'CreatePlanFeatureRequest',
  z.object({
    planKey: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED }),
    entitlementKey: PlanEntitlementKeySchema,
  }),
);

export const DeletePlanFeatureSchema = registry.register(
  'DeletePlanFeatureRequest',
  z.object({
    planKey: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED }),
    entitlementKey: PlanEntitlementKeySchema,
  }),
);

export const PlanFeatureParamsSchema = registry.register(
  'PlanFeatureParams',
  z.object({
    planKey: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED }),
    entitlementKey: PlanEntitlementKeySchema,
  }),
);

export const PlanFeatureIdParamsSchema = registry.register(
  'PlanFeatureIdParams',
  z.object({
    id: z.uuid({ error: ValidationErrorCode.INVALID_INPUT }),
  }),
);

export type CreatePlanFeatureInput = z.infer<typeof CreatePlanFeatureSchema>;
export type DeletePlanFeatureInput = z.infer<typeof DeletePlanFeatureSchema>;
export type PlanFeatureIdParams = z.infer<typeof PlanFeatureIdParamsSchema>;
