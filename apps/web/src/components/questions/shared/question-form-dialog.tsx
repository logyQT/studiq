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
import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
  normalizeTrueFalseAnswers,
  QUESTION_FORM_LIMITS,
  type QuestionFormErrors,
  type QuestionFormPayload,
  type QuestionFormResult,
  validateQuestionForm,
} from '@/lib/question-form';
import { SrLabel } from '@/components/shared/sr-label';

/** One field's problem, tied to its input by position and announced as an alert. */
function FieldError({ children }: { children: ReactNode }) {
  return (
    <p className="mt-1 text-sm font-medium text-destructive" role="alert">
      {children}
    </p>
  );
}

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
  /**
   * Saves the item. A refusal that names fields (the server's 422) renders under those fields
   * instead of as a toast.
   */
  onSubmit: (data: QuestionFormPayload) => Promise<QuestionFormResult>;
  t: ReturnType<typeof useTranslations>;
}

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
  const [modelAnswer, setModelAnswer] = useState('');
  const [topicIds, setTopicIds] = useState<string[]>([]);
  const [answers, setAnswers] = useState<AnswerForm[]>([{ content: '', isCorrect: false }]);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<QuestionFormErrors>({});
  const [saveFailed, setSaveFailed] = useState(false);

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
      setErrors({});
      setSaveFailed(false);
      tfDraftRef.current = null;
      if (initialValues) {
        const storedAnswers = initialValues.question_answers.map((a) => ({
          content: a.content,
          isCorrect: a.is_correct,
        }));
        setContent(initialValues.content);
        setType(initialValues.type);
        setExplanation(initialValues.explanation ?? '');
        setModelAnswer(initialValues.model_answer ?? '');
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
        setModelAnswer('');
        setTopicIds([]);
        setAnswers([{ content: '', isCorrect: false }]);
      }
    }
  }, [open, initialValues]);

  // Clear a stale inline message as soon as the user edits the form.
  useEffect(() => {
    setErrors({});
    setSaveFailed(false);
    // Every form field is listed on purpose: editing any of them must clear the stale error.
  }, [content, type, explanation, modelAnswer, answers, topicIds]);

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
    const fieldErrors = validateQuestionForm({ type, content, explanation, modelAnswer, answers });
    if (fieldErrors) {
      setErrors(fieldErrors);
      return;
    }

    setErrors({});
    setSaveFailed(false);
    setSubmitting(true);
    try {
      const result = await onSubmit({
        content: content.trim(),
        type,
        explanation: explanation.trim() || undefined,
        modelAnswer: modelAnswer.trim() || undefined,
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
      if (!result.saved) {
        if (result.errors) setErrors(result.errors);
        else setSaveFailed(true);
        return;
      }
      onOpenChange(false);
    } catch {
      // Callers catch and resolve with field errors, so this only guards a contract
      // violation — never leak the rejection as an unhandled one.
      setSaveFailed(true);
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
            {errors.content && <FieldError>{t(errors.content)}</FieldError>}
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
              {errors.answers && <FieldError>{t(errors.answers)}</FieldError>}
            </div>
          )}

          {type === 'open' ? (
            <div>
              <Label>{t('model_answer')}</Label>
              <Textarea
                value={modelAnswer}
                onChange={(e) => setModelAnswer(e.target.value)}
                placeholder={t('model_answer_placeholder')}
                rows={3}
                aria-invalid={!!errors.modelAnswer}
              />
              <p className="text-xs text-muted-foreground mt-1">{t('model_answer_hint')}</p>
              {errors.modelAnswer && <FieldError>{t(errors.modelAnswer)}</FieldError>}
            </div>
          ) : (
            <div>
              <Label>{t('explanation')}</Label>
              <Textarea
                value={explanation}
                onChange={(e) => setExplanation(e.target.value)}
                placeholder={t('explanation_placeholder')}
                rows={3}
                aria-invalid={!!errors.explanation}
              />
              <div className="mt-1 flex items-start justify-between gap-3">
                <p className="text-xs text-muted-foreground">{t('explanation_hint')}</p>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {t('char_count', {
                    count: explanation.length,
                    min: QUESTION_FORM_LIMITS.explanationMin,
                    max: QUESTION_FORM_LIMITS.explanationMax,
                  })}
                </span>
              </div>
              {errors.explanation && <FieldError>{t(errors.explanation)}</FieldError>}
            </div>
          )}

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
        {saveFailed && (
          <p className="text-sm font-medium text-destructive" role="alert">
            {t('save_failed')}
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
