'use client';

import { type QueryKey, useInfiniteQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { apiGet } from '@/lib/api';

interface UseCursorPaginationOptions {
  queryKey: QueryKey;
  url: string;
  filters?: Record<string, string | undefined>;
  limit?: number;
  enabled?: boolean;
  staleTime?: number;
}

interface UseCursorPaginationResult<T> {
  items: T[];
  /** Total matching items (ignoring pagination) from the first page, when the API provides it. */
  total: number | undefined;
  fetchNextPage: () => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

export function useCursorPagination<T>({
  queryKey,
  url,
  filters,
  limit = 50,
  enabled = true,
  staleTime = Infinity,
}: UseCursorPaginationOptions): UseCursorPaginationResult<T> {
  const params: Record<string, string> = {};
  for (const [key, val] of Object.entries(filters ?? {})) {
    if (val !== undefined) params[key] = val;
  }
  params.limit = String(limit);
  const queryString = new URLSearchParams(params).toString();

  const result = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) =>
      apiGet<{ items: T[]; nextCursor: string | null; hasMore: boolean; total?: number }>(
        `${url}?${queryString}${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: '',
    enabled,
    staleTime,
  });

  const items = useMemo(
    () => result.data?.pages.flatMap((page) => page.items) ?? [],
    [result.data],
  );

  return {
    items,
    total: result.data?.pages[0]?.total,
    fetchNextPage: result.fetchNextPage,
    hasNextPage: result.hasNextPage,
    isFetchingNextPage: result.isFetchingNextPage,
    isLoading: result.isLoading,
    isError: result.isError,
    refetch: result.refetch,
  };
}
