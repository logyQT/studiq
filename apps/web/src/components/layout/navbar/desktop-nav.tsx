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
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FOCUS_RING } from '@/components/shared/focus-ring';
import type { NavLink } from '@/components/layout/navbar/types';
import { cn } from '@/lib/utils';

interface DesktopNavProps {
  links: NavLink[];
  isActive: (href: string) => boolean;
}

/** The `gap-1` between link cells, mirrored when counting what fits. */
const LINK_GAP = 4;
/** The overflow trigger: a 44px square plus its `ml-1`. */
const MORE_WIDTH = 48;

/**
 * Number of items that fit before the overflow menu. Measured from the rendered
 * items so the value tracks the actual labels and font, never a hard-coded guess.
 */
function countVisibleItems(list: HTMLElement, nav: HTMLElement, total: number): number {
  const items = Array.from(list.children).filter(
    (el): el is HTMLElement => el instanceof HTMLElement,
  );

  if (items.length === 0) return total;

  const widths = items.map((el) => el.offsetWidth + LINK_GAP);
  const available = nav.clientWidth - MORE_WIDTH;
  let used = 0;
  let count = total;

  for (const [i, width] of widths.entries()) {
    used += width;
    if (used > available) {
      count = Math.max(1, i);
      break;
    }
  }

  return count;
}

export function DesktopNav({ links, isActive }: DesktopNavProps) {
  const t = useTranslations('Navbar');
  const tDash = useTranslations('DashboardLayout');
  const label = (key: string, ns?: string) => (ns === 'DashboardLayout' ? tDash(key) : t(key));
  const listRef = useRef<HTMLUListElement>(null);
  const [visibleCount, setVisibleCount] = useState(links.length);

  useLayoutEffect(() => {
    const list = listRef.current;
    const nav = list?.parentElement;
    if (!list || !nav) return;

    setVisibleCount(countVisibleItems(list, nav, links.length));
  }, [links]);

  useEffect(() => {
    const list = listRef.current;
    const nav = list?.parentElement;
    if (!list || !nav) return undefined;

    const update = () => {
      setVisibleCount(countVisibleItems(list, nav, links.length));
    };

    const ro = new ResizeObserver(update);
    ro.observe(nav);
    return () => ro.disconnect();
  }, [links]);

  const hasOverflow = visibleCount < links.length;
  const visible = hasOverflow ? links.slice(0, visibleCount) : links;
  const overflow = hasOverflow ? links.slice(visibleCount) : [];

  return (
    <nav className="flex h-16 w-full min-w-0 items-center">
      <ul ref={listRef} className="flex h-full min-w-0 items-center gap-1">
        {visible.map(({ labelKey, href, namespace }) => {
          const active = isActive(href);
          return (
            <li key={labelKey} className="relative flex h-full items-center">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
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
                    aria-current={active ? 'page' : undefined}
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
