'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, X } from 'lucide-react';
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api';

interface Question {
  id: string;
  content: string;
  type: string;
  difficulty: string;
  explanation: string | null;
  question_answers: Array<{ id: string; content: string; is_correct: boolean }>;
  created_at: string;
}

const DIFFICULTY_COLORS: Record<string, string> = {
  easy: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  hard: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
};

export default function MyQuestionsPage() {
  const t = useTranslations('AppMyQuestionsPage');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Question | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    content: '',
    type: 'mcq',
    difficulty: 'medium',
    explanation: '',
    answers: [{ content: '', isCorrect: false }],
  });

  useEffect(() => {
    apiGet<Question[]>('/api/v1/questions')
      .then((data) => {
        setQuestions(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  function resetForm() {
    setFormData({
      content: '',
      type: 'mcq',
      difficulty: 'medium',
      explanation: '',
      answers: [{ content: '', isCorrect: false }],
    });
    setEditing(null);
  }

  function openCreate() {
    resetForm();
    setDialogOpen(true);
  }

  function openEdit(q: Question) {
    setEditing(q);
    setFormData({
      content: q.content,
      type: q.type,
      difficulty: q.difficulty,
      explanation: q.explanation || '',
      answers: q.question_answers.map((a) => ({ content: a.content, isCorrect: a.is_correct })),
    });
    setDialogOpen(true);
  }

  function addAnswer() {
    setFormData({ ...formData, answers: [...formData.answers, { content: '', isCorrect: false }] });
  }

  function removeAnswer(index: number) {
    setFormData({ ...formData, answers: formData.answers.filter((_, i) => i !== index) });
  }

  function updateAnswer(index: number, field: string, value: string | boolean) {
    const newAnswers = [...formData.answers];
    if (field === 'isCorrect' && value === true) {
      newAnswers.forEach((a, i) => {
        if (i !== index) a.isCorrect = false;
      });
    }
    newAnswers[index] = { ...newAnswers[index], [field]: value };
    setFormData({ ...formData, answers: newAnswers });
  }

  async function handleSubmit() {
    if (!formData.content.trim()) {
      toast.error(t('content_required'));
      return;
    }
    const payload = {
      content: formData.content,
      type: formData.type,
      difficulty: formData.difficulty,
      explanation: formData.explanation || undefined,
      answers: formData.answers
        .filter((a) => a.content.trim())
        .map((a, i) => ({ content: a.content, isCorrect: a.isCorrect, orderIndex: i })),
    };
    try {
      let data: Question;
      if (editing) {
        data = await apiPut<Question>(`/api/v1/questions/${editing.id}`, payload);
        setQuestions(questions.map((q) => (q.id === data.id ? data : q)));
      } else {
        data = await apiPost<Question>('/api/v1/questions', payload);
        setQuestions([data, ...questions]);
      }
      setDialogOpen(false);
      resetForm();
      toast.success(editing ? t('question_updated') : t('question_created'));
    } catch {
      toast.error(t('save_failed'));
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      await apiDelete(`/api/v1/questions/${deleteId}`);
      setQuestions(questions.filter((q) => q.id !== deleteId));
      toast.success(t('question_deleted'));
    } catch {
      toast.error(t('delete_failed'));
    }
    setDeleteId(null);
  }

  if (loading) return <div className="flex justify-center py-12">{t('common_loading')}</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">{t('title')}</h2>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" /> {t('create_question')}
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {questions.map((q) => (
          <Card key={q.id} className="group">
            <CardContent className="pt-6">
              <div className="flex items-start justify-between">
                <div className="space-y-2 flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{q.content}</p>
                  <div className="flex gap-2">
                    <Badge variant="secondary">{q.type.replace('_', ' ')}</Badge>
                    <Badge className={DIFFICULTY_COLORS[q.difficulty]}>{q.difficulty}</Badge>
                  </div>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => openEdit(q)}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setDeleteId(q.id)}
                  >
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {questions.length === 0 && (
          <div className="col-span-full text-center py-12 text-muted-foreground">
            {t('no_questions')}
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? t('edit_title') : t('create_title')}</DialogTitle>
            <DialogDescription>
              {editing ? t('edit_desc') : t('create_desc')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>{t('question_type_label')}</Label>
              <Select
                value={formData.type}
                onValueChange={(v) => setFormData({ ...formData, type: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mcq">{t('type_mcq')}</SelectItem>
                  <SelectItem value="true_false">{t('type_true_false')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t('difficulty_label')}</Label>
              <Select
                value={formData.difficulty}
                onValueChange={(v) => setFormData({ ...formData, difficulty: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="easy">{t('diff_easy')}</SelectItem>
                  <SelectItem value="medium">{t('diff_medium')}</SelectItem>
                  <SelectItem value="hard">{t('diff_hard')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t('question_label')}</Label>
              <Textarea
                value={formData.content}
                onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                placeholder={t('question_placeholder')}
                rows={3}
              />
            </div>
            <div>
              <Label>{t('answers_label')}</Label>
              <div className="space-y-2">
                {formData.answers.map((a, i) => (
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
                    {formData.answers.length > 1 && (
                      <Button variant="ghost" size="icon" onClick={() => removeAnswer(i)}>
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              {formData.type === 'mcq' && (
                <Button variant="outline" size="sm" className="mt-2" onClick={addAnswer}>
                  <Plus className="mr-1 h-3 w-3" /> {t('add_answer')}
                </Button>
              )}
            </div>
            <div>
              <Label>{t('explanation_label')}</Label>
              <Textarea
                value={formData.explanation}
                onChange={(e) => setFormData({ ...formData, explanation: e.target.value })}
                placeholder={t('explanation_placeholder')}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDialogOpen(false);
                resetForm();
              }}
            >
              {t('common_cancel')}
            </Button>
            <Button onClick={handleSubmit}>{editing ? t('common_update') : t('common_create')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('delete_dialog_title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('delete_dialog_desc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common_cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground"
            >
              {t('common_delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
