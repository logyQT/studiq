'use client';

import { Badge, Button, Card, Skeleton, UserAvatar } from '@studiq/ui';
import { MessageSquareWarning, SearchX } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ReportsToolbar } from '@/components/question-reports/reports-toolbar';
import { useAuth } from '@/components/providers/AuthProvider';
import { useCursorPagination } from '@/hooks/use-cursor-pagination';
import { useDebounce } from '@/hooks/use-debounce';
import { usePersistedState } from '@/hooks/use-persisted-state';
import { formatDate } from '@/lib/datetime';
import { questionReportKeys } from '@/lib/query-keys';

interface ReportRow {
  id: string;
  status: 'open' | 'resolved';
  updated_at: string;
  isUnread: boolean;
  reported_by: string;
  teacher_id: string;
  question: { id: string; content: string } | null;
  group: { id: string; name: string } | null;
  reporter: { id: string; full_name: string | null; email: string } | null;
  teacher: { id: string; full_name: string | null; email: string } | null;
}

export function ReportsListScreen({ basePath }: { basePath: string }) {
  const t = useTranslations('QuestionReports');
  const locale = useLocale();
  const { user } = useAuth();

  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebounce(searchInput, 300);
  const [status, setStatus] = usePersistedState('question_reports_status', 'all');
  const [sort, setSort] = usePersistedState('question_reports_sort', 'updated_at:desc');
  const [sortBy, sortOrder] = sort.split(':');

  const query = debouncedSearch.trim();
  const filters = {
    q: query || undefined,
    status: status !== 'all' ? status : undefined,
    sortBy,
    sortOrder,
  };

  const {
    items: reports,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    refetch,
  } = useCursorPagination<ReportRow>({
    queryKey: questionReportKeys.list(filters),
    url: '/api/v1/question-reports',
    filters,
    limit: 24,
  });

  const loadMoreRef = useRef<HTMLDivElement>(null);
  const handleObserver = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const [entry] = entries;
      if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
      }
    },
    [hasNextPage, isFetchingNextPage, fetchNextPage],
  );

  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(handleObserver, { rootMargin: '200px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [handleObserver]);

  const hasActiveFilters = query.length > 0 || status !== 'all';

  function clearFilters() {
    setSearchInput('');
    setStatus('all');
  }

  return (
    <div className="space-y-4">
      <ReportsToolbar
        searchInput={searchInput}
        onSearchChange={setSearchInput}
        status={status}
        onStatusChange={setStatus}
        sort={sort}
        onSortChange={(nextSortBy, nextSortOrder) => setSort(`${nextSortBy}:${nextSortOrder}`)}
        t={t}
      />

      {isError ? (
        <Card className="p-12 flex flex-col items-center gap-3 text-center">
          <MessageSquareWarning className="h-8 w-8 text-muted-foreground" />
          <p className="font-medium">{t('load_error')}</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            {t('retry')}
          </Button>
        </Card>
      ) : isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="p-4 flex flex-row items-center gap-3">
              <Skeleton className="h-9 w-9 rounded-full shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            </Card>
          ))}
        </div>
      ) : reports.length === 0 ? (
        <Card className="p-12 flex flex-col items-center gap-3 text-center">
          {hasActiveFilters ? (
            <>
              <SearchX className="h-8 w-8 text-muted-foreground" />
              <p className="font-medium">{t('no_reports_match_filters')}</p>
              <Button variant="outline" size="sm" onClick={clearFilters}>
                {t('clear_filters')}
              </Button>
            </>
          ) : (
            <>
              <MessageSquareWarning className="h-8 w-8 text-muted-foreground" />
              <p className="font-medium">{t('empty_title')}</p>
              <p className="text-sm text-muted-foreground">{t('empty_description')}</p>
            </>
          )}
        </Card>
      ) : (
        <div className="space-y-2">
          {reports.map((report) => {
            const isReporter = report.reported_by === user?.id;
            const counterpart = isReporter ? report.teacher : report.reporter;

            return (
              <Link key={report.id} href={`${basePath}/reports/${report.id}`}>
                <Card className="p-4 flex flex-row items-center gap-3 hover:bg-accent/50 transition-colors">
                  <UserAvatar name={counterpart?.full_name} email={counterpart?.email} size={36} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-medium text-sm truncate">
                        {counterpart?.full_name || counterpart?.email}
                      </span>
                      {report.isUnread && (
                        <>
                          <span aria-hidden className="h-2 w-2 rounded-full bg-red-500 shrink-0" />
                          <span className="sr-only">{t('unread')}</span>
                        </>
                      )}
                      <Badge
                        variant={report.status === 'open' ? 'secondary' : 'outline'}
                        className="ml-auto shrink-0"
                      >
                        {t(report.status === 'open' ? 'status_open' : 'status_resolved')}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground truncate">
                      {report.question?.content ??
                        (report.group ? t('report_target_group', { name: report.group.name }) : '')}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    <time dateTime={report.updated_at}>
                      {formatDate(report.updated_at, locale)}
                    </time>
                    <span className="sr-only"> · {t('last_activity')}</span>
                  </span>
                </Card>
              </Link>
            );
          })}

          <div ref={loadMoreRef} aria-hidden className="h-px" />
          {isFetchingNextPage && (
            <div className="space-y-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <Card key={i} className="p-4 flex flex-row items-center gap-3">
                  <Skeleton className="h-9 w-9 rounded-full shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-3 w-2/3" />
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
