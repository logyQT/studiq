'use client';

import { memo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { MoreVertical } from 'lucide-react';
import { OwnedFlashcardContextMenu } from '@/components/flashcards/owned-flashcard-context-menu';
import { ViewOnlyFlashcardContextMenu } from '@/components/flashcards/view-only-flashcard-context-menu';
import { MarkdownRenderer } from '@/components/shared/markdown-renderer';
import type { Flashcard, Topic } from '@/types/flashcards';
import { useTranslations } from 'next-intl';
import { getTopicColorHex } from '@/lib/color-utils';

interface FlashcardCardProps {
  fc: Flashcard;
  isFlipped: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  topics: Topic[];
  t: ReturnType<typeof useTranslations>;
  selected?: boolean;
  selectable?: boolean;
  onToggleSelect?: (id: string) => void;
  onFlip: (id: string) => void;
  onEdit: (fc: Flashcard) => void;
  onDelete: (id: string) => void;
  onLink: (fc: Flashcard) => void;
  onCopy: (fc: Flashcard) => void;
  onAddTopic: (fc: Flashcard) => void;
  onManageTopics: (fc: Flashcard) => void;
  onViewByTopic: (fc: Flashcard, topicId: string) => void;
}

export const FlashcardCard = memo(function FlashcardCard({
  fc,
  isFlipped,
  canUpdate,
  canDelete,
  topics,
  t,
  selected,
  selectable,
  onToggleSelect,
  onFlip,
  onEdit,
  onDelete,
  onLink,
  onCopy,
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
      className="group relative cursor-pointer transition-shadow duration-300 sm:min-h-48 sm:max-h-96 sm:overflow-hidden sm:hover:shadow-lg max-sm:py-0"
      data-flipped={isFlipped ? '' : undefined}
      onClick={() => {
        if (selectable) {
          onToggleSelect?.(fc.id);
        } else {
          onFlip(isFlipped ? '' : fc.id);
        }
      }}
    >
      {/* Mobile: compact list row */}
      <div className="sm:hidden p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            {selectable && (
              <Checkbox
                checked={selected}
                onCheckedChange={() => onToggleSelect?.(fc.id)}
                className="h-4 w-4 mr-2 align-middle inline-block"
                onClick={(e) => e.stopPropagation()}
              />
            )}
            <span className="text-xs uppercase text-muted-foreground font-normal">Q: </span>
            <span className="text-sm font-medium truncate min-w-0">{fc.front}</span>
          </div>
          {!selectable && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <MoreVertical className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canUpdate ? (
                  <OwnedFlashcardContextMenu
                    t={t}
                    onEdit={() => onEdit(fc)}
                    onAddTopic={() => onAddTopic(fc)}
                    onManageTopics={() => onManageTopics(fc)}
                    onViewByTopic={() => {
                      const firstAssigned = topics.find((topic) =>
                        fc.flashcard_topic_assignments?.some((a) => a.topic_id === topic.id),
                      );
                      if (firstAssigned) onViewByTopic(fc, firstAssigned.id);
                    }}
                    onLink={() => onLink(fc)}
                    onCopy={() => onCopy(fc)}
                    onDelete={canDelete ? () => onDelete(fc.id) : null}
                  />
                ) : (
                  <ViewOnlyFlashcardContextMenu
                    t={t}
                    onLink={() => onLink(fc)}
                    onCopy={() => onCopy(fc)}
                    onDelete={canDelete ? () => onDelete(fc.id) : null}
                  />
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
          <span className="text-xs uppercase font-normal">A: </span>
          {fc.back}
        </p>
        {fcTopics.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {fcTopics.map((topic) => (
              <span
                key={topic.id}
                className="rounded-full px-2 py-0.5 text-xs"
                style={{ backgroundColor: `${getTopicColorHex(topic.name)}80` }}
              >
                {topic.name}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Desktop: flip card */}
      <div className="hidden sm:flex sm:flex-col sm:flex-1">
        {selectable && (
          <div className="absolute left-2 top-2 z-10" onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={selected}
              onCheckedChange={() => onToggleSelect?.(fc.id)}
              className="h-5 w-5 bg-background/80"
            />
          </div>
        )}
        <div className="absolute right-2 top-2 z-10 opacity-0 transition-opacity group-hover:opacity-100">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="secondary"
                size="icon"
                className="h-7 w-7"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreVertical className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canUpdate ? (
                <OwnedFlashcardContextMenu
                  t={t}
                  onEdit={() => onEdit(fc)}
                  onAddTopic={() => onAddTopic(fc)}
                  onManageTopics={() => onManageTopics(fc)}
                  onViewByTopic={() => {
                    const firstAssigned = topics.find((topic) =>
                      fc.flashcard_topic_assignments?.some((a) => a.topic_id === topic.id),
                    );
                    if (firstAssigned) onViewByTopic(fc, firstAssigned.id);
                  }}
                  onLink={() => onLink(fc)}
                  onCopy={() => onCopy(fc)}
                  onDelete={canDelete ? () => onDelete(fc.id) : null}
                />
              ) : (
                <ViewOnlyFlashcardContextMenu
                  t={t}
                  onLink={() => onLink(fc)}
                  onCopy={() => onCopy(fc)}
                  onDelete={canDelete ? () => onDelete(fc.id) : null}
                />
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <CardContent className="flex-1 flex flex-col items-center p-4 pt-6">
          <p
            className="mb-2 text-xs uppercase text-muted-foreground"
          >
            {isFlipped ? t('answer_label') : t('question_label')}
          </p>
          <div className="w-full text-center flex-1 flex items-center justify-center overflow-hidden">
              <div className="text-lg font-medium grid w-full">
              <div className={`[grid-area:1/1] min-w-0 ${isFlipped ? 'invisible' : ''}`}>
                <MarkdownRenderer content={fc.front} />
              </div>
              <div className={`[grid-area:1/1] min-w-0 ${isFlipped ? '' : 'invisible'}`}>
                <MarkdownRenderer content={fc.back} />
              </div>
            </div>
          </div>
        </CardContent>

        {fcTopics.length > 0 && (
          <div className="absolute bottom-3 left-3 z-10 flex flex-wrap gap-1">
            {fcTopics.map((topic) => (
              <span
                key={topic.id}
                className="rounded-full px-2 py-0.5 text-xs"
                style={{ backgroundColor: `${getTopicColorHex(topic.name)}80` }}
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
