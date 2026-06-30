'use client';

import { CheckSquare, Eye, MoreVertical, Pencil, Trash2 } from 'lucide-react';
import type { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getGradientHex } from '@/lib/color-utils';
import type { Topic } from '@/types/flashcards';

interface TopicCardProps {
  topic: Topic;
  isSelected: boolean;
  isSelecting: boolean;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleSelect: () => void;
  t: ReturnType<typeof useTranslations>;
}

export function TopicCard({
  topic,
  isSelected,
  isSelecting,
  onView,
  onEdit,
  onDelete,
  onToggleSelect,
  t,
}: TopicCardProps) {
  const gradientHex = getGradientHex(topic.name);

  return (
    <Card
      className={`group cursor-pointer flex flex-col h-full overflow-hidden transition-all duration-300 ease-out sm:hover:-translate-y-1 sm:hover:shadow-lg sm:hover:border-primary/40 ${
        isSelected ? 'ring-2 ring-primary border-transparent' : ''
      } max-sm:py-0 min-w-0 p-0`}
      onClick={() => {
        if (isSelecting) {
          onToggleSelect();
        } else {
          onView();
        }
      }}
    >
      {/* Mobile: Compact row */}
      <div className="relative flex items-center justify-between gap-3 p-3.5 sm:hidden max-w-[calc(100vw-2rem)]">
        {isSelecting && (
          <div className="absolute top-4 right-4 z-10">
            <Checkbox
              checked={isSelected}
              onCheckedChange={onToggleSelect}
              className="h-4 w-4 bg-background/90 border-muted-foreground/40 shadow-sm"
            />
          </div>
        )}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="relative shrink-0">
            <div className="h-10 w-10 rounded-xl bg-muted/50 border border-border/40 shadow-sm flex items-center justify-center">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
                <defs>
                  <linearGradient id={`mob-tag-grad-${topic.id}`} x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor={gradientHex.from} />
                    <stop offset="100%" stopColor={gradientHex.to} />
                  </linearGradient>
                </defs>
                <path
                  d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2z"
                  stroke={`url(#mob-tag-grad-${topic.id})`}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle cx="7" cy="7" r="1.5" fill={`url(#mob-tag-grad-${topic.id})`} />
              </svg>
            </div>
          </div>
          <div className="min-w-0 flex-1 space-y-0.5">
            <h3 className="text-[15px] font-bold tracking-tight text-foreground truncate flex items-center gap-1.5">
              {topic.name}
            </h3>
            <div className="flex items-center gap-1.5 text-muted-foreground/80">
              <Badge
                variant="secondary"
                className="bg-secondary/40 text-secondary-foreground hover:bg-secondary/40 border-transparent text-[11px] font-medium leading-none px-1.5 py-0.5 shadow-none"
              >
                {t('flashcards_count', { count: topic.flashcard_count })}
              </Badge>
            </div>
          </div>
        </div>

        {!isSelecting && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground/80 hover:text-foreground shrink-0 -mr-1"
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  // onSelect();
                }}
              >
                <CheckSquare className="mr-2 h-4 w-4" /> {t('select_cards')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit();
                }}
              >
                <Pencil className="mr-2 h-3 w-3" /> {t('common_edit')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                className="text-destructive"
              >
                <Trash2 className="mr-2 h-3 w-3" /> {t('common_delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Desktop: Card grid item */}
      <div className="hidden sm:flex flex-col flex-1 p-5 relative">
        {isSelecting && (
          <div className="absolute top-4 right-4 z-10">
            <Checkbox
              checked={isSelected}
              onCheckedChange={onToggleSelect}
              className="h-4 w-4 bg-background/80 shadow-sm"
            />
          </div>
        )}

        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="shrink-0">
              <div className="h-10 w-10 rounded-xl bg-muted/40 border border-border/50 shadow-sm flex items-center justify-center">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
                  <defs>
                    <linearGradient id={`tag-grad-${topic.id}`} x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor={gradientHex.from} />
                      <stop offset="100%" stopColor={gradientHex.to} />
                    </linearGradient>
                  </defs>
                  <path
                    d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2z"
                    stroke={`url(#tag-grad-${topic.id})`}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle cx="7" cy="7" r="1.5" fill={`url(#tag-grad-${topic.id})`} />
                </svg>
              </div>
            </div>
            <h3 className="text-lg font-bold tracking-tight text-foreground truncate min-w-0 flex items-center gap-1.5">
              {topic.name}
            </h3>
          </div>

          {!isSelecting && (
            <div className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 -mr-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      // onSelect();
                    }}
                  >
                    <CheckSquare className="mr-2 h-4 w-4" /> {t('select_cards')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit();
                    }}
                  >
                    <Pencil className="mr-2 h-3 w-3" /> {t('common_edit')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete();
                    }}
                    variant="destructive"
                  >
                    <Trash2 className="mr-2 h-3 w-3" /> {t('common_delete')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>

        <div className="flex-1" />

        <div className="mt-auto flex items-center justify-between pt-1">
          <Badge
            variant="secondary"
            className="bg-secondary/50 text-secondary-foreground hover:bg-secondary/70 border-transparent shadow-none font-medium px-2.5 py-0.5"
          >
            {t('flashcards_count', { count: topic.flashcard_count })}
          </Badge>

          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-primary hover:text-primary hover:bg-primary/10 font-semibold px-2 -mr-2 transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              onView();
            }}
          >
            {t('view_flashcards')}
            <Eye className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
}
