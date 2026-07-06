/**
 * =============================================================================
 * TYPES INDEX
 * =============================================================================
 *
 * Centralny plik eksportujący wszystkie typy TypeScript.
 *
 * Użycie:
 *   import type { User, Post, ApiResponse } from "@/types";
 *
 * Organizacja:
 * - Typy domenowe (User, Post, Comment)
 * - Typy API (ApiResponse, PaginatedResponse)
 * - Typy utility (WithId, Nullable)
 */

// =============================================================================
// API TYPES
// =============================================================================

/**
 * Standardowa odpowiedź API
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Odpowiedź z paginacją
 */
export interface PaginatedResponse<T> {
  items: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

// =============================================================================
// UTILITY TYPES
// =============================================================================

/**
 * Dodaje pole id do typu
 */
export type WithId<T> = T & { id: string };

/**
 * Umożliwia null dla typu
 */
export type Nullable<T> = T | null;

/**
 * Partial z głębokim zagnieżdżeniem
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export enum AccountType {
  STUDENT = 'student',
  EDUCATOR = 'educator',
  MANAGER = 'manager',
}

export type OrgRole = {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  is_system: boolean;
};

export * from './features';

// =============================================================================
// HEALTH TYPES – defined in src/server/models/health.model.ts
// =============================================================================

export * from './questions';
