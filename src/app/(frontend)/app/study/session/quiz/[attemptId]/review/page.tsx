'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { toast } from 'sonner';
import { apiGet } from '@/lib/api';
import { EntityNotFound } from '@/components/shared/entity-not-found';
import { Eye } from 'lucide-react';

interface Question {
  id: string;
  content: string;
  type: string;
  explanation?: string | null;
  question_answers: Array<{ id: string; content: string; is_correct: boolean }>;
}

interface AttemptDetails {
  id: string;
  score: number;
  total_questions: number;
  config: {
    subjectId?: string;
    questionTypes?: string[];
    questionCount?: number;
  } | null;
  started_at: string;
  completed_at: string | null;
  questions: Question[];
  answers: Record<string, { selected_answer_id: string | null; is_correct: boolean }>;
}

export default function QuizReviewPage() {
  const params = useParams();
  const attemptId = params.attemptId as string;

  const [attempt, setAttempt] = useState<AttemptDetails | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<AttemptDetails>(`/api/v1/quiz/${attemptId}`)
      .then((data) => {
        setAttempt(data);
        setLoading(false);
      })
      .catch(() => {
        toast.error('Failed to load attempt');
        setLoading(false);
      });
  }, [attemptId]);

  if (loading) return <div className="flex justify-center py-12">Loading...</div>;
  if (!attempt) return <EntityNotFound titleKey="attempt_not_found" descriptionKey="attempt_not_found_desc" />;

  const percentage = Math.round((attempt.score / attempt.total_questions) * 100);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Quiz Review</h2>
        <Link href="/app/study">
          <Button variant="outline" size="sm">
            <Eye data-icon="inline-start" /> Back to Study
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-3xl">Score: {percentage}%</CardTitle>
          <CardDescription>
            {attempt.score} out of {attempt.total_questions} correct
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <span>{new Date(attempt.started_at).toLocaleDateString()}</span>
            </span>

          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4">
        {attempt.questions.map((q, i) => {
          const userAnswer = attempt.answers[q.id];
          const isCorrect = userAnswer?.is_correct ?? false;
          const correctAnswer = q.question_answers.find((a) => a.is_correct);
          const selectedAnswer = q.question_answers.find(
            (a) => a.id === userAnswer?.selected_answer_id,
          );

          return (
            <Card key={q.id}>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">Q{i + 1}</Badge>
                  <Badge variant="outline">{q.type.replace('_', ' ')}</Badge>
                  <Badge variant={isCorrect ? 'default' : 'destructive'} className="ml-auto">
                    {isCorrect ? 'Correct' : 'Incorrect'}
                  </Badge>
                </div>
                <CardTitle className="mt-2 text-lg">{q.content}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {q.type === 'mcq' && (
                  <div className="flex flex-col gap-2">
                    {q.question_answers.map((a) => {
                      const isCorrectAnswer = a.is_correct;
                      const isSelected = a.id === userAnswer?.selected_answer_id;
                      return (
                        <div
                          key={a.id}
                          data-correct={isCorrectAnswer}
                          data-selected={isSelected && !isCorrectAnswer}
                          className="rounded-lg border p-3 data-[correct=true]:border-green-200 data-[correct=true]:bg-green-50 data-[selected=true]:border-red-200 data-[selected=true]:bg-red-50"
                        >
                          <div className="flex items-center gap-2">
                            {isCorrectAnswer && (
                              <span className="font-medium text-green-600">✓</span>
                            )}
                            {isSelected && !isCorrectAnswer && (
                              <span className="font-medium text-red-600">✗</span>
                            )}
                            <span
                              className={
                                isSelected && !isCorrectAnswer
                                  ? 'text-muted-foreground line-through'
                                  : ''
                              }
                            >
                              {a.content}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {q.type === 'true_false' && (
                  <div className="grid grid-cols-2 gap-3">
                    {q.question_answers.map((a) => {
                      const isCorrectAnswer = a.is_correct;
                      const isSelected = a.id === userAnswer?.selected_answer_id;
                      return (
                        <Button
                          key={a.id}
                          variant={
                            isCorrectAnswer ? 'default' : isSelected ? 'destructive' : 'outline'
                          }
                          className="h-16 text-lg"
                          disabled
                        >
                          {a.content}
                        </Button>
                      );
                    })}
                  </div>
                )}
                {q.type === 'open' && (
                  <div className="flex flex-col gap-2">
                    <div className="rounded-lg border bg-muted p-3">
                      <span className="text-sm text-muted-foreground">Your answer: </span>
                      <span className="font-medium">
                        {selectedAnswer?.content || '(no answer)'}
                      </span>
                    </div>
                    <div className="rounded-lg border bg-green-50 p-3">
                      <span className="text-sm text-green-600">Correct answer: </span>
                      <span className="font-medium">{correctAnswer?.content || '(N/A)'}</span>
                    </div>
                  </div>
                )}
                {q.explanation && (
                  <div className="rounded-lg border bg-blue-50 p-3 text-sm">
                    <span className="font-medium">Explanation: </span>
                    {q.explanation}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
