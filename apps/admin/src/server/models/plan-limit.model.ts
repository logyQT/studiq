import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import { registry, z } from '@studiq/server/lib/zod';

export const CreatePlanLimitSchema = registry.register(
  'CreatePlanLimitRequest',
  z.object({
    planKey: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED }),
    limitKey: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED }),
    limitValue: z
      .number({ error: ValidationErrorCode.NUMBER })
      .int({ error: ValidationErrorCode.INTEGER }),
  }),
);

export const UpdatePlanLimitSchema = registry.register(
  'UpdatePlanLimitRequest',
  z.object({
    limitValue: z
      .number({ error: ValidationErrorCode.NUMBER })
      .int({ error: ValidationErrorCode.INTEGER }),
  }),
);

export const PlanLimitIdParamsSchema = registry.register(
  'PlanLimitIdParams',
  z.object({
    id: z.uuid({ error: ValidationErrorCode.INVALID_INPUT }),
  }),
);

export const PlanLimitQuerySchema = registry.register(
  'PlanLimitQuery',
  z.object({
    planKey: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED }),
  }),
);

export type CreatePlanLimitInput = z.infer<typeof CreatePlanLimitSchema>;
export type UpdatePlanLimitInput = z.infer<typeof UpdatePlanLimitSchema>;
export type PlanLimitIdParams = z.infer<typeof PlanLimitIdParamsSchema>;
export type PlanLimitQuery = z.infer<typeof PlanLimitQuerySchema>;
