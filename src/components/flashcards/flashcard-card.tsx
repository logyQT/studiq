'use client';

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

const TOPIC_COLORS = [
  'bg-red-500',
  'bg-blue-500',
  'bg-green-500',
  'bg-yellow-500',
  'bg-purple-500',
  'bg-pink-500',
  'bg-indigo-500',
  'bg-teal-500',
  'bg-orange-500',
  'bg-cyan-500',
];

function getTopicColor(name: string) {
  return TOPIC_COLORS[name.length % TOPIC_COLORS.length];
}

interface FlashcardCardProps {
  fc: Flashcard;
  isFlipped: boolean;
  gradient: string;
  canUpdate: boolean;
  canDelete: boolean;
  topics: Topic[];
  t: ReturnType<typeof useTranslations>;
  selected?: boolean;
  selectable?: boolean;
  highlighted?: boolean;
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

export function FlashcardCard({
  fc,
  isFlipped,
  gradient,
  canUpdate,
  canDelete,
  topics,
  t,
  selected,
  selectable,
  highlighted,
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
      className={`group relative min-h-48 cursor-pointer transition-all duration-300 hover:shadow-lg ${
        isFlipped ? `bg-gradient-to-br ${gradient}` : ''
      } ${highlighted ? 'ring-2 ring-primary/70 ring-offset-2 animate-pulse' : ''}`}
      onClick={() => {
        if (selectable) {
          onToggleSelect?.(fc.id);
        } else {
          onFlip(isFlipped ? '' : fc.id);
        }
      }}
    >
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
          className={`mb-2 text-xs uppercase ${isFlipped ? 'text-white/70' : 'text-muted-foreground'}`}
        >
          {isFlipped ? t('answer_label') : t('question_label')}
        </p>
        <div className="max-w-lg mx-auto w-full text-center flex-1 flex items-center justify-center">
          <div className="text-lg font-medium grid">
            <div className={`[grid-area:1/1] ${isFlipped ? 'invisible' : ''}`}>
              <MarkdownRenderer content={fc.front} />
            </div>
            <div className={`[grid-area:1/1] ${isFlipped ? 'text-white' : 'invisible'}`}>
              <MarkdownRenderer content={fc.back} />
            </div>
          </div>
        </div>
      </CardContent>

      {fcTopics.length > 0 && (
        <div className="absolute bottom-3 left-3 z-10 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {fcTopics.map((topic) => (
            <div key={topic.id} className="relative group/topic">
              <div className={`h-2.5 w-2.5 rounded-full ${getTopicColor(topic.name)}`} />
              <span className="absolute left-3 top-1/2 -translate-y-1/2 whitespace-nowrap text-xs bg-background/80 backdrop-blur rounded px-1.5 py-0.5 shadow-sm border hidden group-hover/topic:block z-20">
                {topic.name}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
