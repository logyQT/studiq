'use client';

import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@studiq/ui';
import { useTranslations } from 'next-intl';
import { FOCUS_RING } from '@/components/shared/focus-ring';
import { availableSeats } from '@/lib/seats';
import { cn } from '@/lib/utils';

export interface SeatPool {
  id: string;
  /**
   * The plan's display name, resolved by the caller: the catalogue is a query,
   * and this table is the same in the manager's screen and on a page that has no
   * catalogue to read.
   */
  planLabel: string;
  total: number;
  assigned: number;
}

/**
 * The organization's seat pools: what was bought, what is in use, what is left.
 *
 * The "low" flag fires only once seats have actually been assigned — a fresh
 * single-seat pool (1/0/1) is not low, it is untouched — so the threshold lives
 * here rather than at every caller.
 *
 * `dense` is for a page that gives the table a phone-width column rather than a
 * dashboard's full content area: the manager's screen keeps `text-sm`, and a
 * marketing band at 320 px fits its four columns in one gutter instead of
 * hiding "Dostępne" behind a horizontal scroll.
 */
export function SeatPoolsTable({
  pools,
  dense = false,
  labelled = false,
}: {
  pools: readonly SeatPool[];
  dense?: boolean;
  /**
   * Names the table for a caller that renders it without a title above it.
   * The dashboard's card already names it, and a second name there would be the
   * card title read twice; it also has no overflow to make focusable.
   */
  labelled?: boolean;
}) {
  const t = useTranslations('ManageSeatsPage');
  const head = cn(dense && 'px-1 text-xs');
  const cell = cn(dense && 'px-1 text-xs');

  return (
    <Table
      containerClassName={labelled ? FOCUS_RING : undefined}
      containerProps={labelled ? { tabIndex: 0, 'aria-label': t('pools_title') } : undefined}
    >
      {labelled ? <caption className="sr-only">{t('pools_title')}</caption> : null}
      <TableHeader>
        <TableRow>
          <TableHead scope="col" className={head}>
            {t('plan_column')}
          </TableHead>
          <TableHead scope="col" className={cn('text-right', head)}>
            {t('purchased_column')}
          </TableHead>
          <TableHead scope="col" className={cn('text-right', head)}>
            {t('assigned_column')}
          </TableHead>
          <TableHead scope="col" className={cn('text-right', head)}>
            {t('available_column')}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {pools.map((pool) => {
          const available = availableSeats(pool.total, pool.assigned);
          const nearFull =
            pool.total > 0 &&
            pool.assigned > 0 &&
            available <= Math.max(1, Math.floor(pool.total * 0.2));

          return (
            <TableRow key={pool.id}>
              <TableCell className={cn('font-medium', cell)}>{pool.planLabel}</TableCell>
              <TableCell className={cn('text-right', cell)}>{pool.total}</TableCell>
              <TableCell className={cn('text-right', cell)}>{pool.assigned}</TableCell>
              <TableCell className={cn('text-right whitespace-nowrap', cell)}>
                <span className={nearFull ? 'text-destructive font-medium' : ''}>{available}</span>
                {nearFull && (
                  <Badge variant="destructive" className="ml-2">
                    {t('low')}
                  </Badge>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
