import type { EmailOtpType } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';
import { APP_ERRORS } from '@/lib/errors';
import { log } from '@/lib/logger';
import { createClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
  const FALLBACK_REDIRECT = '/';

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
    const { error } = await supabase.auth.verifyOtp({
      token_hash,
      type,
    });

    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }

    log.auth.error('Auth Callback Error (TokenHash)', { metadata: { message: error.message } });
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }

    log.auth.error('Auth Callback Error (PKCE)', { metadata: { message: error.message } });
  }

  return NextResponse.redirect(`${origin}/login?error=${APP_ERRORS.INTERNAL_SERVER.code}`);
}
