import { AccountType } from '@studiq/authz';

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
};

/**
 * UI route rules, evaluated in order by `apps/web/src/proxy.ts`. API routes are
 * absent on purpose: the proxy returns for every `/api/*` request before these
 * rules are consulted, so a handler is protected only by its own `withAuth()`.
 */
export const routeRules: RouteRule[] = [
  // --- AUTH ROUTES ---
  {
    matcher: /^\/(login|register)(\/.*)?$/,
    redirectIfAuthenticatedByAccountType: {
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

  // The post-checkout landing page calls authenticated billing endpoints and
  // cannot function signed out; an expired session must go through /login.
  {
    matcher: /^\/billing(\/.*)?$/,
    requireAuth: true,
  },

  // --- CHECKOUT ROUTES ---
  // The checkout resolves the target organization from the session-scoped
  // `/api/v1/me/orgs`, so it cannot function signed out. The proxy keeps the
  // query string in `?next=`, so a deep link returns to the same checkout URL.
  {
    matcher: /^\/checkout(\/.*)?$/,
    requireAuth: true,
  },

  // --- UI DASHBOARD ROUTES ---
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

/**
 * The API surface that is open by design. Nothing here is enforced at runtime —
 * the proxy skips `/api/*` and `withAuth()` decides per handler — so this is the
 * only record of which unauthenticated handlers were intended.
 *
 * An entry is what exempts a route from
 * `__tests__/unit/proxy/api-auth-inventory.test.ts`, so the entry's width is the
 * guard's blind spot: `exact` names one open handler, `prefixes` names a group
 * in which every handler is open. A group that also holds a gated handler (the
 * `/api/v1/auth` ones) has to be declared handler by handler, or a regression in
 * the gated handler would never be reported. The same test fails when an entry
 * stops matching a real route, so a stale declaration cannot outlive the route
 * it describes.
 */
export const PUBLIC_API = {
  /** One open handler per entry. */
  exact: [
    // The version banner.
    '/api',
    // Stripe cannot send a session; under the `stripe` driver the signature is
    // the credential. The `mock` driver still gates itself with `withAuth`.
    '/api/v1/stripe/webhook',
    // Session bootstrap and recovery — there is no session to require yet.
    // Declared individually on purpose: `profile` and `password/update` in the
    // same group are gated, and a `/api/v1/auth` prefix would exempt them.
    '/api/v1/auth/callback',
    '/api/v1/auth/login',
    '/api/v1/auth/logout',
    '/api/v1/auth/me',
    '/api/v1/auth/password/reset',
    '/api/v1/auth/register',
  ],
  /** Groups in which every handler may run without a session. */
  prefixes: [
    '/api/v1/health',
    // DiceBear avatars, addressed by seed.
    '/api/v1/avatar',
    // Public pricing catalogue (`listPublic` / `getByKey`).
    '/api/v1/subscription-plans',
  ],
} as const;
