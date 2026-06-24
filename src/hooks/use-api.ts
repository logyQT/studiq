import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { QueryKey, UseQueryResult, UseMutationResult } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';

export function useApiQuery<T>(opts: {
  queryKey: QueryKey;
  url: string;
  enabled?: boolean;
  staleTime?: number;
  gcTime?: number;
}): UseQueryResult<T> {
  return useQuery({
    queryKey: opts.queryKey,
    queryFn: () => apiGet<T>(opts.url),
    staleTime: opts.staleTime ?? Infinity,
    gcTime: opts.gcTime ?? 30 * 60 * 1000,
    enabled: opts.enabled,
  });
}

export function useApiMutation<TData, TVars, TContext = unknown>(opts: {
  mutationFn: (vars: TVars) => Promise<TData>;
  invalidateKeys?: QueryKey[];
  onMutate?: (vars: TVars) => TContext | Promise<TContext>;
  onError?: (error: Error, vars: TVars, context: TContext | undefined) => void;
  onSettled?: () => void;
}): UseMutationResult<TData, Error, TVars, TContext> {
  const queryClient = useQueryClient();

  return useMutation<TData, Error, TVars, TContext>({
    mutationFn: opts.mutationFn,
    onMutate: opts.onMutate,
    onError: opts.onError,
    onSettled: () => {
      if (opts.invalidateKeys?.length) {
        for (const key of opts.invalidateKeys) {
          queryClient.invalidateQueries({ queryKey: key });
        }
      }
      opts.onSettled?.();
    },
  });
}
