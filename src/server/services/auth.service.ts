import { RegisterInput, LoginInput } from "@/server/models"
import { createClient } from "@/lib/supabase/server";

export class AuthService {
  async register(data: RegisterInput): Promise<void> {
    const supabase = await createClient();

    // Supabase Auth automatycznie obsłuży wysyłkę maila potwierdzającego
    // i sprawdzi, czy użytkownik już istnieje (zgodnie z config.toml)
    const { error } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        data: {
          name: data.name,
        },
      },
    });

    if (error) {
      throw new Error(error.message);
    }

    console.log(`[Supabase Auth] Proces rejestracji rozpoczęty dla: ${data.email}`);
  }

  async login(data: LoginInput): Promise<{ user: any }> {
    const supabase = await createClient();

    const { data: authData, error } = await supabase.auth.signInWithPassword({
      email: data.email,
      password: data.password,
    });

    if (error) {
      throw new Error("ERROR_INVALID_CREDENTIALS");
    }

    return {
      user: authData.user,
    };
  }

  async logout(): Promise<void> {
    const supabase = await createClient();
    const { error } = await supabase.auth.signOut();

    if (error) {
      throw new Error(error.message);
    }
  }
}

export const authService = new AuthService();