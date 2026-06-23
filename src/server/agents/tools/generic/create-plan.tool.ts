import { tool } from 'ai';
import { z } from '@/lib/zod';

export const createPlanTool = tool({
  description:
    'Create a plan for complex multi-step requests that genuinely need coordination. Outline the steps before executing them.',
  inputSchema: z.object({
    steps: z
      .array(
        z.object({
          action: z.string().describe('What action to take'),
          rationale: z.string().describe('Why this step is needed'),
          dependsOn: z
            .array(z.string())
            .optional()
            .describe('Step indices this depends on'),
        }),
      )
      .describe('The ordered steps to execute'),
    estimatedComplexity: z
      .enum(['simple', 'moderate', 'complex'])
      .describe('How complex this task is'),
    needsClarification: z
      .boolean()
      .describe('Whether you need to ask the user for more information'),
  }),
  execute: async (args) => {
    return args;
  },
});
