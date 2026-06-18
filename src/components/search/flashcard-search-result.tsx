'use client';

import { Folder } from 'lucide-react';
import type { SearchResult } from '@/server/models';

interface FlashcardSearchResultProps {
  result: SearchResult;
  activeSubIndex: number;
  offset: number;
  onNavigate: (href: string) => void;
  onHover: (subIndex: number) => void;
}

export function FlashcardSearchResult({
  result,
  activeSubIndex,
  offset,
  onNavigate,
  onHover,
}: FlashcardSearchResultProps) {
  return (
    <div>
      <div className="px-2 py-2 text-sm border-b border-border/50">
        <span className="font-medium truncate block">{result.title}</span>
        <span className="text-xs text-muted-foreground truncate block">
          {result.subtitle}
        </span>
      </div>
      {result.decks.map((deck, di) => (
        <button
          key={deck.id}
          data-search-index={offset + di}
          onClick={() => onNavigate(deck.href)}
          onMouseEnter={() => onHover(di)}
          className={`w-full text-left px-4 py-2 text-sm flex items-center gap-2 transition-colors ${
            di === activeSubIndex
              ? 'bg-accent text-accent-foreground'
              : 'text-foreground hover:bg-muted/50'
          }`}
        >
          <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          {deck.name}
        </button>
      ))}
    </div>
  );
}
