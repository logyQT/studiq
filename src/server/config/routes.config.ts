export type RouteRule = {
  /** The Regex pattern to match the pathname */
  matcher: RegExp;
  /** Does this route require the user to be authenticated? */
  requireAuth?: boolean;
  /** Which roles are allowed to access this route? (If empty, all authenticated users) */
  allowedRoles?: string[];
  /** If the user is ALREADY logged in, redirect them here (useful for /login, /register) */
  redirectIfAuthenticated?: string;
  /** Is this an API route? Determines if we return a JSON error (401/403) or a 302 Redirect */
  isApi?: boolean;
};

export const routeRules: RouteRule[] = [
  // --- API ROUTES ---
  {
    matcher: /^\/api\/v1\/admin(\/.*)?$/, // Matches /api/v1/admin and anything after it
    requireAuth: true,
    allowedRoles: ['admin'],
    isApi: true,
  },
  {
    matcher: /^\/api\/v1\/teacher(\/.*)?$/,
    requireAuth: true,
    allowedRoles: ['teacher', 'admin'],
    isApi: true,
  },

  // --- PUBLIC AUTH ROUTES (Redirect to dashboard if already logged in) ---
  {
    matcher: /^\/(login|register)(\/.*)?$/,
    redirectIfAuthenticated: '/dashboard',
  },

  // --- UI DASHBOARD ROUTES ---
  {
    matcher: /^\/dashboard\/admin(\/.*)?$/,
    requireAuth: true,
    allowedRoles: ['admin'],
  },
  {
    matcher: /^\/dashboard\/teacher(\/.*)?$/,
    requireAuth: true,
    allowedRoles: ['teacher', 'admin'],
  },
  {
    matcher: /^\/dashboard(\/.*)?$/, // Base dashboard (must be placed AFTER specific dashboard routes)
    requireAuth: true,
  },
];
