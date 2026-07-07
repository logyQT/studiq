import { ValidationErrorCode } from '@/lib/validation-errors';
import { registry, z } from '@/lib/zod';

export const CreatePlanFeatureSchema = registry.register(
  'CreatePlanFeatureRequest',
  z.object({
    planKey: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED }),
    featureKey: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED }),
  }),
);

export const DeletePlanFeatureSchema = registry.register(
  'DeletePlanFeatureRequest',
  z.object({
    planKey: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED }),
    featureKey: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED }),
  }),
);

export const PlanFeatureParamsSchema = registry.register(
  'PlanFeatureParams',
  z.object({
    planKey: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED }),
    featureKey: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED }),
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
