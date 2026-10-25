/** A code minted by `invitations.token`'s default (`encode(gen_random_bytes(16),'hex')`). */
const INVITE_CODE = /^[0-9a-f]{32}$/i;

/** `?token=…` / `&token=…`, including a leading bare `token=…` fragment. */
const TOKEN_PARAM = /(?:^|[?&])token=([^&#\s]+)/i;

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * `Kopiuj link` copies `${SITE_URL}/join?token=<32-hex>`, while the join screens
 * ask for a „kod”. Accept both: return the bare code, or `null` when the value is
 * a link without a token (so a URL is never sent to PostgREST as a token).
 *
 * Any other value is returned trimmed and unchanged — the database decides,
 * exactly as before, so legacy/opaque tokens keep working.
 */
export function normalizeInviteToken(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (INVITE_CODE.test(trimmed)) return trimmed.toLowerCase();

  const match = TOKEN_PARAM.exec(trimmed);
  if (match) {
    const token = safeDecode(match[1]).trim();
    if (!token) return null;
    // Only the generated 32-hex form is case-folded; an opaque legacy token is
    // matched byte-for-byte by the database.
    return INVITE_CODE.test(token) ? token.toLowerCase() : token;
  }

  // A URL/path without `?token=…` is not an invitation handle.
  if (trimmed.includes('://') || trimmed.startsWith('/')) return null;
  return trimmed;
}
