'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ArrowRight, ArrowLeft, Send } from 'lucide-react';
import { toast } from 'sonner';
import { apiGet, apiPost } from '@/lib/api';
import { EntityNotFound } from '@/components/shared/entity-not-found';

interface Question {
  id: string;
  content: string;
  type: string;
  question_answers: Array<{ id: string; content: string; is_correct: boolean }>;
}

interface AttemptDetails {
  id: string;
  score: number;
  total_questions: number;
  completed_at: string | null;
  questions: Question[];
  answers: Record<string, { selected_answer_id: string | null; is_correct: boolean }>;
}

export default function QuizTakingPage() {
  const params = useParams();
  const router = useRouter();
  const attemptId = params.attemptId as string;

  const [attempt, setAttempt] = useState<AttemptDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string | undefined>>({});

  useEffect(() => {
    apiGet<AttemptDetails>(`/api/v1/quiz/${attemptId}`)
      .then((data) => {
        if (data.completed_at) {
          router.push(`/app/study/session/quiz/${attemptId}/review`);
          return;
        }
        setAttempt(data);
        setLoading(false);
      })
      .catch(() => {
        toast.error('Failed to load quiz');
        setLoading(false);
      });
  }, [attemptId, router]);

  async function submitQuiz() {
    if (!attempt) return;

    const quizAnswers = attempt.questions.map((q) => {
      const selectedAnswerId = answers[q.id];
      return {
        questionId: q.id,
        ...(selectedAnswerId ? { selectedAnswerId } : {}),
      };
    });

    try {
      await apiPost(`/api/v1/quiz/${attemptId}`, { answers: quizAnswers });
      router.push(`/app/study/session/quiz/${attemptId}/review`);
    } catch {
      toast.error('Failed to submit quiz');
    }
  }

  if (loading) return <div className="flex justify-center py-12">Loading...</div>;
  if (!attempt) return <EntityNotFound titleKey="quiz_not_found" descriptionKey="quiz_not_found_desc" />;

  const questions = attempt.questions;
  const currentQuestion = questions[currentQ];
  const progress = questions.length > 0 ? ((currentQ + 1) / questions.length) * 100 : 0;

  function selectAnswer(questionId: string, answerId: string) {
    setAnswers({ ...answers, [questionId]: answerId });
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex justify-end">
        <span className="text-sm text-muted-foreground">
          Question {currentQ + 1} of {questions.length}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <Progress value={progress} />
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Badge variant="outline">{currentQuestion.type.replace('_', ' ')}</Badge>
          </div>
          <CardTitle className="mt-3 text-xl">{currentQuestion.content}</CardTitle>
        </CardHeader>
        <CardContent>
          {currentQuestion.type === 'mcq' && (
            <RadioGroup
              value={answers[currentQuestion.id] || ''}
              onValueChange={(v) => selectAnswer(currentQuestion.id, v)}
            >
              {currentQuestion.question_answers.map((a) => (
                <div
                  key={a.id}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 hover:bg-accent/50"
                >
                  <RadioGroupItem value={a.id} id={a.id} />
                  <Label htmlFor={a.id} className="flex-1 cursor-pointer">
                    {a.content}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          )}
          {currentQuestion.type === 'true_false' && (
            <div className="grid grid-cols-2 gap-3">
              {currentQuestion.question_answers.map((a) => (
                <Button
                  key={a.id}
                  variant={answers[currentQuestion.id] === a.id ? 'default' : 'outline'}
                  className="h-20 text-lg"
                  onClick={() => selectAnswer(currentQuestion.id, a.id)}
                >
                  {a.content}
                </Button>
              ))}
            </div>
          )}
          {currentQuestion.type === 'open' && (
            <Textarea
              value={answers[currentQuestion.id] || ''}
              onChange={(e) => selectAnswer(currentQuestion.id, e.target.value)}
              placeholder="Type your answer..."
              rows={4}
            />
          )}
        </CardContent>
        <CardFooter className="flex justify-between">
          <Button
            variant="outline"
            disabled={currentQ === 0}
            onClick={() => setCurrentQ(currentQ - 1)}
          >
            <ArrowLeft data-icon="inline-start" /> Previous
          </Button>
          {currentQ < questions.length - 1 ? (
            <Button onClick={() => setCurrentQ(currentQ + 1)}>
              Next <ArrowRight data-icon="inline-end" />
            </Button>
          ) : (
            <Button onClick={submitQuiz}>
              Submit Quiz <Send data-icon="inline-end" />
            </Button>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
