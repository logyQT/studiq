import { registry, z } from '@/lib/zod';

export const CreateAssignmentSchema = registry.register(
  'CreateAssignmentRequest',
  z.object({
    userId: z.string().uuid(),
    poolId: z.string().uuid(),
  }),
);
export type CreateAssignmentInput = z.infer<typeof CreateAssignmentSchema>;

export const UpdatePoolSchema = registry.register(
  'UpdatePoolRequest',
  z.object({
    total: z.number().int().min(0),
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
