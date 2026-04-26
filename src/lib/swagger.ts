import { registry } from "@/lib/zod";
import { OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import { createSwaggerSpec } from "next-swagger-doc";
import {} from "@/server/models";

export const getApiDocs = async () => {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  const zodComponents = generator.generateComponents();
  const spec = createSwaggerSpec({
    apiFolder: "src/app/api",
    definition: {
      openapi: "3.0.0",
      info: {
        title: "StudiQ API Documentation",
        version: "1.0.0",
      },
      components: {
        ...(zodComponents.components as any),
        securitySchemes: {
        cookieAuth: {
            type: "apiKey",
            in: "cookie",
            name: "sb-127-auth-token",
            description: "Supabase session cookie. Automatically handled by the browser.",
          },
        },
      },
      security: [],
    },
  });
  return spec;
};
