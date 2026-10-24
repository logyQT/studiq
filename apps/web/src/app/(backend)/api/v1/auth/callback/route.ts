import { APP_ERRORS } from '@studiq/server/lib/errors';
import { createClient } from '@studiq/server/lib/supabase/server';
import { authService } from '@studiq/server/services/auth.service';
import type { EmailOtpType, User } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';

const FALLBACK_REDIRECT = '/';

const COOKIE_OPTIONS = { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' as const };

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
    response.cookies.set('active_org_id', claimed.orgId, COOKIE_OPTIONS);
  }

  return response;
}

export async function GET(req: NextRequest) {
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
  } else if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return finish(data.user, origin, next);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=${APP_ERRORS.INTERNAL_SERVER.code}`);
}
