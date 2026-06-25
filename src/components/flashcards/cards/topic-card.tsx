'use client';

import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MoreVertical, Pencil, Trash2 } from 'lucide-react';
import { getTopicColor } from '@/lib/color-utils';
import type { Topic } from '@/types/flashcards';

interface TopicCardProps {
  topic: Topic;
  isSelected: boolean;
  isSelecting: boolean;
  onToggleSelect: () => void;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
  t: ReturnType<typeof useTranslations>;
}

export function TopicCard({
  topic,
  isSelected,
  isSelecting,
  onToggleSelect,
  onView,
  onEdit,
  onDelete,
  t,
}: TopicCardProps) {
  const color = getTopicColor(topic.name);

  return (
    <Card
      className={`group cursor-pointer transition-all duration-200 ${isSelected ? 'ring-2 ring-primary' : ''}`}
      onClick={() => {
        if (isSelecting) {
          onToggleSelect();
        } else {
          onView();
        }
      }}
    >
      <div className="p-5">
        <div className="flex items-start justify-between">
          <div className="relative">
            <div
              className={`h-10 w-10 rounded-lg ${color} flex items-center justify-center`}
            >
              <span className="text-sm font-bold text-white">
                {topic.name.charAt(0).toUpperCase()}
              </span>
            </div>
            {isSelecting && (
              <div className="absolute -top-2 -left-2 z-10">
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={onToggleSelect}
                  className="h-4 w-4 bg-background/80"
                />
              </div>
            )}
          </div>
          {!isSelecting && (
            <>
              <div className="md:hidden">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                    <Button variant="ghost" size="icon" className="h-7 w-7">
                      <MoreVertical className="h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
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
              </div>
              <div className="hidden md:block">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <MoreVertical className="h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
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
              </div>
            </>
          )}
        </div>
        <h3 className="mt-3 font-semibold truncate">{topic.name}</h3>
        <Badge variant="secondary" className="mt-2">
          {t('flashcards_count', { count: topic.flashcard_count })}
        </Badge>
      </div>
    </Card>
  );
}
