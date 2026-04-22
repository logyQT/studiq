import { authController } from "@/server/controllers";

export async function POST(req: Request) {
  return authController.register(req);
}
