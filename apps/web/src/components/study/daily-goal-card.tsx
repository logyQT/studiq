'use client';

import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Progress,
} from '@studiq/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Pencil, Target } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useApiMutation, useApiQuery } from '@/hooks/use-api';
import { apiPut } from '@/lib/api';
import { GOAL_PRESETS, goalProgress, MAX_GOAL, parseGoalInput } from '@/lib/goal-progress';
import { flashcardKeys } from '@/lib/query-keys';

interface GoalSettings {
  dailyReviewGoal: number;
  reviewedToday: number;
}

const SETTINGS_URL = '/api/v1/flashcards/practice/settings';

/**
 * Daily study goal (#656): today's progress towards it, and an inline editor. The goal is a
 * number of cards studied (every rating counts, cram sessions do not); 0 turns it off. The same
 * value draws the goal line of the activity chart.
 */
export function DailyGoalCard() {
  const t = useTranslations('StudyGoal');
  const queryClient = useQueryClient();
  const settingsKey = [...flashcardKeys.all, 'practice', 'settings'];

  // The headline says how much was studied today, which is exactly what changes right after a
  // session, so the shared (never-stale) settings query is refetched whenever the card mounts.
  const {
    data: settings,
    isLoading,
    isError,
    refetch,
  } = useApiQuery<GoalSettings>({
    queryKey: settingsKey,
    url: SETTINGS_URL,
    staleTime: 0,
  });

  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);

  // Focus follows the editor: into the field when it opens, back to the trigger when it closes.
  useEffect(() => {
    if (editing) inputRef.current?.focus();
    else if (wasEditing.current) triggerRef.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  const save = useApiMutation<unknown, number>({
    mutationFn: (goal) => apiPut(SETTINGS_URL, { dailyReviewGoal: goal }),
    invalidateKeys: [settingsKey, [...flashcardKeys.all, 'stats', 'activity']],
    onError: () => toast.error(t('save_failed')),
  });

  const progress = goalProgress(settings?.reviewedToday ?? 0, settings?.dailyReviewGoal ?? 0);
  const parsed = parseGoalInput(value);

  function startEditing() {
    // Never open the editor on a goal that did not load: saving it would overwrite the real one.
    if (!settings) return;
    setValue(String(settings.dailyReviewGoal));
    setEditing(true);
  }

  function commit(goal: number) {
    save.mutate(goal, {
      onSuccess: () => {
        toast.success(goal === 0 ? t('goal_off') : t('goal_saved', { count: goal }));
        setEditing(false);
        queryClient.invalidateQueries({ queryKey: settingsKey });
      },
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Target className="size-4 text-primary" aria-hidden="true" />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
        {!editing && !isLoading && !isError && (
          <CardAction>
            <Button ref={triggerRef} variant="outline" size="sm" onClick={startEditing}>
              <Pencil className="mr-1.5 size-3.5" aria-hidden="true" />
              {progress.enabled ? t('change') : t('set_goal')}
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="h-10 animate-pulse rounded-lg bg-muted" />
        ) : isError ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">{t('load_error')}</span>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              {t('retry')}
            </Button>
          </div>
        ) : editing ? (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (parsed !== null) commit(parsed);
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="daily-goal">{t('field_label')}</Label>
              <Input
                id="daily-goal"
                ref={inputRef}
                inputMode="numeric"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                aria-invalid={parsed === null}
                aria-describedby={
                  parsed === null ? 'daily-goal-hint daily-goal-error' : 'daily-goal-hint'
                }
                className="max-w-32"
              />
              <p id="daily-goal-hint" className="text-xs text-muted-foreground">
                {t('field_hint', { max: MAX_GOAL })}
              </p>
              {parsed === null && (
                <p id="daily-goal-error" role="alert" className="text-xs text-destructive">
                  {t('field_error', { max: MAX_GOAL })}
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {GOAL_PRESETS.map((preset) => (
                <Button
                  key={preset}
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={t('preset_label', { count: preset })}
                  aria-pressed={parsed === preset}
                  onClick={() => setValue(String(preset))}
                >
                  {preset}
                </Button>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-pressed={parsed === 0}
                onClick={() => setValue('0')}
              >
                {t('off')}
              </Button>
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={parsed === null || save.isPending}>
                <Check className="mr-1.5 size-3.5" aria-hidden="true" />
                {t('save')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setEditing(false)}
                disabled={save.isPending}
              >
                {t('cancel')}
              </Button>
            </div>
          </form>
        ) : progress.enabled ? (
          <>
            <div className="flex items-center justify-between text-sm">
              <span>
                {progress.reached ? t('reached') : t('remaining', { count: progress.remaining })}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {t('progress', { done: progress.done, goal: progress.goal })}
              </span>
            </div>
            <Progress
              value={progress.percent}
              aria-label={t('title')}
              aria-valuetext={t('progress', { done: progress.done, goal: progress.goal })}
            />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t('not_set')}</p>
        )}
      </CardContent>
    </Card>
  );
}
