import { OpenAPIRegistry, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

// if (process.env.NODE_ENV === 'development') {
//   extendZodWithOpenApi(z);
// }

extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();
export { z };
