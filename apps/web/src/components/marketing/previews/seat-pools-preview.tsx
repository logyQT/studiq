import { SeatPoolsTable } from '@/components/manage/seat-pools-table';
import { SEAT_POOL_FIXTURES } from '@/components/marketing/previews/seat-pools-fixtures';

/**
 * The manager's seat pools, as the organization area shows them.
 *
 * The table is already presentational — it takes its rows and resolves nothing —
 * so this file is only the fixture. It is the surface for "seats, roles and
 * reports in one place": what the institution bought, what is in use, and the
 * pool that is about to run out.
 */
export function SeatPoolsPreview() {
  return <SeatPoolsTable pools={SEAT_POOL_FIXTURES} dense />;
}
