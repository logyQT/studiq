import { User, RegisterInput, LoginInput } from "../models/user.model";

const usersMockDB: User[] = [];

export class AuthService {
  async register(data: RegisterInput): Promise<void> {
    const existingUser = usersMockDB.find((u) => u.email === data.email);

    if (existingUser) {
      console.log(`[Mock Mailer] Wysłano info o istniejącym koncie na: ${data.email}`);
      return;
    }

    const newUser: User = {
      id: crypto.randomUUID(),
      ...data,
    };

    usersMockDB.push(newUser);

    console.log(`[Mock Mailer] Wysłano link aktywacyjny na: ${data.email}`);
  }

  async login(data: LoginInput): Promise<{ token: string; user: Omit<User, "password"> }> {
    const user = usersMockDB.find((u) => u.email === data.email);

    if (!user || user.password !== data.password) {
      // Zwracamy kod błędu
      throw new Error("ERROR_INVALID_CREDENTIALS");
    }

    const { password, ...userWithoutPassword } = user;

    return {
      token: `mock-jwt-token-${crypto.randomUUID()}`,
      user: userWithoutPassword,
    };
  }
}

export const authService = new AuthService();
