'use client';

import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useMemo } from 'react';
import { useBreadcrumbContext } from '@/components/providers/BreadcrumbProvider';
import { type Crumb, buildBreadcrumbs } from '@/lib/breadcrumbs';

/**
 * Trail for the current dashboard route. Uses a root translator (no namespace)
 * so `PATH_LABELS` can hold fully-qualified keys — one hook call, no loops.
 */
export function useBreadcrumbs(): Crumb[] {
  const pathname = usePathname();
  const { names } = useBreadcrumbContext();
  const t = useTranslations();

  const translate = useCallback((key: string) => (t.has(key) ? t(key) : ''), [t]);

  return useMemo(
    () => buildBreadcrumbs({ pathname, names, t: translate }),
    [pathname, names, translate],
  );
}

/**
 * Publish the human label for a dynamic segment (deck name, assignment title…)
 * so the trail never shows the raw UUID. Releases the label on unmount or when
 * the segment/label changes (deck A -> deck B on the same screen).
 */
export function useBreadcrumbLabel(segment?: string, label?: string): void {
  const { publish, release } = useBreadcrumbContext();
  const owner = useId();
  const name = label?.trim() || undefined;

  useEffect(() => {
    if (!segment || !name) return;
    publish(segment, name, owner);
    return () => release(segment, owner);
  }, [segment, name, owner, publish, release]);
}
