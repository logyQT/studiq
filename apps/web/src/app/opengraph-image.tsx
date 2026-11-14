import { ImageResponse } from 'next/og';
import en from '@/i18n/messages/en.json';
import pl from '@/i18n/messages/pl.json';
import { DEFAULT_LOCALE } from '@/lib/locale';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const MESSAGES = { pl, en };

export default function OpengraphImage() {
  /*
   * The tagline is the page's own `hero_title` (PRODUCT.md §Voice), read from the
   * message catalogue at build time so no copy is repeated here.
   *
   * Not from the request: this image is fetched by social crawlers, which send no
   * `NEXT_LOCALE` cookie. Resolving a locale per request would therefore always
   * fall back to the default one — the same card, drawn again on every unfurl,
   * with `max-age=0` and no `Vary` to sort it in any cache. Reading cookies is
   * also what made the route dynamic; without them it is prerendered once at
   * build and every request gets the same bytes. The default locale's catalogue
   * is what the audience for this image actually needs.
   */
  const tagline = MESSAGES[DEFAULT_LOCALE].LandingPage.hero_title;
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #4338CA 0%, #4F46E5 50%, #2563EB 100%)',
        color: '#ffffff',
      }}
    >
      <div style={{ fontSize: 96, fontWeight: 700, letterSpacing: -2 }}>StudiQ</div>
      <div
        style={{
          fontSize: 32,
          marginTop: 16,
          opacity: 0.9,
          textAlign: 'center',
          padding: '0 80px',
        }}
      >
        {tagline}
      </div>
    </div>,
    { ...size },
  );
}
