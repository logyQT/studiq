'use client';

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Switch,
  Textarea,
} from '@studiq/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

/** Form state as the inputs hold it: every number/date field is a string until submit. */
export interface AssignmentFormValues {
  title: string;
  description: string;
  deadline: string;
  timeLimitMin: string;
  shuffleQuestions: boolean;
  shuffleAnswers: boolean;
  showResults: boolean;
  maxAttempts: string;
  attemptItemCount: string;
  allowSameItemRetake: boolean;
  unseenOnly: boolean;
  passingScore: string;
}

/** Request body both assignment endpoints accept; empty optional fields are omitted. */
export interface AssignmentPayload {
  title: string;
  description?: string;
  deadline?: string;
  timeLimitMin?: number;
  shuffleQuestions: boolean;
  shuffleAnswers: boolean;
  showResults: boolean;
  maxAttempts: number;
  /** `null` reopens the whole pool; omitted leaves the column untouched. */
  attemptItemCount?: number | null;
  allowSameItemRetake: boolean;
  unseenOnly: boolean;
  passingScore?: number;
}

const EMPTY_ASSIGNMENT_FORM: AssignmentFormValues = {
  title: '',
  description: '',
  deadline: '',
  timeLimitMin: '',
  shuffleQuestions: true,
  shuffleAnswers: true,
  showResults: false,
  maxAttempts: '1',
  attemptItemCount: '',
  allowSameItemRetake: false,
  unseenOnly: false,
  passingScore: '',
};

interface AssignmentFormProps {
  /** `create` labels the submit button from the create copy, `edit` from the edit copy. */
  mode: 'create' | 'edit';
  initial?: Partial<AssignmentFormValues>;
  /** Quiz the assignment is generated from, shown under the title field. */
  quizName?: string;
  isPending: boolean;
  onSubmit: (payload: AssignmentPayload) => void;
  onCancel: () => void;
  /** A published run that has opened: its close may move forward, never into the past. */
  live?: boolean;
  /** The server's per-field refusal of the deadline, as a key of the `Errors` namespace. */
  deadlineError?: string | null;
  /** Drops a stale server refusal once the teacher edits the field. */
  onDeadlineChange?: () => void;
  /** The documented way to end a live run now (R12/R20); omitted outside the edit form. */
  onCloseNow?: () => void;
  closePending?: boolean;
}

export function AssignmentForm({
  mode,
  initial,
  quizName,
  isPending,
  onSubmit,
  onCancel,
  live = false,
  deadlineError = null,
  onDeadlineChange,
  onCloseNow,
  closePending = false,
}: AssignmentFormProps) {
  const t = useTranslations('EduAssignmentForm');
  const tErrors = useTranslations('Errors');
  const [values, setValues] = useState<AssignmentFormValues>({
    ...EMPTY_ASSIGNMENT_FORM,
    ...initial,
  });

  const set = <K extends keyof AssignmentFormValues>(
    key: K,
    value: AssignmentFormValues[K],
  ): void => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  // A live run is ending early only through Close (durable `closed_at`, expired attempts, deliberate
  // reveal); a deadline that is not in the future is not a correction, so the field says so before
  // and after the save.
  const deadlineAt = values.deadline ? new Date(values.deadline).getTime() : null;
  const deadlineInPast = live && deadlineAt !== null && deadlineAt <= Date.now();
  const deadlineGuidance =
    deadlineError && tErrors.has(deadlineError)
      ? deadlineError
      : deadlineInPast
        ? 'VALIDATION_DEADLINE_END_IS_CLOSE'
        : null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      title: values.title,
      description: values.description || undefined,
      deadline: values.deadline ? new Date(values.deadline).toISOString() : undefined,
      timeLimitMin: values.timeLimitMin ? parseInt(values.timeLimitMin, 10) : undefined,
      shuffleQuestions: values.shuffleQuestions,
      shuffleAnswers: values.shuffleAnswers,
      showResults: values.showResults,
      maxAttempts: parseInt(values.maxAttempts, 10),
      attemptItemCount: values.attemptItemCount ? parseInt(values.attemptItemCount, 10) : null,
      allowSameItemRetake: values.allowSameItemRetake,
      unseenOnly: values.unseenOnly,
      passingScore: values.passingScore ? parseInt(values.passingScore, 10) : undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('basic_info')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">{t('title_field')}</Label>
            <Input
              id="title"
              value={values.title}
              onChange={(e) => set('title', e.target.value)}
              required
              placeholder={t('title_placeholder')}
            />
            {quizName && (
              <p className="text-xs text-muted-foreground">{t('based_on', { name: quizName })}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">{t('description')}</Label>
            <Textarea
              id="description"
              value={values.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder={t('description_placeholder')}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('timing_limits')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="deadline">{t('deadline')}</Label>
            <Input
              id="deadline"
              type="datetime-local"
              value={values.deadline}
              onChange={(e) => {
                set('deadline', e.target.value);
                onDeadlineChange?.();
              }}
              aria-invalid={deadlineGuidance !== null}
              aria-describedby={deadlineGuidance ? 'deadline-guidance' : undefined}
            />
            {deadlineGuidance && (
              <div id="deadline-guidance" className="space-y-2">
                <p role="alert" className="text-xs text-destructive">
                  {tErrors(deadlineGuidance)}
                </p>
                {onCloseNow && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onCloseNow}
                    disabled={closePending}
                  >
                    {t(closePending ? 'closing_now' : 'close_now')}
                  </Button>
                )}
              </div>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="timeLimit">{t('time_limit_min')}</Label>
            <Input
              id="timeLimit"
              type="number"
              min={1}
              max={300}
              value={values.timeLimitMin}
              onChange={(e) => set('timeLimitMin', e.target.value)}
              placeholder={t('no_limit')}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="maxAttempts">{t('max_attempts')}</Label>
            <Input
              id="maxAttempts"
              type="number"
              min={1}
              max={10}
              value={values.maxAttempts}
              onChange={(e) => set('maxAttempts', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="attemptItemCount">{t('attempt_item_count')}</Label>
            <Input
              id="attemptItemCount"
              type="number"
              min={1}
              max={100}
              value={values.attemptItemCount}
              onChange={(e) => set('attemptItemCount', e.target.value)}
              placeholder={t('whole_pool')}
            />
            <p className="text-xs text-muted-foreground">{t('attempt_item_count_desc')}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="passingScore">{t('passing_score')}</Label>
            <Input
              id="passingScore"
              type="number"
              min={0}
              max={100}
              value={values.passingScore}
              onChange={(e) => set('passingScore', e.target.value)}
              placeholder={t('no_threshold')}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('settings')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ToggleRow
            label={t('shuffle_questions')}
            description={t('shuffle_questions_desc')}
            checked={values.shuffleQuestions}
            onCheckedChange={(checked) => set('shuffleQuestions', checked)}
          />
          <ToggleRow
            label={t('shuffle_answers')}
            description={t('shuffle_answers_desc')}
            checked={values.shuffleAnswers}
            onCheckedChange={(checked) => set('shuffleAnswers', checked)}
          />
          <ToggleRow
            label={t('show_results')}
            description={t('show_results_desc')}
            checked={values.showResults}
            onCheckedChange={(checked) => set('showResults', checked)}
          />
          <ToggleRow
            label={t('same_item_retake')}
            description={t('same_item_retake_desc')}
            checked={values.allowSameItemRetake}
            onCheckedChange={(checked) => set('allowSameItemRetake', checked)}
          />
          <ToggleRow
            label={t('unseen_only')}
            description={t('unseen_only_desc')}
            checked={values.unseenOnly}
            onCheckedChange={(checked) => set('unseenOnly', checked)}
          />
        </CardContent>
      </Card>

      <div className="flex gap-3 justify-end">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('cancel')}
        </Button>
        <Button type="submit" disabled={!values.title || isPending}>
          {isPending
            ? t(mode === 'create' ? 'creating' : 'saving')
            : t(mode === 'create' ? 'create' : 'save_changes')}
        </Button>
      </div>
    </form>
  );
}

interface ToggleRowProps {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

function ToggleRow({ label, description, checked, onCheckedChange }: ToggleRowProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <Label>{label}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
