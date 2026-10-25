import { APP_ERRORS } from '@studiq/server/lib/errors';
import { setActiveOrgCookie } from '@studiq/server/lib/active-org-cookie';
import { warn } from '@studiq/server/lib/log';
import { createClient } from '@studiq/server/lib/supabase/server';
import { withPublicTracing } from '@studiq/server/lib/with-public-tracing';
import { authService } from '@studiq/server/services/auth.service';
import type { EmailOtpType, User } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';

const FALLBACK_REDIRECT = '/';

/**
 * The e-mail address is proven at this point, so this is the only safe moment to
 * consume an invitation carried through sign-up (#311). Acceptance is
 * best-effort: `claimInvitation` never throws, so a dead invitation cannot block
 * activation or login. On success the new membership is made the active org, so
 * the first authenticated render already shows the organization.
 */
async function finish(user: User | null, origin: string, next: string) {
  const claimed = user ? await authService.claimInvitation(user) : null;

  const response = NextResponse.redirect(`${origin}${next}`);

  if (claimed) {
    setActiveOrgCookie(response, claimed.orgId);
  }

  return response;
}

/**
 * Activation failures end in a 3xx redirect, so the shared 4xx/5xx logger never
 * fires. Log the Supabase error code/status explicitly — never the token or the
 * e-mail — so failed activations are searchable in Loki (#301).
 */
function warnVerificationFailed(error: { code?: string; status?: number } | null) {
  warn('Auth callback verification failed', {
    'error.code': error?.code ?? 'UNKNOWN',
    ...(error?.status !== undefined ? { 'error.status': error.status } : {}),
  });
}

export async function GET(req: NextRequest) {
  return withPublicTracing(req, async () => {
    const { searchParams, origin } = req.nextUrl;

    const token_hash = searchParams.get('token_hash');
    const type = searchParams.get('type') as EmailOtpType | null;

    const code = searchParams.get('code');

    let next = searchParams.get('next') ?? FALLBACK_REDIRECT;

    if (URL.canParse(next, origin)) {
      const parsedUrl = new URL(next, origin);
      next =
        parsedUrl.origin === origin
          ? parsedUrl.pathname + parsedUrl.search + parsedUrl.hash
          : FALLBACK_REDIRECT;
    } else {
      next = FALLBACK_REDIRECT;
    }

    const supabase = await createClient();

    if (token_hash && type) {
      const { data, error } = await supabase.auth.verifyOtp({
        token_hash,
        type,
      });

      if (!error) {
        return finish(data.user, origin, next);
      }

      warnVerificationFailed(error);
    } else if (code) {
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);

      if (!error) {
        return finish(data.user, origin, next);
      }

      warnVerificationFailed(error);
    } else {
      warn('Auth callback called without token_hash or code');
    }

    return NextResponse.redirect(`${origin}/login?error=${APP_ERRORS.INTERNAL_SERVER.code}`);
  });
}
