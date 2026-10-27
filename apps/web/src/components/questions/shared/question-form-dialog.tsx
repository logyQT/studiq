'use client';

import type { Question } from '@studiq/server/models/question.model';
import type { Topic } from '@studiq/server/models/topic.model';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  MultiSelect,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@studiq/ui';
import { Plus, X } from 'lucide-react';
import type { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import {
  normalizeTrueFalseAnswers,
  type QuestionFormError,
  validateQuestionForm,
} from '@/lib/question-form';
import { SrLabel } from '@/components/shared/sr-label';

interface AnswerForm {
  content: string;
  isCorrect: boolean;
}

interface QuestionFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialValues: Question | null;
  bankId: string;
  /** Topic options for the picker, fetched by the screen from `GET /api/v1/topics`. */
  topics?: Topic[];
  onSubmit: (data: {
    content: string;
    type: string;
    explanation?: string;
    topicIds?: string[];
    bankId: string;
    answers: { content: string; isCorrect: boolean; orderIndex: number }[];
  }) => Promise<boolean>;
  t: ReturnType<typeof useTranslations>;
}

const _QUESTION_TYPES = ['mcq', 'true_false', 'open'] as const;

export function QuestionFormDialog({
  open,
  onOpenChange,
  initialValues,
  bankId,
  topics = [],
  onSubmit,
  t,
}: QuestionFormDialogProps) {
  const [content, setContent] = useState('');
  const [type, setType] = useState<string>('mcq');
  const [explanation, setExplanation] = useState('');
  const [topicIds, setTopicIds] = useState<string[]>([]);
  const [answers, setAnswers] = useState<AnswerForm[]>([{ content: '', isCorrect: false }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<QuestionFormError | 'save_failed' | null>(null);

  // The teacher's T/F wording, remembered while the type is switched away so
  // `true_false → mcq → true_false` restores it. Reset whenever the dialog opens.
  const tfDraftRef = useRef<AnswerForm[] | null>(null);
  // `t` is a fresh function on every render (next-intl wraps `useTranslations`),
  // so it must never be an effect dependency: the open effect would re-run while
  // typing. Keep the current-locale labels in a ref the effect can read instead.
  const tfLabelsRef = useRef({ trueLabel: '', falseLabel: '' });
  tfLabelsRef.current = { trueLabel: t('tf_true'), falseLabel: t('tf_false') };

  useEffect(() => {
    if (open) {
      setError(null);
      tfDraftRef.current = null;
      if (initialValues) {
        const storedAnswers = (initialValues.question_answers ?? []).map((a) => ({
          content: a.content,
          isCorrect: a.is_correct,
        }));
        setContent(initialValues.content);
        setType(initialValues.type);
        setExplanation(initialValues.explanation ?? '');
        setTopicIds(initialValues.topics?.map((topic) => topic.id) ?? []);
        // Never re-translate stored wording: only pad missing legacy rows.
        setAnswers(
          initialValues.type === 'true_false'
            ? normalizeTrueFalseAnswers(storedAnswers, tfLabelsRef.current)
            : storedAnswers,
        );
      } else {
        setContent('');
        setType('mcq');
        setExplanation('');
        setTopicIds([]);
        setAnswers([{ content: '', isCorrect: false }]);
      }
    }
  }, [open, initialValues]);

  // Clear a stale inline message as soon as the user edits the form.
  useEffect(() => {
    setError(null);
  }, [content, type, answers, topicIds]);

  function addAnswer() {
    setAnswers([...answers, { content: '', isCorrect: false }]);
  }

  function removeAnswer(index: number) {
    setAnswers(answers.filter((_, i) => i !== index));
  }

  function updateAnswer(index: number, field: 'content' | 'isCorrect', value: string | boolean) {
    setAnswers((prev) =>
      prev.map((a, i) => {
        if (field === 'isCorrect' && value === true) {
          return { ...a, isCorrect: i === index };
        }
        return i === index ? { ...a, [field]: value } : a;
      }),
    );
  }

  function handleTypeChange(nextType: string) {
    if (type === 'true_false' && nextType !== 'true_false') {
      // Preserve the teacher's wording so returning to T/F restores it.
      tfDraftRef.current = answers;
    }
    if (nextType === 'true_false' && type !== 'true_false') {
      // Seed immediately: no extra "generate" click, and both rows stay editable.
      setAnswers(normalizeTrueFalseAnswers(tfDraftRef.current ?? [], tfLabelsRef.current));
    }
    setType(nextType);
  }

  async function handleSubmit() {
    const validationError = validateQuestionForm({ type, content, answers });
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      const saved = await onSubmit({
        content: content.trim(),
        type,
        explanation: explanation.trim() || undefined,
        topicIds,
        bankId,
        answers:
          type === 'open'
            ? []
            : answers
                .filter((a) => a.content.trim())
                .map((a, i) => ({
                  content: a.content.trim(),
                  isCorrect: a.isCorrect,
                  orderIndex: i,
                })),
      });
      if (saved) onOpenChange(false);
    } catch {
      // Callers catch and return `false`, so this only guards a contract
      // violation — never leak the rejection as an unhandled one.
      setError('save_failed');
    } finally {
      setSubmitting(false);
    }
  }

  // Options come from the fetched topic list; the question's own topics are
  // merged back in so an assignment outside the fetched page keeps its label.
  const mergedTopics = [
    ...topics,
    ...(initialValues?.topics ?? []).filter(
      (topic) => !topics.some((fetched) => fetched.id === topic.id),
    ),
  ];
  const topicOptions = mergedTopics.map((topic) => ({ label: topic.name, value: topic.id }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initialValues ? t('edit_title') : t('create_title')}</DialogTitle>
          <DialogDescription>{initialValues ? t('edit_desc') : t('create_desc')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div>
            <Label>{t('question_type')}</Label>
            <Select value={type} onValueChange={handleTypeChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mcq">{t('multiple_choice')}</SelectItem>
                <SelectItem value="true_false">{t('true_false')}</SelectItem>
                <SelectItem value="open">{t('open_answer')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>{t('question_content')}</Label>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={t('question_placeholder')}
              rows={3}
            />
          </div>

          {type !== 'open' && (
            <div>
              <Label className="mb-2 block">{t('answers_label')}</Label>
              <div className="space-y-2">
                {answers.map((a, i) => (
                  <div key={i} className="flex gap-2 items-start">
                    <input
                      type="radio"
                      name="correctAnswer"
                      checked={a.isCorrect}
                      onChange={() => updateAnswer(i, 'isCorrect', true)}
                      className="mt-2"
                    />
                    <Input
                      value={a.content}
                      onChange={(e) => updateAnswer(i, 'content', e.target.value)}
                      placeholder={t('answer_placeholder', { index: i + 1 })}
                      className="flex-1"
                    />
                    {type !== 'true_false' && answers.length > 1 && (
                      <Button variant="ghost" size="icon" onClick={() => removeAnswer(i)}>
                        <X className="h-4 w-4" />
                        <SrLabel k="remove_answer" values={{ number: i + 1 }} />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              {type === 'mcq' && (
                <Button variant="outline" size="sm" className="mt-2" onClick={addAnswer}>
                  <Plus className="mr-1 h-3 w-3" /> {t('add_answer')}
                </Button>
              )}
              <p className="text-xs text-muted-foreground mt-1">{t('correct_answer_hint')}</p>
            </div>
          )}

          <div>
            <Label>{t('explanation')}</Label>
            <Textarea
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              placeholder={t('explanation_placeholder')}
              rows={2}
            />
          </div>

          <div>
            <Label className="mb-2 block">{t('topics_label')}</Label>
            <MultiSelect
              options={topicOptions}
              selected={topicIds}
              onChange={setTopicIds}
              placeholder={t('topics_placeholder')}
            />
          </div>
        </div>
        {error && (
          <p className="text-sm font-medium text-destructive" role="alert">
            {t(error)}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t('cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {initialValues ? t('update') : t('create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
