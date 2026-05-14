import { UserRole } from '@/types';

export type RouteRule = {
  /** The Regex pattern to match the pathname */
  matcher: RegExp;
  /** Does this route require the user to be authenticated? */
  requireAuth?: boolean;
  /** Which roles are allowed to access this route? (If empty, all authenticated users) */
  allowedRoles?: string[];
  /** If the user is ALREADY logged in, redirect them here (useful for /login, /register) */
  redirectIfAuthenticated?: string;
  redirectIfAuthenticatedByRole?: Partial<Record<UserRole, string>>;
  /** Is this an API route? Determines if we return a JSON error (401/403) or a 302 Redirect */
  isApi?: boolean;
};

export const routeRules: RouteRule[] = [
  // --- API ROUTES ---
  {
    matcher: /^\/api\/v1\/admin(\/.*)?$/, // Matches /api/v1/admin and anything after it
    requireAuth: true,
    allowedRoles: [UserRole.SYS_ADMIN],
    isApi: true,
  },
  {
    matcher: /^\/api\/v1\/teacher(\/.*)?$/,
    requireAuth: true,
    allowedRoles: [UserRole.TEACHER, UserRole.SYS_ADMIN],
    isApi: true,
  },

  // --- AUTH ROUTES ---
  {
    matcher: /^\/(login|register)(\/.*)?$/,
    redirectIfAuthenticatedByRole: {
      [UserRole.SYS_ADMIN]: '/admin',
      [UserRole.TEACHER]: '/edu',
      [UserRole.UNIVERSITY_ADMIN]: '/manage',
      [UserRole.STUDENT]: '/app',
      [UserRole.FREE]: '/app',
      [UserRole.PREMIUM]: '/app',
    },
  },

  // --- UI DASHBOARD ROUTES ---
  {
    matcher: /^\/admin(\/.*)?$/,
    requireAuth: true,
    allowedRoles: [UserRole.SYS_ADMIN],
  },
  {
    matcher: /^\/manage(\/.*)?$/,
    requireAuth: true,
    allowedRoles: [UserRole.UNIVERSITY_ADMIN],
  },
  {
    matcher: /^\/edu(\/.*)?$/,
    requireAuth: true,
    allowedRoles: [UserRole.TEACHER],
  },
  {
    matcher: /^\/app(\/.*)?$/,
    requireAuth: true,
    allowedRoles: [UserRole.STUDENT, UserRole.FREE, UserRole.PREMIUM],
  },
];
