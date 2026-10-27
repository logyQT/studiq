'use client';

import { useTranslations } from 'next-intl';
import { ApiError } from '@/lib/api';

/**
 * One error state for every admin list/detail query. A 401/403 means the admin
 * API rejected the request (e.g. unsigned browser call in PEM mode) — show that
 * explicitly instead of an endless loading state or a misleading empty table.
 */
export function QueryError({ error }: { error: unknown }) {
  const t = useTranslations('Common');
  const status = error instanceof ApiError ? error.status : undefined;

  if (status === 401 || status === 403) {
    return (
      <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {t('unauthorized')}
      </p>
    );
  }

  const code = error instanceof ApiError ? error.code : t('error');
  return (
    <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {t('load_failed', { code })}
    </p>
  );
}
