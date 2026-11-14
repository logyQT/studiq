'use client';

import { useTheme } from 'next-themes';
import { useLocale } from 'next-intl';
import { useSyncExternalStore } from 'react';
import { resolveLocale } from '@/lib/locale';

/**
 * A real capture of the product, presented as a paper plate.
 *
 * Three things live here because they are one decision each and every placement
 * needs all of them:
 *
 * - **Locale and theme** are both axes of the asset (`/marketing/{locale}/{theme}/{shot}`).
 *   A Polish page with English demo data, or a dark page with a cream screenshot,
 *   are the same mistake one layer apart.
 * - **Element crops, not windows.** A 1440px app window in a 440px column is
 *   downscaled ~3.3× and its text becomes grey texture. These captures are of the
 *   component itself, at 3×, with their natural aspect ratio.
 * - **A `srcset` of WebP renditions.** `next.config.mjs` sets `images.unoptimized`,
 *   so `next/image` would ship one large PNG and let the browser downscale it. A
 *   plain `img` with explicit sources is the honest version of that.
 *
 * The plate stays `bg-background` in both themes: it is the thing that keeps a
 * capture from looking pasted onto the page.
 */
const SHOTS = {
  'card-front': { width: 2115, height: 1245 },
  'card-rating': { width: 3228, height: 387 },
  'quiz-question': { width: 2307, height: 1452 },
  'quiz-feedback': { width: 2307, height: 1266 },
  'stats-kpis': { width: 3504, height: 462 },
  'stats-chart': { width: 2163, height: 1584 },
  'builder-row': { width: 4293, height: 237 },
  'assignment-list': { width: 2271, height: 795 },
  'seats-table': { width: 4395, height: 819 },
} as const;

export type ShotName = keyof typeof SHOTS;

const subscribeNoop = () => () => {};
/** The server cannot know the visitor's theme; render light until hydration. */
const useMounted = () =>
  useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );

interface ProductShotProps {
  shot: ShotName;
  alt: string;
  sizes: string;
  className?: string;
  /** Only the hero shot: it is the LCP element. */
  preload?: boolean;
  /** The plate can be dropped when the shot already sits inside a framed surface. */
  bare?: boolean;
}

export function ProductShot({
  shot,
  alt,
  sizes,
  className,
  preload = false,
  bare = false,
}: ProductShotProps) {
  const locale = resolveLocale(useLocale());
  const { resolvedTheme } = useTheme();
  const mounted = useMounted();
  const theme = mounted && resolvedTheme === 'dark' ? 'dark' : 'light';
  const { width, height } = SHOTS[shot];
  const base = `/marketing/${locale}/${theme}/${shot}`;

  const img = (
    <img
      src={`${base}.png`}
      srcSet={`${base}-720.webp 720w, ${base}-1440.webp 1440w`}
      sizes={sizes}
      alt={alt}
      width={width}
      height={height}
      loading={preload ? 'eager' : 'lazy'}
      fetchPriority={preload ? 'high' : 'auto'}
      decoding="async"
      className="block h-auto w-full rounded-xs"
    />
  );

  if (bare) return <div className={className}>{img}</div>;

  return (
    <figure className={className}>
      <div className="overflow-hidden rounded-panel border border-border bg-background p-1.5">
        {img}
      </div>
    </figure>
  );
}
