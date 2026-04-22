/**
 * =============================================================================
 * SERVER MODULE INDEX
 * =============================================================================
 *
 * Centralny punkt eksportu dla logiki backendowej.
 *
 * ARCHITEKTURA:
 * =============
 *
 * Route Handler (src/app/api/...)
 *        ↓
 *   Controller (walidacja, formatowanie)
 *        ↓
 *    Service (logika biznesowa)
 *        ↓
 *     Model (dane, baza danych)
 *
 *
 * PRZYKŁAD PRZEPŁYWU:
 * ===================
 *
 * 1. Request: POST /api/v1/users
 *
 * 2. Route Handler (src/app/api/v1/users/route.ts):
 *    export async function POST(request: Request) {
 *      const body = await request.json();
 *      const user = await UserController.create(body);
 *      return NextResponse.json(user, { status: 201 });
 *    }
 *
 * 3. Controller (src/server/controllers/user.controller.ts):
 *    static async create(data: unknown) {
 *      const validated = CreateUserSchema.parse(data);
 *      return UserService.createUser(validated);
 *    }
 *
 * 4. Service (src/server/services/user.service.ts):
 *    static async createUser(data: CreateUserInput) {
 *      const hashedPassword = await hash(data.password);
 *      return db.insert(users).values({ ...data, password: hashedPassword });
 *    }
 *
 *
 * USAGE:
 * ======
 *
 * import { UserController, PostController } from "@/server";
 * import { UserService, PostService } from "@/server";
 */

// Controllers
export * from "./controllers/health.controller";
// export * from "./controllers/user.controller";
// export * from "./controllers/post.controller";

// Services
export * from "./services/health.service";
// export * from "./services/user.service";
// export * from "./services/post.service";

// Models
export * from "./models";
