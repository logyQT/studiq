import { z, registry } from '@/lib/zod';

export const RegisterSchema = registry.register(
  'RegisterRequest',
  z.object({
    name: z
      .string({ error: 'ERROR_NAME_REQUIRED' })
      .min(2, { error: 'ERROR_NAME_TOO_SHORT' })
      .regex(/^[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ\s]+$/, { error: 'ERROR_NAME_INVALID_FORMAT' }),

    email: z.email({ error: 'ERROR_EMAIL_INVALID' }),
    password: z
      .string({ error: 'ERROR_PASSWORD_REQUIRED' })
      .min(8, { error: 'ERROR_PASSWORD_TOO_SHORT' }),
  }),
);

export const LoginSchema = registry.register(
  'LoginRequest',
  z.object({
    email: z.email({ error: 'ERROR_EMAIL_INVALID' }),
    password: z
      .string({ error: 'ERROR_PASSWORD_REQUIRED' })
      .min(1, { error: 'ERROR_PASSWORD_REQUIRED' }),
  }),
);

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;

export interface User {
  id: string;
  name: string;
  email: string;
  password?: string;
}
