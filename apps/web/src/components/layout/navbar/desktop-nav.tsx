'use client';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@studiq/ui';
import { MoreHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FOCUS_RING } from '@/components/shared/focus-ring';
import type { NavLink } from '@/components/layout/navbar/types';
import { cn } from '@/lib/utils';

interface DesktopNavProps {
  links: NavLink[];
  isActive: (href: string) => boolean;
  isCurrent: (href: string) => boolean;
}

/** The `gap-1` between link cells, mirrored when counting what fits. */
const LINK_GAP = 4;
/** The overflow trigger: a 44px square plus its `ml-1`. */
const MORE_WIDTH = 48;

/**
 * How many packed `widths` fit in `budget`, where each width already carries the
 * gap that follows its item.
 */
function fitCount(widths: readonly number[], budget: number): number {
  let used = 0;
  let count = 0;
  for (const width of widths) {
    if (used + width > budget) break;
    used += width;
    count += 1;
  }
  return count;
}

export function DesktopNav({ links, isActive, isCurrent }: DesktopNavProps) {
  const t = useTranslations('Navbar');
  const tDash = useTranslations('DashboardLayout');
  const label = (key: string, ns?: string) => (ns === 'DashboardLayout' ? tDash(key) : t(key));
  const listRef = useRef<HTMLUListElement>(null);
  const [visibleCount, setVisibleCount] = useState(links.length);
  /** Width per href, taken while that link is rendered. See `fit` below. */
  const widths = useRef(new Map<string, number>());

  /*
   * The row renders only the links that fit, so a hidden link's width is gone from
   * the DOM. Counting from the rendered children therefore measured a partial row:
   * the survivors' widths said the whole set fit again, the row re-grew, overflowed,
   * shrank — the oscillation and clipping this replaced. Widths are cached per href
   * instead, so they survive hiding and the count is a function of the row's width
   * alone. The cache is filled on the first pass, when every link is still rendered.
   */
  const fit = useCallback(() => {
    const list = listRef.current;
    const nav = list?.parentElement;
    // Below `lg` the row is `display: none`, where every measurement reads 0.
    if (!list || !nav?.clientWidth) return;

    for (const item of Array.from(list.children)) {
      if (!(item instanceof HTMLElement)) continue;
      const href = item.dataset.navHref;
      if (href) widths.current.set(href, item.offsetWidth + LINK_GAP);
    }

    const ordered: number[] = [];
    for (const { href } of links) {
      const width = widths.current.get(href);
      if (width === undefined) {
        // A link this row has never rendered, e.g. a sign-in that added the
        // dashboard set: put the whole row up once so it can be measured.
        setVisibleCount(links.length);
        return;
      }
      ordered.push(width);
    }

    const all = links.length;
    const packed = fitCount(ordered, nav.clientWidth);
    setVisibleCount(
      packed === all
        ? all
        : // The overflow trigger takes its square out of the same row, and one
          // link stays visible so the nav never collapses to a bare ellipsis.
          Math.max(1, fitCount(ordered, nav.clientWidth - MORE_WIDTH)),
    );
  }, [links]);

  useLayoutEffect(fit, [fit, visibleCount]);

  useEffect(() => {
    const nav = listRef.current?.parentElement;
    if (!nav) return undefined;

    const ro = new ResizeObserver(fit);
    ro.observe(nav);
    return () => ro.disconnect();
  }, [fit]);

  const hasOverflow = visibleCount < links.length;
  const visible = hasOverflow ? links.slice(0, visibleCount) : links;
  const overflow = hasOverflow ? links.slice(visibleCount) : [];

  return (
    <nav className="flex h-16 w-full min-w-0 items-center">
      <ul ref={listRef} className="flex h-full min-w-0 items-center gap-1">
        {visible.map(({ labelKey, href, namespace }) => {
          const active = isActive(href);
          return (
            <li key={labelKey} data-nav-href={href} className="relative flex h-full items-center">
              <Link
                href={href}
                aria-current={isCurrent(href) ? 'page' : undefined}
                className={cn(
                  // 44px of hit area around 20px of text, centred in the band.
                  'flex h-11 items-center px-3 text-sm font-medium transition-colors',
                  active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                  FOCUS_RING,
                )}
              >
                {label(labelKey, namespace)}
              </Link>
              {/* Hangs off the full-height cell, not the link: `-bottom-px` covers
                  the header's hairline instead of stacking a second line under it. */}
              {active && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-x-3 -bottom-px h-0.5 bg-primary"
                />
              )}
            </li>
          );
        })}
      </ul>

      {hasOverflow && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-more="true"
              aria-label={t('mobile_menu')}
              className={cn(
                'ml-1 inline-flex size-11 shrink-0 items-center justify-center rounded-control text-muted-foreground transition-colors hover:text-foreground',
                FOCUS_RING,
              )}
            >
              <MoreHorizontal aria-hidden className="size-5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-40">
            {overflow.map(({ labelKey, href, namespace }) => {
              const active = isActive(href);
              return (
                <DropdownMenuItem key={labelKey} asChild>
                  <Link
                    href={href}
                    aria-current={isCurrent(href) ? 'page' : undefined}
                    className={cn('flex items-center gap-2', active && 'font-semibold')}
                  >
                    {label(labelKey, namespace)}
                  </Link>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </nav>
  );
}
