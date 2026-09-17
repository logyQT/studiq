'use client';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@studiq/ui';
import { ChevronDown, MoreHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { NavLink } from '@/components/layout/navbar/types';
import { cn } from '@/lib/utils';

interface DesktopNavProps {
  links: NavLink[];
  isActive: (href: string) => boolean;
}

export function DesktopNav({ links, isActive }: DesktopNavProps) {
  const t = useTranslations('Navbar');
  const navRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(links.length);

  useLayoutEffect(() => {
    const nav = navRef.current;
    const parent = nav?.parentElement;
    if (!nav || !parent || links.length === 0) return;

    const children = Array.from(nav.children).filter(
      (el) => !(el as HTMLElement).dataset.more,
    ) as HTMLElement[];

    if (children.length === 0) return;

    const widths = children.map((el) => el.offsetWidth + 4);
    const moreWidth = 72;
    const available = parent.clientWidth - moreWidth;
    let used = 0;
    let count = links.length;

    for (let i = 0; i < widths.length; i++) {
      used += widths[i];
      if (used > available) {
        count = Math.max(1, i);
        break;
      }
    }

    setVisibleCount(count);
  }, [links]);

  useEffect(() => {
    const nav = navRef.current;
    const parent = nav?.parentElement;
    if (!nav || !parent || links.length === 0) return;

    const update = () => {
      const children = Array.from(nav.children).filter(
        (el) => !(el as HTMLElement).dataset.more,
      ) as HTMLElement[];

      if (children.length === 0) return;

      const widths = children.map((el) => el.offsetWidth + 4);
      const moreWidth = 72;
      const available = parent.clientWidth - moreWidth;
      let used = 0;
      let count = links.length;

      for (let i = 0; i < widths.length; i++) {
        used += widths[i];
        if (used > available) {
          count = Math.max(1, i);
          break;
        }
      }

      setVisibleCount(count);
    };

    const ro = new ResizeObserver(update);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [links]);

  const hasOverflow = visibleCount < links.length;
  const visible = hasOverflow ? links.slice(0, visibleCount) : links;
  const overflow = hasOverflow ? links.slice(visibleCount) : [];

  return (
    <nav ref={navRef} className="flex items-center gap-1">
      {visible.map(({ labelKey, href, icon: Icon }) => (
        <Link
          key={labelKey}
          href={href}
          className={cn(
            'flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition shrink-0',
            isActive(href)
              ? 'bg-accent text-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent',
          )}
        >
          <Icon className="h-4 w-4" />
          {t(labelKey)}
        </Link>
      ))}

      {hasOverflow && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-more="true"
              className="flex items-center gap-1 px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition shrink-0"
            >
              <MoreHorizontal className="h-4 w-4" />
              <ChevronDown className="h-3 w-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-40">
            {overflow.map(({ labelKey, href, icon: Icon }) => (
              <DropdownMenuItem key={labelKey} asChild>
                <Link
                  href={href}
                  className={cn('flex items-center gap-2', isActive(href) && 'font-medium')}
                >
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  {t(labelKey)}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </nav>
  );
}
