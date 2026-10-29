'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { shouldRetryQuery } from '@/lib/query-retry';

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // A 4xx is terminal (a bad filter will not become a 200 by asking again); network
            // and 5xx failures retry. Same policy as the admin app.
            retry: shouldRetryQuery,
            refetchOnWindowFocus: true,
          },
        },
      }),
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
