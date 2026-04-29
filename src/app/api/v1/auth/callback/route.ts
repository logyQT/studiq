/**
 * @swagger
 * /api/v1/auth/callback:
 *   get:
 *     summary: Handle authentication callback (PKCE)
 *     description: Exchanges the PKCE authorization code received from the email link for a secure server-side session, then redirects the user.
 *     tags:
 *       - Auth
 *     parameters:
 *       - in: query
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *         description: The authorization code provided by Supabase in the email link.
 *       - in: query
 *         name: next
 *         required: false
 *         schema:
 *           type: string
 *         description: The path to redirect the user to after a successful token exchange (e.g., /update-password).
 *     responses:
 *       302:
 *         description: Redirects the user to the update password form on success, or back to login with an error query parameter if the link is invalid or expired.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { EmailOtpType } from '@supabase/supabase-js';

export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl;

  const token_hash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;

  const code = searchParams.get('code');

  const next = searchParams.get('next') ?? '/dashboard';

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

  return NextResponse.redirect(`${origin}/login?error=ERROR_AUTH_CALLBACK_FAILED`);
}
