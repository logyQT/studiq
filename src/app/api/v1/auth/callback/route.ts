/**
 * @swagger
 * /api/v1/auth/callback:
 *   get:
 *     summary: Handle authentication callback (PKCE & OTP)
 *     description: >
 *       Exchanges the PKCE authorization code or OTP token_hash received from
 *       the email link for a secure server-side session, then redirects the user.
 *     tags:
 *       - Auth
 *     parameters:
 *       - in: query
 *         name: code
 *         required: false
 *         schema:
 *           type: string
 *         description: >
 *           The authorization code provided by Supabase in the email link (PKCE flow).
 *       - in: query
 *         name: token_hash
 *         required: false
 *         schema:
 *           type: string
 *         description: >
 *           The token hash provided by Supabase for OTP flows
 *           (e.g., password recovery, magic links).
 *       - in: query
 *         name: type
 *         required: false
 *         schema:
 *           type: string
 *           enum: [signup, invite, magiclink, recovery, email_change, email]
 *         description: The type of the OTP token (required if token_hash is provided).
 *       - in: query
 *         name: next
 *         required: false
 *         schema:
 *           type: string
 *         description: >
 *           The path to redirect the user to after a successful token exchange
 *           (e.g., /dashboard).
 *     responses:
 *       302:
 *         description: >
 *           Redirects the user to the target page on success, or back to login
 *           with an error query parameter if the link is invalid or expired.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { EmailOtpType } from '@supabase/supabase-js';
import { AppErrorCode } from '@/lib/errors';

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

    console.error('Auth Callback Error (TokenHash):', error.message);
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }

    console.error('Auth Callback Error (PKCE):', error.message);
  }

  return NextResponse.redirect(`${origin}/login?error=${AppErrorCode.AUTH_CALLBACK_FAILED}`);
}
