'use client';

import type { Flashcard } from '@studiq/server/models/flashcard.model';
import type { Topic } from '@studiq/server/models/topic.model';
import {
  Button,
  Card,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@studiq/ui';
import { MoreVertical } from 'lucide-react';
import type { useTranslations } from 'next-intl';
import { memo } from 'react';
import { FlashcardContextMenu } from '@/components/flashcards/context-menus/flashcard-context-menu';
import { MarkdownRenderer } from '@/components/shared/markdown-renderer';
import { getTopicColorHex } from '@/lib/color-utils';

interface FlashcardCardProps {
  fc: Flashcard;
  canUpdate: boolean;
  canDelete: boolean;
  topics: Topic[];
  t: ReturnType<typeof useTranslations>;
  selected?: boolean;
  selectable?: boolean;
  onToggleSelect?: (id: string) => void;
  onEnterSelectionMode?: (id: string) => void;
  onEdit: (fc: Flashcard) => void;
  onDelete: (id: string) => void;
  onMove: (fc: Flashcard) => void;
  onCopy: (fc: Flashcard) => void;
  onReport?: (fc: Flashcard) => void;
  onAddTopic: (fc: Flashcard) => void;
  onManageTopics: (fc: Flashcard) => void;
  onViewByTopic: (fc: Flashcard, topicId: string) => void;
}

// Compact list preview: flatten heading sizes/margins so a `#` heading doesn't blow up the card.
const COMPACT_MD =
  '[&_:is(h1,h2,h3,h4,h5,h6)]:text-[length:inherit] [&_:is(h1,h2,h3,h4,h5,h6)]:mt-0 [&_:is(h1,h2,h3,h4,h5,h6)]:mb-0';

// Links open in a new tab; don't let their clicks also toggle card selection.
const stopLinkClick = (e: React.MouseEvent) => {
  if ((e.target as HTMLElement).closest('a')) e.stopPropagation();
};

export const FlashcardCard = memo(function FlashcardCard({
  fc,
  canUpdate,
  canDelete,
  topics,
  t,
  selected,
  selectable,
  onToggleSelect,
  onEnterSelectionMode,
  onEdit,
  onDelete,
  onMove,
  onCopy,
  onReport,
  onAddTopic,
  onManageTopics,
  onViewByTopic,
}: FlashcardCardProps) {
  const fcTopics = topics.filter((topic) =>
    fc.flashcard_topic_assignments?.some((a) => a.topic_id === topic.id),
  );

  return (
    <Card
      id={`fc-${fc.id}`}
      className="group relative cursor-pointer transition-shadow duration-300 sm:min-h-28 sm:hover:shadow-lg max-sm:py-0"
      onClick={() => {
        if (selectable) {
          onToggleSelect?.(fc.id);
        }
      }}
    >
      {/* Mobile: compact list row */}
      <div className="sm:hidden px-3 py-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center">
              {selectable && (
                <Checkbox
                  checked={selected}
                  onCheckedChange={() => onToggleSelect?.(fc.id)}
                  className="h-4 w-4 mr-2 shrink-0"
                  onClick={(e) => e.stopPropagation()}
                />
              )}
              <div
                className="text-sm font-semibold text-foreground min-w-0 max-h-[1lh] overflow-hidden"
                onClick={stopLinkClick}
              >
                <MarkdownRenderer content={fc.front} className={COMPACT_MD} />
              </div>
            </div>
          </div>
          {!selectable && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-muted-foreground/80 hover:text-foreground"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreVertical className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <FlashcardContextMenu
                  t={t}
                  mode={canUpdate ? 'owned' : 'view-only'}
                  onSelect={() => onEnterSelectionMode?.(fc.id)}
                  onEdit={canUpdate ? () => onEdit(fc) : undefined}
                  onAddTopic={canUpdate ? () => onAddTopic(fc) : undefined}
                  onManageTopics={canUpdate ? () => onManageTopics(fc) : undefined}
                  onViewByTopic={
                    canUpdate
                      ? () => {
                          const firstAssigned = topics.find((topic) =>
                            fc.flashcard_topic_assignments?.some((a) => a.topic_id === topic.id),
                          );
                          if (firstAssigned) onViewByTopic(fc, firstAssigned.id);
                        }
                      : undefined
                  }
                  onMove={canUpdate ? () => onMove(fc) : undefined}
                  onReport={fc.question_id ? () => onReport?.(fc) : undefined}
                  onCopy={() => onCopy(fc)}
                  onDelete={canDelete ? () => onDelete(fc.id) : null}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Clean Separator line */}
        <div className="my-1.5 border-t border-border/50" />

        <div
          className="text-sm text-muted-foreground/90 max-h-[2lh] overflow-hidden"
          onClick={stopLinkClick}
        >
          <MarkdownRenderer content={fc.back} className={COMPACT_MD} />
        </div>

        {fcTopics.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {fcTopics.map((topic) => (
              <span
                key={topic.id}
                className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                style={{
                  backgroundColor: `${getTopicColorHex(topic.name)}30`,
                  color: getTopicColorHex(topic.name),
                }}
              >
                {topic.name}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Desktop: two-row Q&A */}
      <div className="hidden sm:flex sm:flex-col sm:flex-1 sm:px-4 sm:py-3.5">
        {selectable && (
          <div className="absolute top-4 right-4 z-10" onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={selected}
              onCheckedChange={() => onToggleSelect?.(fc.id)}
              className="h-5 w-5 bg-background/80"
            />
          </div>
        )}
        {!selectable && (
          <div className="absolute right-2 top-2 z-10 opacity-0 transition-opacity group-hover:opacity-100">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreVertical className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <FlashcardContextMenu
                  t={t}
                  mode={canUpdate ? 'owned' : 'view-only'}
                  onSelect={() => onEnterSelectionMode?.(fc.id)}
                  onEdit={canUpdate ? () => onEdit(fc) : undefined}
                  onAddTopic={canUpdate ? () => onAddTopic(fc) : undefined}
                  onManageTopics={canUpdate ? () => onManageTopics(fc) : undefined}
                  onViewByTopic={
                    canUpdate
                      ? () => {
                          const firstAssigned = topics.find((topic) =>
                            fc.flashcard_topic_assignments?.some((a) => a.topic_id === topic.id),
                          );
                          if (firstAssigned) onViewByTopic(fc, firstAssigned.id);
                        }
                      : undefined
                  }
                  onMove={canUpdate ? () => onMove(fc) : undefined}
                  onReport={fc.question_id ? () => onReport?.(fc) : undefined}
                  onCopy={() => onCopy(fc)}
                  onDelete={canDelete ? () => onDelete(fc.id) : null}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        <div className="min-w-0 pr-6">
          <div
            className="text-base font-semibold text-foreground max-h-[1lh] overflow-hidden"
            onClick={stopLinkClick}
          >
            <MarkdownRenderer content={fc.front} className={COMPACT_MD} />
          </div>
        </div>

        {/* Clean Separator line */}
        <div className="my-2 border-t border-border/50" />

        <div className="flex-1 min-w-0">
          <div
            className="text-sm text-muted-foreground/90 max-h-[3lh] overflow-hidden"
            onClick={stopLinkClick}
          >
            <MarkdownRenderer content={fc.back} className={COMPACT_MD} />
          </div>
        </div>

        {fcTopics.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {fcTopics.map((topic) => (
              <span
                key={topic.id}
                className="rounded-full px-2.5 py-0.5 text-xs font-medium"
                style={{
                  backgroundColor: `${getTopicColorHex(topic.name)}30`,
                  color: getTopicColorHex(topic.name),
                }}
              >
                {topic.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
});
