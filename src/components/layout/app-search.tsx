'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { BookOpen } from 'lucide-react';
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command';
import { useDebounce } from '@/hooks/use-debounce';
import { useApiQuery } from '@/hooks/use-api';
import type { SearchResult } from '@/server/models';

export function AppSearch() {
  const t = useTranslations('DashboardLayout');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const debouncedQuery = useDebounce(query, 300);

  const { data: results, isLoading } = useApiQuery<SearchResult[]>({
    queryKey: ['search', debouncedQuery],
    url: `/api/v1/search?q=${encodeURIComponent(debouncedQuery)}&limit=10`,
    enabled: debouncedQuery.length >= 2,
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === '/' && !open) {
        const tag = (document.activeElement as HTMLElement)?.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          e.preventDefault();
          setOpen(true);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  function handleSelect(href: string) {
    setOpen(false);
    setQuery('');
    router.push(href);
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder={t('search_placeholder')}
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {isLoading && (
          <CommandEmpty>{t('search_loading')}</CommandEmpty>
        )}
        {!isLoading && (!results || results.length === 0) && debouncedQuery.length >= 2 && (
          <CommandEmpty>{t('search_no_results')}</CommandEmpty>
        )}
        {results?.map((result) => (
          <CommandGroup key={result.id} heading={result.title}>
            {result.decks?.map((deck) => (
              <CommandItem
                key={deck.id}
                onSelect={() => handleSelect(deck.href)}
              >
                <BookOpen className="h-4 w-4" />
                <span>{deck.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
