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

/**
 * Status zdrowia serwera
 */
export type ServiceStatus = 'up' | 'down';
export type AppStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface HealthStatus {
  status: AppStatus;
  timestamp: string;
  uptime: number;
  environment: string;

  services: {
    supabase: ServiceStatus;
  };

  responseTime: number; // ms
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

export enum UserRole {
  FREE = 'free',
  PREMIUM = 'premium',
  STUDENT = 'student',
  TEACHER = 'teacher',
  UNIVERSITY_ADMIN = 'university_admin',
  SYS_ADMIN = 'sys_admin',
}

/**
 * Role, które mogą być nadawane wewnątrz uniwersytetu (np. przez zaproszenia)
 */
export const UNIVERSITY_ROLES = [
  UserRole.STUDENT,
  UserRole.TEACHER,
  UserRole.UNIVERSITY_ADMIN,
] as const;

export type UniversityRole = (typeof UNIVERSITY_ROLES)[number];
