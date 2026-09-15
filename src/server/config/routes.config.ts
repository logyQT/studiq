import { AccountType } from '@/types';

export type RouteRule = {
  /** The Regex pattern to match the pathname */
  matcher: RegExp;
  /** Does this route require the user to be authenticated? */
  requireAuth?: boolean;
  /** Which account types are allowed to access this route? (If empty, all authenticated users) */
  allowedAccountTypes?: string[];
  /** If the user is ALREADY logged in, redirect them here (useful for /login, /register) */
  redirectIfAuthenticated?: string;
  redirectIfAuthenticatedByAccountType?: Partial<Record<AccountType, string>>;
  /** Is this an API route? Determines if we return a JSON error (401/403) or a 302 Redirect */
  isApi?: boolean;
};

export const routeRules: RouteRule[] = [
  // --- API ROUTES ---
  {
    matcher: /^\/api\/v1\/admin(\/.*)?$/,
    requireAuth: true,
    allowedAccountTypes: [AccountType.SYS_ADMIN],
    isApi: true,
  },
  {
    matcher: /^\/api\/v1\/teacher(\/.*)?$/,
    requireAuth: true,
    allowedAccountTypes: [AccountType.EDUCATOR, AccountType.MANAGER],
    isApi: true,
  },
  {
    matcher: /^\/api\/v1\/ai(\/.*)?$/,
    requireAuth: true,
    allowedAccountTypes: [AccountType.STUDENT, AccountType.EDUCATOR],
    isApi: true,
  },
  // Stripe webhook is public (signature-verified in production)
  {
    matcher: /^\/api\/v1\/stripe\/webhook(\/.*)?$/,
    isApi: true,
  },
  // Catch-all for authenticated API routes (auth, health, avatar, stripe/webhook are unprotected by design)
  {
    matcher: /^\/api\/v\d+\/(?!auth|health|avatar|stripe\/webhook)(.*)$/,
    requireAuth: true,
    isApi: true,
  },

  // --- AUTH ROUTES ---
  {
    matcher: /^\/(login|register)(\/.*)?$/,
    redirectIfAuthenticatedByAccountType: {
      [AccountType.SYS_ADMIN]: '/admin',
      [AccountType.MANAGER]: '/manage',
      [AccountType.EDUCATOR]: '/edu',
      [AccountType.STUDENT]: '/app',
    },
  },

  // --- ONBOARDING ROUTES ---
  {
    matcher: /^\/setup\/org\/?$/,
    requireAuth: true,
    allowedAccountTypes: [AccountType.MANAGER],
  },
  {
    matcher: /^\/setup(\/.*)?$/,
    requireAuth: true,
    allowedAccountTypes: [AccountType.EDUCATOR],
  },

  // --- UI DASHBOARD ROUTES ---
  {
    matcher: /^\/admin(\/.*)?$/,
    requireAuth: true,
    allowedAccountTypes: [AccountType.SYS_ADMIN],
  },
  {
    matcher: /^\/manage(\/.*)?$/,
    requireAuth: true,
    allowedAccountTypes: [AccountType.MANAGER],
  },
  {
    matcher: /^\/edu(\/.*)?$/,
    requireAuth: true,
    allowedAccountTypes: [AccountType.EDUCATOR],
  },
  {
    matcher: /^\/app(\/.*)?$/,
    requireAuth: true,
    allowedAccountTypes: [AccountType.STUDENT],
  },
];
