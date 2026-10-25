import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import { registry, z } from '@studiq/server/lib/zod';

/**
 * `org_seat_pools.total` is a Postgres `integer` (int4). Values above this bound make
 * Postgres raise 22003 (`numeric_value_out_of_range`), which surfaces as an opaque 500,
 * so the request has to be rejected as 422 at the boundary instead.
 */
export const MAX_SEAT_POOL_TOTAL = 2_147_483_647;

export const CreateAssignmentSchema = registry.register(
  'CreateAssignmentRequest',
  z.object({
    userId: z.string().uuid(),
    poolId: z.string().uuid(),
  }),
);
export type CreateAssignmentInput = z.infer<typeof CreateAssignmentSchema>;

export const CreatePoolSchema = registry.register(
  'CreatePoolRequest',
  z.object({
    planKey: z.string().nonempty(),
    quantity: z
      .number({ error: ValidationErrorCode.NUMBER })
      .int({ error: ValidationErrorCode.INTEGER })
      .positive({ error: ValidationErrorCode.POSITIVE_NUMBER })
      .max(MAX_SEAT_POOL_TOTAL, { error: ValidationErrorCode.TOO_BIG }),
  }),
);
export type CreatePoolInput = z.infer<typeof CreatePoolSchema>;

export const UpdatePoolSchema = registry.register(
  'UpdatePoolRequest',
  z.object({
    total: z
      .number({ error: ValidationErrorCode.NUMBER })
      .int({ error: ValidationErrorCode.INTEGER })
      .min(0, { error: ValidationErrorCode.TOO_SMALL })
      .max(MAX_SEAT_POOL_TOTAL, { error: ValidationErrorCode.TOO_BIG }),
  }),
);
export type UpdatePoolInput = z.infer<typeof UpdatePoolSchema>;

export const PoolResponseSchema = registry.register(
  'PoolResponse',
  z.object({
    id: z.string().uuid(),
    planKey: z.string(),
    total: z.number(),
    assigned: z.number(),
  }),
);

export const AssignmentResponseSchema = registry.register(
  'AssignmentResponse',
  z.object({
    id: z.string().uuid(),
    userId: z.string().uuid(),
    poolId: z.string().uuid(),
    planKey: z.string(),
    userEmail: z.string(),
    userFullName: z.string().nullable(),
    assignedAt: z.string(),
  }),
);
