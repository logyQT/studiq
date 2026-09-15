import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { wrapService } from '@/lib/observability';
import { failure, type ServiceResult, success } from '@/lib/service-result';
import { createClient } from '@/lib/supabase/server';
import type { LoginInput, RegisterInput, User } from '@/server/models/auth.model';

export class AuthService {
  constructor(private createClient: () => Promise<SupabaseClient>) {}

  async register(data: RegisterInput): Promise<ServiceResult<void, 'INTERNAL_SERVER'>> {
    const supabase = await this.createClient();

    const { error } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        data: {
          name: data.name,
          account_type: data.accountType,
        },
      },
    });

    if (error) {
      if (
        process.env.NODE_ENV === 'development' &&
        (error.status === 422 ||
          error.code === 'user_already_exists' ||
          error.message.includes('already registered'))
      ) {
        return success(undefined);
      }

      return failure('INTERNAL_SERVER');
    }

    return success(undefined);
  }

  async login(
    data: LoginInput,
  ): Promise<ServiceResult<{ user: User; session: Session }, 'UNAUTHORIZED' | 'INTERNAL_SERVER'>> {
    const supabase = await this.createClient();

    const { data: authData, error } = await supabase.auth.signInWithPassword({
      email: data.email,
      password: data.password,
    });

    if (error) {
      return failure('UNAUTHORIZED');
    }

    if (!authData.user || !authData.session) {
      return failure('INTERNAL_SERVER');
    }

    return success({ user: authData.user, session: authData.session });
  }

  async logout(): Promise<ServiceResult<void, 'INTERNAL_SERVER'>> {
    const supabase = await this.createClient();

    const { error } = await supabase.auth.signOut({ scope: 'local' });

    if (error) {
      return failure('INTERNAL_SERVER');
    }

    return success(undefined);
  }

  async requestPasswordReset(email: string): Promise<ServiceResult<void, 'BAD_REQUEST'>> {
    const supabase = await this.createClient();

    const { error } = await supabase.auth.resetPasswordForEmail(email);

    if (error) {
      return failure('BAD_REQUEST');
    }

    return success(undefined);
  }

  async updateProfile(data: { name: string }): Promise<ServiceResult<User, 'BAD_REQUEST'>> {
    const supabase = await this.createClient();

    const { data: updatedUser, error } = await supabase.auth.updateUser({
      data: { name: data.name },
    });

    if (error) {
      return failure('BAD_REQUEST');
    }

    return success(updatedUser.user as User);
  }

  async updatePassword(
    password: string,
  ): Promise<ServiceResult<void, 'UNPROCESSABLE_ENTITY' | 'BAD_REQUEST'>> {
    const supabase = await this.createClient();

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      if (error.code === 'same_password') {
        return failure('UNPROCESSABLE_ENTITY');
      }

      return failure('BAD_REQUEST');
    }

    return success(undefined);
  }
}
export const authService = wrapService(new AuthService(createClient), 'auth.service');
