'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Plus, Search, Pencil, Trash2, X } from 'lucide-react';

interface Question {
  id: string;
  content: string;
  type: string;
  difficulty: string;
  subject_id: string | null;
  explanation: string | null;
  question_answers: Array<{ id: string; content: string; is_correct: boolean; order_index: number }>;
  created_at: string;
}

interface Subject {
  id: string;
  name: string;
}

const DIFFICULTY_COLORS: Record<string, string> = {
  easy: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  hard: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
};

export default function QuestionsPage() {
  const t = useTranslations('EduQuestionsPage');
  const dl = useTranslations('DashboardLayout');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterDifficulty, setFilterDifficulty] = useState<string>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    content: '',
    type: 'mcq' as string,
    difficulty: 'medium' as string,
    explanation: '',
    subjectId: 'none',
    answers: [{ content: '', isCorrect: false }],
  });

  useEffect(() => {
    Promise.all([
      fetch('/api/v1/questions').then((r) => r.ok ? r.json() : []),
      fetch('/api/v1/subjects').then((r) => r.ok ? r.json() : []),
    ]).then(([q, s]) => {
      setQuestions(q);
      setSubjects(s);
      setLoading(false);
    }).catch(() => {
      setQuestions([]);
      setSubjects([]);
      setLoading(false);
    });
  }, []);

  const filtered = questions.filter((q) => {
    const matchesSearch = q.content.toLowerCase().includes(search.toLowerCase());
    const matchesType = filterType === 'all' || q.type === filterType;
    const matchesDiff = filterDifficulty === 'all' || q.difficulty === filterDifficulty;
    return matchesSearch && matchesType && matchesDiff;
  });

  function resetForm() {
    setFormData({ content: '', type: 'mcq', difficulty: 'medium', explanation: '', subjectId: 'none', answers: [{ content: '', isCorrect: false }] });
    setEditingQuestion(null);
  }

  function openCreate() {
    resetForm();
    setDialogOpen(true);
  }

  function openEdit(q: Question) {
    setEditingQuestion(q);
    setFormData({
      content: q.content,
      type: q.type,
      difficulty: q.difficulty,
      explanation: q.explanation || '',
      subjectId: q.subject_id || 'none',
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
    if (formData.type === 'mcq' && formData.answers.filter((a) => a.content.trim()).length < 2) {
      toast.error(t('mcq_min_answers'));
      return;
    }

    const payload = {
      content: formData.content,
      type: formData.type,
      difficulty: formData.difficulty,
      explanation: formData.explanation || undefined,
      subjectId: formData.subjectId === 'none' ? undefined : formData.subjectId,
      answers: formData.answers
        .filter((a) => a.content.trim())
        .map((a, i) => ({ content: a.content, isCorrect: a.isCorrect, orderIndex: i })),
    };

    try {
      const url = editingQuestion ? `/api/v1/questions/${editingQuestion.id}` : '/api/v1/questions';
      const method = editingQuestion ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      if (editingQuestion) {
        setQuestions(questions.map((q) => (q.id === data.id ? data : q)));
      } else {
        setQuestions([data, ...questions]);
      }
      setDialogOpen(false);
      resetForm();
      toast.success(editingQuestion ? t('updated') : t('created'));
    } catch {
      toast.error(t('save_failed'));
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      const res = await fetch(`/api/v1/questions/${deleteId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed');
      setQuestions(questions.filter((q) => q.id !== deleteId));
      toast.success(t('deleted'));
    } catch {
      toast.error(t('delete_failed'));
    }
    setDeleteId(null);
  }

  if (loading) return <div className="flex justify-center py-12">{dl('common_loading')}</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">{t('title')}</h2>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" /> {t('create_question')}
        </Button>
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t('search_placeholder')}
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder={t('type')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('all_types')}</SelectItem>
            <SelectItem value="mcq">{t('mcq')}</SelectItem>
            <SelectItem value="true_false">{t('true_false_label')}</SelectItem>
            <SelectItem value="open">{t('open_label')}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterDifficulty} onValueChange={setFilterDifficulty}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder={t('difficulty')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('all_difficulty')}</SelectItem>
            <SelectItem value="easy">{t('easy')}</SelectItem>
            <SelectItem value="medium">{t('medium')}</SelectItem>
            <SelectItem value="hard">{t('hard')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('question')}</TableHead>
              <TableHead>{t('type')}</TableHead>
              <TableHead>{t('difficulty')}</TableHead>
              <TableHead>{t('answers')}</TableHead>
              <TableHead className="text-right">{t('actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((q) => (
              <TableRow key={q.id}>
                <TableCell className="max-w-md truncate font-medium">{q.content}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{t(q.type === 'mcq' ? 'mcq' : q.type === 'true_false' ? 'true_false_label' : 'open_label')}</Badge>
                </TableCell>
                <TableCell>
                  <Badge className={DIFFICULTY_COLORS[q.difficulty]}>{q.difficulty}</Badge>
                </TableCell>
                <TableCell>{q.question_answers?.length ?? 0}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(q)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setDeleteId(q.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  {t('no_questions')}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingQuestion ? t('edit_title') : t('create_title')}</DialogTitle>
            <DialogDescription>
              {editingQuestion ? t('edit_desc') : t('create_desc')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>{t('subject')}</Label>
              <Select value={formData.subjectId} onValueChange={(v) => setFormData({ ...formData, subjectId: v })}>
                <SelectTrigger><SelectValue placeholder={t('select_subject')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('none')}</SelectItem>
                  {subjects.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t('question_type')}</Label>
              <Select value={formData.type} onValueChange={(v) => setFormData({ ...formData, type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="mcq">{t('multiple_choice')}</SelectItem>
                  <SelectItem value="true_false">{t('true_false')}</SelectItem>
                  <SelectItem value="open">{t('open_answer')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t('difficulty')}</Label>
              <Select value={formData.difficulty} onValueChange={(v) => setFormData({ ...formData, difficulty: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="easy">{t('easy')}</SelectItem>
                  <SelectItem value="medium">{t('medium')}</SelectItem>
                  <SelectItem value="hard">{t('hard')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t('question_content')}</Label>
              <Textarea
                value={formData.content}
                onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                placeholder={t('question_placeholder')}
                rows={3}
              />
            </div>
            {formData.type !== 'open' && (
              <div>
                <Label className="mb-2 block">{t('answers_label')}</Label>
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
                        placeholder={`${t('answer_placeholder')} ${i + 1}`}
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
                {formData.type === 'true_false' && formData.answers.length < 2 && (
                  <Button variant="outline" size="sm" className="mt-2" onClick={() => setFormData({ ...formData, answers: [...formData.answers, { content: formData.answers.length === 0 ? 'True' : 'False', isCorrect: formData.answers.length === 0 }] })}>
                    {t('generate_tf')}
                  </Button>
                )}
                <p className="text-xs text-muted-foreground mt-1">{t('correct_answer_hint')}</p>
              </div>
            )}
            <div>
              <Label>{t('explanation')}</Label>
              <Textarea
                value={formData.explanation}
                onChange={(e) => setFormData({ ...formData, explanation: e.target.value })}
                placeholder={t('explanation_placeholder')}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogOpen(false); resetForm(); }}>{t('cancel')}</Button>
            <Button onClick={handleSubmit}>{editingQuestion ? t('update') : t('create')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('delete_title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('delete_desc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{t('delete')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
