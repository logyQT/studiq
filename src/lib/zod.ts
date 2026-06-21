import { z } from 'zod';

const definitions: z.ZodTypeAny[] = [];

export const registry = {
  register: <T extends z.ZodTypeAny>(name: string, schema: T): T => {
    definitions.push(schema);
    return schema;
  },
  definitions,
};

export { z };
