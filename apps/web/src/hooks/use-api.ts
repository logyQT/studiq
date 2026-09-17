import type { QueryKey, UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';

export interface OptimisticUpdate<TData, TVars> {
  queryKey: QueryKey;
  updater: (oldData: TData | undefined, vars: TVars) => TData | undefined;
}

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
  optimisticUpdate?: OptimisticUpdate<TData, TVars>;
  onMutate?: (vars: TVars) => TContext | Promise<TContext>;
  onError?: (error: Error, vars: TVars, context: TContext | undefined) => void;
  onSettled?: () => void;
}): UseMutationResult<TData, Error, TVars, TContext> {
  const queryClient = useQueryClient();
  let snapshot: unknown;

  return useMutation<TData, Error, TVars, TContext>({
    mutationFn: opts.mutationFn,
    onMutate: async (vars) => {
      snapshot = undefined;
      if (opts.optimisticUpdate) {
        const { queryKey, updater } = opts.optimisticUpdate;
        await queryClient.cancelQueries({ queryKey });
        snapshot = queryClient.getQueryData(queryKey);
        queryClient.setQueryData(queryKey, updater(snapshot as TData | undefined, vars));
      }
      return opts.onMutate?.(vars) as TContext;
    },
    onError: (error, vars, context) => {
      if (opts.optimisticUpdate && snapshot !== undefined) {
        queryClient.setQueryData(opts.optimisticUpdate.queryKey, snapshot);
        snapshot = undefined;
      }
      opts.onError?.(error, vars, context);
    },
    onSettled: () => {
      snapshot = undefined;
      if (opts.invalidateKeys?.length) {
        for (const key of opts.invalidateKeys) {
          queryClient.invalidateQueries({ queryKey: key });
        }
      }
      opts.onSettled?.();
    },
  });
}
