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
}

export function AssignmentForm({
  mode,
  initial,
  quizName,
  isPending,
  onSubmit,
  onCancel,
}: AssignmentFormProps) {
  const t = useTranslations('EduAssignmentForm');
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
              onChange={(e) => set('deadline', e.target.value)}
            />
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
