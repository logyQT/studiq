'use client';

import { Plus, X } from 'lucide-react';
import type { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { Question } from '@/server/models';

interface AnswerForm {
  content: string;
  isCorrect: boolean;
}

interface QuestionFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialValues: Question | null;
  bankId: string;
  onSubmit: (data: {
    content: string;
    type: string;
    explanation?: string;
    topicIds?: string[];
    bankIds: string[];
    answers: { content: string; isCorrect: boolean; orderIndex: number }[];
  }) => Promise<void>;
  t: ReturnType<typeof useTranslations>;
}

const _QUESTION_TYPES = ['mcq', 'true_false', 'open'] as const;

export function QuestionFormDialog({
  open,
  onOpenChange,
  initialValues,
  bankId,
  onSubmit,
  t,
}: QuestionFormDialogProps) {
  const [content, setContent] = useState('');
  const [type, setType] = useState<string>('mcq');
  const [explanation, setExplanation] = useState('');
  const [answers, setAnswers] = useState<AnswerForm[]>([{ content: '', isCorrect: false }]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      if (initialValues) {
        setContent(initialValues.content);
        setType(initialValues.type);
        setExplanation(initialValues.explanation ?? '');
        setAnswers(
          (initialValues.question_answers ?? []).map((a) => ({
            content: a.content,
            isCorrect: a.is_correct,
          })),
        );
      } else {
        setContent('');
        setType('mcq');
        setExplanation('');
        setAnswers([{ content: '', isCorrect: false }]);
      }
    }
  }, [open, initialValues]);

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

  function generateTrueFalse() {
    setAnswers([
      { content: t('tf_true'), isCorrect: true },
      { content: t('tf_false'), isCorrect: false },
    ]);
  }

  async function handleSubmit() {
    if (!content.trim()) {
      return;
    }
    if (type === 'mcq' && answers.filter((a) => a.content.trim()).length < 2) {
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        content: content.trim(),
        type,
        explanation: explanation.trim() || undefined,
        topicIds: [],
        bankIds: [bankId],
        answers: answers
          .filter((a) => a.content.trim())
          .map((a, i) => ({
            content: a.content.trim(),
            isCorrect: a.isCorrect,
            orderIndex: i,
          })),
      });
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

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
            <Select value={type} onValueChange={setType}>
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
                    {answers.length > 1 && (
                      <Button variant="ghost" size="icon" onClick={() => removeAnswer(i)}>
                        <X className="h-4 w-4" />
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
              {type === 'true_false' && answers.length < 2 && (
                <Button variant="outline" size="sm" className="mt-2" onClick={generateTrueFalse}>
                  {t('generate_tf')}
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
        </div>
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
