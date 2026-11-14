'use client';

import Image from 'next/image';
import { useLocale } from 'next-intl';
import { resolveLocale } from '@/lib/locale';

/**
 * A real capture of the product, presented as a paper plate.
 *
 * Both placements used to inline this markup, which is why the duplication gate
 * flagged them: the frame, the locale resolution and the per-shot dimensions are
 * one decision each, so they live here rather than in every section that wants a
 * screenshot.
 *
 * The plate is `bg-background` in both themes. Product captures are light-mode,
 * and a light UI on a dark page reads as pasted on, while a paper plate under it
 * reads as deliberate (DESIGN.md § Product imagery).
 *
 * Dimensions are the detail crops, not the full windows: a 1440px app window in a
 * 440px column is downscaled ~3.3x and every label in it turns to grey texture.
 */
const SHOTS = {
  'quiz-taking': { width: 1640, height: 1040, aspect: 'aspect-[16/10]' },
  'student-stats': { width: 1600, height: 1200, aspect: 'aspect-[4/3]' },
} as const;

export type ShotName = keyof typeof SHOTS;

interface ProductShotProps {
  shot: ShotName;
  alt: string;
  sizes: string;
  className?: string;
  /** Only the hero shot: it is the LCP element. */
  preload?: boolean;
}

export function ProductShot({ shot, alt, sizes, className, preload = false }: ProductShotProps) {
  const locale = resolveLocale(useLocale());
  const { width, height, aspect } = SHOTS[shot];

  return (
    <figure className={className}>
      <div className="rounded-panel border border-border bg-background p-1.5">
        <Image
          src={`/marketing/${locale}/${shot}-detail.png`}
          alt={alt}
          width={width}
          height={height}
          sizes={sizes}
          preload={preload}
          className={`block w-full rounded-xs object-cover object-top ${aspect}`}
        />
      </div>
    </figure>
  );
}
