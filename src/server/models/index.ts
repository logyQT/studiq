/**
 * =============================================================================
 * MODELS INDEX
 * =============================================================================
 *
 * Ten katalog zawiera modele danych / schematy walidacji.
 *
 * Modele odpowiadają za:
 * - Definicję struktury danych
 * - Walidację danych (np. z Zod)
 * - Mapowanie na bazę danych (jeśli używasz ORM)
 *
 * PRZYKŁAD Z ZOD:
 * ================
 *
 * // src/server/models/user.model.ts
 * import { z } from "zod";
 *
 * export const UserSchema = z.object({
 *   id: z.string().uuid(),
 *   email: z.string().email(),
 *   name: z.string().min(2).max(100),
 *   createdAt: z.date(),
 *   updatedAt: z.date(),
 * });
 *
 * export type User = z.infer<typeof UserSchema>;
 *
 * export const CreateUserSchema = UserSchema.omit({
 *   id: true,
 *   createdAt: true,
 *   updatedAt: true,
 * });
 *
 * export type CreateUserInput = z.infer<typeof CreateUserSchema>;
 *
 *
 * PRZYKŁAD Z DRIZZLE ORM:
 * =======================
 *
 * // src/server/models/schema.ts
 * import { pgTable, uuid, varchar, timestamp } from "drizzle-orm/pg-core";
 *
 * export const users = pgTable("users", {
 *   id: uuid("id").defaultRandom().primaryKey(),
 *   email: varchar("email", { length: 255 }).notNull().unique(),
 *   name: varchar("name", { length: 100 }).notNull(),
 *   createdAt: timestamp("created_at").defaultNow().notNull(),
 *   updatedAt: timestamp("updated_at").defaultNow().notNull(),
 * });
 *
 *
 * EKSPORT MODELI:
 * ===============
 *
 * export * from "./user.model";
 * export * from "./post.model";
 * export * from "./comment.model";
 */

// Dodaj eksporty modeli tutaj:
// export * from "./user.model";
