'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Search, Loader2 } from 'lucide-react';
import { useDebounce } from '@/hooks/use-debounce';
import { useApiQuery } from '@/hooks/use-api';
import { FlashcardSearchResult } from '@/components/search/flashcard-search-result';
import type { SearchResult } from '@/server/models';

export function AppSearch() {
  const t = useTranslations('DashboardLayout');
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [containerRect, setContainerRect] = useState<DOMRect | null>(null);

  const debouncedQuery = useDebounce(query, 300);

  const { data: results, isLoading } = useApiQuery<SearchResult[]>({
    queryKey: ['search', debouncedQuery],
    url: `/api/v1/search?q=${encodeURIComponent(debouncedQuery)}&limit=10`,
    enabled: debouncedQuery.length >= 2,
  });

  const showDropdown = isFocused && debouncedQuery.length >= 2;

  const flatItems = useMemo(() => {
    if (!results) return [];
    return results.flatMap((r) => {
      if (r.type === 'flashcard') return r.decks.map((d) => ({ href: d.href }));
      return [];
    });
  }, [results]);

  const itemOffsets = useMemo(() => {
    if (!results) return [];
    let offset = 0;
    return results.map((r) => {
      const o = offset;
      offset += r.type === 'flashcard' ? r.decks.length : 0;
      return o;
    });
  }, [results]);

  useEffect(() => {
    if (!showDropdown) return;
    const updateRect = () => {
      if (containerRef.current) {
        setContainerRect(containerRef.current.getBoundingClientRect());
      }
    };
    updateRect();
    window.addEventListener('scroll', updateRect, true);
    window.addEventListener('resize', updateRect);
    return () => {
      window.removeEventListener('scroll', updateRect, true);
      window.removeEventListener('resize', updateRect);
    };
  }, [showDropdown]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === '/' && document.activeElement !== inputRef.current) {
        const tag = (document.activeElement as HTMLElement)?.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          e.preventDefault();
          inputRef.current?.focus();
        }
      }
      if (e.key === 'Escape') {
        inputRef.current?.blur();
        setIsFocused(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleNavigate = useCallback(
    (href: string) => {
      setIsFocused(false);
      setQuery('');
      router.push(href);
    },
    [router],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!flatItems.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < flatItems.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : flatItems.length - 1));
    } else if (e.key === 'Enter' && selectedIndex >= 0) {
      e.preventDefault();
      handleNavigate(flatItems[selectedIndex].href);
    }
  };

  useEffect(() => {
    if (selectedIndex < 0) return;
    const el = dropdownRef.current?.querySelector(`[data-search-index="${selectedIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsFocused(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="w-full max-w-lg">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelectedIndex(-1);
          }}
          onFocus={() => setIsFocused(true)}
          onKeyDown={handleKeyDown}
          placeholder={t('search_placeholder')}
          className="flex h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50"
          aria-keyshortcuts="Ctrl+K /"
          aria-label={t('search_shortcut')}
        />
      </div>

      {showDropdown && containerRect && createPortal(
        <div
          ref={dropdownRef}
          style={{
            position: 'fixed',
            zIndex: 50,
            top: `${containerRect.bottom + 4}px`,
            left: `${containerRect.left}px`,
            width: `${containerRect.width}px`,
          }}
          className="rounded-md border bg-popover text-popover-foreground shadow-md"
        >
          <div className="max-h-[300px] overflow-y-auto p-1">
            {isLoading && (
              <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {t('search_loading')}
              </div>
            )}

            {!isLoading && (!results || results.length === 0) && (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {t('search_no_results')}
              </div>
            )}

            {!isLoading && results && results.length > 0 && (
              <div className="space-y-0.5">
                {results.map((result, ri) => {
                  const offset = itemOffsets[ri];
                  const activeSub = selectedIndex >= offset ? selectedIndex - offset : -1;

                  switch (result.type) {
                    case 'flashcard':
                      return (
                        <FlashcardSearchResult
                          key={result.id}
                          result={result}
                          activeSubIndex={activeSub}
                          offset={offset}
                          onNavigate={handleNavigate}
                          onHover={(subIdx) => setSelectedIndex(offset + subIdx)}
                        />
                      );
                    default:
                      return null;
                  }
                })}
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
