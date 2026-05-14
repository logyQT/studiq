'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Plus, Play, Eye } from 'lucide-react';
import { toast } from 'sonner';

interface QuizAttempt {
  id: string;
  score: number;
  total_questions: number;
  config: {
    subjectId?: string;
    questionTypes?: string[];
    difficulty?: string;
    questionCount?: number;
  } | null;
  started_at: string;
  completed_at: string | null;
}

interface Subject {
  id: string;
  name: string;
}

export default function QuizPage() {
  const router = useRouter();
  const [attempts, setAttempts] = useState<QuizAttempt[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [formData, setFormData] = useState({
    subjectId: 'none',
    questionTypes: ['mcq'] as string[],
    difficulty: 'mixed',
    questionCount: 10,
  });

  useEffect(() => {
    Promise.all([
      fetch('/api/v1/quiz-attempts').then((r) => (r.ok ? r.json() : [])),
      fetch('/api/v1/subjects').then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([a, s]) => {
        setAttempts(a);
        setSubjects(s);
        setLoading(false);
      })
      .catch(() => {
        setAttempts([]);
        setSubjects([]);
        setLoading(false);
      });
  }, []);

  function toggleQuestionType(type: string) {
    setFormData((prev) => ({
      ...prev,
      questionTypes: prev.questionTypes.includes(type)
        ? prev.questionTypes.filter((t) => t !== type)
        : [...prev.questionTypes, type],
    }));
  }

  async function generateQuiz() {
    if (formData.questionTypes.length === 0) {
      toast.error('Select at least one question type');
      return;
    }

    const body: Record<string, unknown> = {
      questionTypes: formData.questionTypes,
      difficulty: formData.difficulty,
      questionCount: formData.questionCount,
    };

    if (formData.subjectId !== 'none') {
      body.subjectId = formData.subjectId;
    }

    try {
      const res = await fetch('/api/v1/quizzes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Failed to generate quiz');
      }

      const data = await res.json();
      setModalOpen(false);
      router.push(`/app/quiz/${data.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to generate quiz');
    }
  }

  if (loading) return <div className="flex justify-center py-12">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Practice Quizzes</h2>
        <Button onClick={() => setModalOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> New Quiz
        </Button>
      </div>

      {attempts.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground mb-4">
              No quiz attempts yet. Generate your first practice quiz!
            </p>
            <Button onClick={() => setModalOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Generate Quiz
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {attempts.map((attempt) => {
            const percentage =
              attempt.total_questions > 0
                ? Math.round((attempt.score / attempt.total_questions) * 100)
                : 0;
            const isCompleted = attempt.completed_at !== null;

            return (
              <Card key={attempt.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">Practice Quiz</CardTitle>
                    {isCompleted ? (
                      <Badge variant={percentage >= 70 ? 'default' : 'destructive'}>
                        {percentage}%
                      </Badge>
                    ) : (
                      <Badge variant="secondary">In Progress</Badge>
                    )}
                  </div>
                  <CardDescription>
                    {new Date(attempt.started_at).toLocaleDateString()}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span>{attempt.total_questions} questions</span>
                    {attempt.config?.difficulty && (
                      <>
                        <span>·</span>
                        <Badge variant="outline" className="text-xs">
                          {attempt.config.difficulty}
                        </Badge>
                      </>
                    )}
                  </div>
                </CardContent>
                <CardFooter>
                  {isCompleted ? (
                    <Link href={`/app/quiz/review/${attempt.id}`} className="w-full">
                      <Button variant="outline" className="w-full">
                        <Eye className="mr-2 h-4 w-4" /> Review
                      </Button>
                    </Link>
                  ) : (
                    <Link href={`/app/quiz/${attempt.id}`} className="w-full">
                      <Button className="w-full">
                        <Play className="mr-2 h-4 w-4" /> Resume
                      </Button>
                    </Link>
                  )}
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Generate New Quiz</DialogTitle>
            <DialogDescription>Customize your practice quiz settings</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>Subject (optional)</Label>
              <Select
                value={formData.subjectId}
                onValueChange={(v) => setFormData({ ...formData, subjectId: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All subjects" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">All Subjects</SelectItem>
                  {subjects.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Question Types</Label>
              <div className="space-y-2 mt-2">
                {[
                  { value: 'mcq', label: 'Multiple Choice' },
                  { value: 'true_false', label: 'True/False' },
                  { value: 'open', label: 'Open Answer' },
                ].map((type) => (
                  <div key={type.value} className="flex items-center gap-3 p-2 rounded-lg border">
                    <Checkbox
                      checked={formData.questionTypes.includes(type.value)}
                      onCheckedChange={() => toggleQuestionType(type.value)}
                    />
                    <Label className="cursor-pointer flex-1">{type.label}</Label>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <Label>Difficulty</Label>
              <Select
                value={formData.difficulty}
                onValueChange={(v) => setFormData({ ...formData, difficulty: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mixed">Mixed</SelectItem>
                  <SelectItem value="easy">Easy</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="hard">Hard</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Number of Questions: {formData.questionCount}</Label>
              <input
                type="range"
                min={1}
                max={50}
                value={formData.questionCount}
                onChange={(e) =>
                  setFormData({ ...formData, questionCount: parseInt(e.target.value) })
                }
                className="w-full mt-2"
              />
              <div className="flex justify-between text-xs text-muted-foreground mt-1">
                <span>1</span>
                <span>50</span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={generateQuiz}>Generate Quiz</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
