import { getTranslations } from 'next-intl/server';
import { ImageResponse } from 'next/og';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OpengraphImage() {
  // Rendered per request so the tagline follows the page's locale; `hero_title`
  // is the claim the hero itself opens with (PRODUCT.md §Voice).
  const t = await getTranslations('LandingPage');
  const tagline = t('hero_title');
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
