import { z } from '@/lib/zod';
import type { Tool } from '../types';

const params = z.object({
  steps: z.array(z.object({
    action: z.string(),
    rationale: z.string(),
    dependsOn: z.array(z.string()).optional(),
  })),
  estimatedComplexity: z.enum(['simple', 'moderate', 'complex']),
  needsClarification: z.boolean(),
  clarificationQuestions: z.array(z.string()).optional(),
});

export const createPlanTool: Tool = {
  name: 'create_plan',
  description: 'Create an execution plan for generating educational content. Defines steps in order, dependencies, and whether clarification is needed.',
  parameters: params,
  async execute(args, ctx) {
    ctx.state.metadata['plan'] = args;
    return args;
  },
};
