'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { MoreVertical } from 'lucide-react';
import { OwnedFlashcardContextMenu } from '@/components/flashcards/owned-flashcard-context-menu';
import { ViewOnlyFlashcardContextMenu } from '@/components/flashcards/view-only-flashcard-context-menu';
import type { Flashcard, Topic } from '@/types/flashcards';
import { useTranslations } from 'next-intl';

const TOPIC_COLORS = [
  'bg-red-500', 'bg-blue-500', 'bg-green-500', 'bg-yellow-500',
  'bg-purple-500', 'bg-pink-500', 'bg-indigo-500', 'bg-teal-500',
  'bg-orange-500', 'bg-cyan-500',
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
  onFlip: (id: string) => void;
  onEdit: (fc: Flashcard) => void;
  onDelete: (id: string) => void;
  onLink: (fc: Flashcard) => void;
  onCopy: (fc: Flashcard) => void;
  onAddTopic: (fc: Flashcard) => void;
  onRemoveTopic: (fc: Flashcard) => void;
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
  onFlip,
  onEdit,
  onDelete,
  onLink,
  onCopy,
  onAddTopic,
  onRemoveTopic,
  onViewByTopic,
}: FlashcardCardProps) {
  const fcTopics = topics.filter((topic) =>
    fc.flashcard_topic_assignments?.some((a) => a.topic_id === topic.id),
  );

  return (
    <Card
      className={`group relative min-h-48 cursor-pointer transition-all duration-300 hover:shadow-lg ${
        isFlipped ? `bg-gradient-to-br ${gradient}` : ''
      }`}
      onClick={() => onFlip(isFlipped ? '' : fc.id)}
    >
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
                onRemoveTopic={() => onRemoveTopic(fc)}
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
              />
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <CardContent className="flex flex-col items-center justify-center p-6 pt-8">
        <p className="mb-2 text-xs uppercase text-muted-foreground">
          {isFlipped ? t('answer_label') : t('question_label')}
        </p>
        <p className={`text-center text-lg font-medium ${isFlipped ? 'text-white' : ''}`}>
          {isFlipped ? fc.back : fc.front}
        </p>
        <div className="mt-auto pt-4 w-full">
          {fcTopics.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {fcTopics.map((topic) => (
                <Badge key={topic.id} variant="secondary" className="gap-1 text-xs">
                  <div className={`h-1.5 w-1.5 rounded-full ${getTopicColor(topic.name)}`} />
                  {topic.name}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t('no_topics')}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
