import { z, registry } from '@/lib/zod';

export const SearchQuerySchema = registry.register(
  'SearchQuery',
  z.object({
    q: z.string().min(1),
    limit: z.number().int().min(1).max(50).default(10),
  }),
);

export type SearchQueryInput = z.infer<typeof SearchQuerySchema>;

export type SearchResult = {
  type: 'flashcard';
  id: string;
  title: string;
  subtitle: string;
  href: string;
  context?: string;
  rank: number;
};

export type SearchResults = SearchResult[];
