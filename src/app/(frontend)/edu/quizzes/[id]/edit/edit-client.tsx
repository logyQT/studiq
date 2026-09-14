'use client';

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Plus, ScrollText, Trash2 } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { QuestionBrowser } from '@/app/(frontend)/edu/quizzes/[id]/edit/question-browser';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useSidebar } from '@/components/ui/sidebar';
import { Textarea } from '@/components/ui/textarea';
import { useApiMutation, useApiQuery } from '@/hooks/use-api';
import { quizKeys } from '@/lib/query-keys';

interface QuizQuestion {
  question_id: string;
  order_index: number;
  points: number;
  question?: {
    id: string;
    content: string;
    type: string;
  };
}

interface QuizDetail {
  id: string;
  name: string;
  description: string | null;
  quiz_questions: QuizQuestion[];
}

interface BrowseQuestion {
  id: string;
  content: string;
  type: string;
}

interface SaveData {
  name: string;
  description: string | null;
  questions: QuizQuestion[];
}

function SortableQuestion({
  question,
  index,
  onRemove,
}: {
  question: QuizQuestion;
  index: number;
  onRemove: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: question.question_id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="rounded-lg border p-3 flex items-start gap-3 bg-card"
    >
      <button
        {...attributes}
        {...listeners}
        className="mt-1 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
      >
        <GripVertical className="w-4 h-4" />
      </button>
      <div className="flex-1 min-w-0">
        <p className="text-sm">
          <span className="font-medium text-muted-foreground mr-2">{index + 1}.</span>
          {question.question?.content ?? question.question_id}
        </p>
        {question.question && (
          <Badge variant="outline" className="mt-1 text-xs">
            {question.question.type.replace('_', ' ')}
          </Badge>
        )}
      </div>
      <span className="text-sm text-muted-foreground shrink-0">{question.points} pts</span>
      <button
        onClick={() => onRemove(question.question_id)}
        className="text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

export function EditQuizClient() {
  const t = useTranslations('EduQuizEditPage');
  const { id } = useParams<{ id: string }>();
  const _router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const { open: sidebarOpen, isMobile } = useSidebar();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const [activeDragItem, setActiveDragItem] = useState<BrowseQuestion | QuizQuestion | null>(null);

  const nameRef = useRef(name);
  const descRef = useRef(description);
  const questionsRef = useRef(questions);
  nameRef.current = name;
  descRef.current = description;
  questionsRef.current = questions;

  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const isSaving = useRef(false);
  const initialLoaded = useRef(false);

  const { data: quiz, isLoading } = useApiQuery<QuizDetail>({
    queryKey: quizKeys.detail(id),
    url: `/api/v1/teacher/quizzes/${id}`,
  });

  useEffect(() => {
    if (quiz && !initialLoaded.current) {
      initialLoaded.current = true;
      setName(quiz.name);
      setDescription(quiz.description ?? '');
      setQuestions([...(quiz.quiz_questions ?? [])].sort((a, b) => a.order_index - b.order_index));
    }
  }, [quiz]);

  const saveMutation = useApiMutation<QuizDetail, SaveData>({
    mutationFn: async (data) => {
      const res = await fetch(`/api/v1/teacher/quizzes/${id}/bulk`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.name,
          description: data.description ?? null,
          questions: data.questions.map((q) => ({
            question_id: q.question_id,
            order_index: q.order_index,
            points: q.points,
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      return json.data;
    },
    invalidateKeys: [quizKeys.all],
  });

  const triggerAutoSave = () => {
    setHasUnsavedChanges(true);
    if (isSaving.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      if (isSaving.current) return;
      isSaving.current = true;
      try {
        await saveMutation.mutateAsync({
          name: nameRef.current,
          description: descRef.current,
          questions: questionsRef.current,
        });
        setHasUnsavedChanges(false);
        toast.success(t('saved'));
      } catch {
        toast.error(t('auto_save_failed'));
      } finally {
        isSaving.current = false;
      }
    }, 5000);
  };

  const handleSave = async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    try {
      await saveMutation.mutateAsync({ name, description, questions });
      setHasUnsavedChanges(false);
      toast.success(t('saved'));
    } catch {
      toast.error(t('save_failed'));
    }
  };

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const handleRemove = (questionId: string) => {
    setQuestions((prev) => prev.filter((q) => q.question_id !== questionId));
    triggerAutoSave();
  };

  const handleBrowseAdd = (selectedQuestions: BrowseQuestion[]) => {
    if (selectedQuestions.length === 0) return;
    const maxIndex = questions.reduce((max, q) => Math.max(max, q.order_index), -1);
    const optimistic: QuizQuestion[] = selectedQuestions.map((q, i) => ({
      question_id: q.id,
      order_index: maxIndex + 1 + i,
      points: 1,
      question: { id: q.id, content: q.content, type: q.type },
    }));
    setQuestions((prev) => [...prev, ...optimistic]);
    setBrowseOpen(false);
    triggerAutoSave();
  };

  const handleDragStart = (event: DragStartEvent) => {
    if (event.active.data.current?.source === 'browser') {
      setActiveDragItem(event.active.data.current.question as BrowseQuestion);
    } else {
      const q = questions.find((qq) => qq.question_id === event.active.id);
      if (q) setActiveDragItem(q);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    if (active.data.current?.source === 'browser') {
      const question = active.data.current.question as BrowseQuestion;
      setQuestions((prev) => {
        const overIndex = prev.findIndex((q) => q.question_id === over.id);
        const insertIndex = overIndex >= 0 ? overIndex : prev.length;
        const next = [...prev];
        next.splice(insertIndex, 0, {
          question_id: question.id,
          order_index: insertIndex,
          points: 1,
          question: { id: question.id, content: question.content, type: question.type },
        });
        next.forEach((q, i) => {
          q.order_index = i;
        });
        return next;
      });
      triggerAutoSave();
      setActiveDragItem(null);
      return;
    }

    if (active.id === over.id) {
      setActiveDragItem(null);
      return;
    }

    setQuestions((prev) => {
      const oldIndex = prev.findIndex((q) => q.question_id === active.id);
      const newIndex = prev.findIndex((q) => q.question_id === over.id);
      if (oldIndex < 0 || newIndex < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(oldIndex, 1);
      next.splice(newIndex, 0, moved);
      next.forEach((q, i) => {
        q.order_index = i;
      });
      return next;
    });
    triggerAutoSave();
    setActiveDragItem(null);
  };

  const existingIds = new Set(questions.map((q) => q.question_id));

  if (isLoading) {
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-4">
        <div className="h-8 w-48 bg-muted animate-pulse rounded" />
        <div className="h-64 bg-muted animate-pulse rounded-lg" />
      </div>
    );
  }

  if (!quiz) {
    return <div className="p-6 text-center text-muted-foreground">{t('not_found')}</div>;
  }

  const totalPoints = questions.reduce((sum, q) => sum + q.points, 0);

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="px-6 pb-20 max-w-7xl mx-auto scrollbar-gutter-stable">
          <h1 className="text-2xl font-bold tracking-tight mb-6">{t('title')}</h1>

          <div className="flex flex-col gap-6 lg:flex-row">
            <div className="flex-1 space-y-6 min-w-0">
              <Card>
                <CardContent className="space-y-4 pt-6">
                  <div className="space-y-2">
                    <Label htmlFor="name">Name</Label>
                    <Input
                      id="name"
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        triggerAutoSave();
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="description">Description</Label>
                    <Textarea
                      id="description"
                      value={description}
                      onChange={(e) => {
                        setDescription(e.target.value);
                        triggerAutoSave();
                      }}
                      rows={2}
                    />
                  </div>
                </CardContent>
              </Card>

              <Button
                variant="outline"
                size="sm"
                className="lg:hidden"
                onClick={() => setBrowseOpen(true)}
              >
                <Plus className="w-4 h-4 mr-1" /> {t('add_questions')}
              </Button>

              <SortableContext
                items={questions.map((q) => q.question_id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-2">
                  {questions.map((q, i) => (
                    <SortableQuestion
                      key={q.question_id}
                      question={q}
                      index={i}
                      onRemove={handleRemove}
                    />
                  ))}
                </div>
              </SortableContext>

              {questions.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <ScrollText className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">{t('no_questions')}</p>
                  <p className="text-sm text-muted-foreground">{t('no_questions_desc')}</p>
                </div>
              )}
            </div>

            <Card className="hidden lg:block w-96 shrink-0 sticky top-6 self-start">
              <CardContent className="pt-6">
                <h3 className="font-medium mb-4">{t('add_questions')}</h3>
                <QuestionBrowser existingIds={existingIds} onAdd={handleBrowseAdd} draggable />
              </CardContent>
            </Card>
          </div>
        </div>
        <DragOverlay>
          {activeDragItem ? (
            <div className="rounded-lg border p-3 flex items-start gap-3 bg-card shadow-lg">
              <button className="mt-1 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground">
                <GripVertical className="w-4 h-4" />
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-sm">
                  {'content' in activeDragItem
                    ? activeDragItem.content
                    : (activeDragItem.question?.content ?? activeDragItem.question_id)}
                </p>
                <Badge variant="outline" className="mt-1 text-xs">
                  {'content' in activeDragItem
                    ? activeDragItem.type.replace('_', ' ')
                    : (activeDragItem.question?.type?.replace('_', ' ') ?? '')}
                </Badge>
              </div>
              {!('content' in activeDragItem) && (
                <>
                  <span className="text-sm text-muted-foreground shrink-0">
                    {activeDragItem.points} pts
                  </span>
                  <button className="text-muted-foreground">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <div
        className="fixed bottom-0 right-0 z-[5] border-t bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60 transition-[left] duration-200 ease-linear"
        style={{ left: isMobile ? 0 : `var(--sidebar-${sidebarOpen ? 'width' : 'width-icon'})` }}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              {questions.length} questions, {totalPoints} pts
            </span>
            {hasUnsavedChanges && (
              <span className="text-sm text-amber-600 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-600 inline-block shrink-0" />
                {t('unsaved')}
              </span>
            )}
          </div>
          <Button variant="default" size="sm" onClick={handleSave}>
            {t('save')}
          </Button>
        </div>
      </div>

      <Dialog open={browseOpen} onOpenChange={setBrowseOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('add_questions')}</DialogTitle>
          </DialogHeader>
          <QuestionBrowser existingIds={existingIds} onAdd={handleBrowseAdd} />
        </DialogContent>
      </Dialog>
    </>
  );
}
