'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { apiGet } from '@/lib/api';
import { EntityNotFound } from '@/components/shared/entity-not-found';

interface Question {
  id: string;
  content: string;
  type: string;
  difficulty: string;
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
    difficulty?: string;
    questionCount?: number;
  } | null;
  started_at: string;
  completed_at: string | null;
  questions: Question[];
  answers: Record<string, { selected_answer_id: string | null; is_correct: boolean }>;
}

function getDifficultyColor(difficulty: string) {
  switch (difficulty) {
    case 'easy':
      return '#10b981';
    case 'medium':
      return '#f59e0b';
    case 'hard':
      return '#ef4444';
    default:
      return '#6b7280';
  }
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
    <div className="max-w-3xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold">Quiz Review</h2>

      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-3xl">Score: {percentage}%</CardTitle>
          <CardDescription>
            {attempt.score} out of {attempt.total_questions} correct
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 text-sm text-muted-foreground justify-center">
            <span className="flex items-center gap-1">
              <span>{new Date(attempt.started_at).toLocaleDateString()}</span>
            </span>
            {attempt.config?.difficulty && (
              <Badge
                variant="outline"
                style={{ borderColor: getDifficultyColor(attempt.config.difficulty) }}
              >
                {attempt.config.difficulty}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {attempt.questions.map((q, i) => {
          const userAnswer = attempt.answers[q.id];
          const isCorrect = userAnswer?.is_correct ?? false;
          const correctAnswer = q.question_answers.find((a) => a.is_correct);
          const selectedAnswer = q.question_answers.find(
            (a) => a.id === userAnswer?.selected_answer_id,
          );

          return (
            <Card
              key={q.id}
              className={
                isCorrect
                  ? 'border-green-200 dark:border-green-800'
                  : 'border-red-200 dark:border-red-800'
              }
            >
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">Q{i + 1}</Badge>
                  <Badge variant="outline">{q.type.replace('_', ' ')}</Badge>
                  <Badge
                    variant="secondary"
                    style={{ backgroundColor: getDifficultyColor(q.difficulty), color: 'white' }}
                  >
                    {q.difficulty}
                  </Badge>
                  <Badge variant={isCorrect ? 'default' : 'destructive'} className="ml-auto">
                    {isCorrect ? 'Correct' : 'Incorrect'}
                  </Badge>
                </div>
                <CardTitle className="text-lg mt-2">{q.content}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {q.type === 'mcq' && (
                  <div className="space-y-2">
                    {q.question_answers.map((a) => {
                      const isCorrectAnswer = a.is_correct;
                      const isSelected = a.id === userAnswer?.selected_answer_id;
                      return (
                        <div
                          key={a.id}
                          className={`p-3 rounded-lg border ${
                            isCorrectAnswer
                              ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                              : isSelected
                                ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                                : 'border-border'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            {isCorrectAnswer && (
                              <span className="text-green-600 font-medium">✓</span>
                            )}
                            {isSelected && !isCorrectAnswer && (
                              <span className="text-red-600 font-medium">✗</span>
                            )}
                            <span
                              className={
                                isSelected && !isCorrectAnswer
                                  ? 'line-through text-muted-foreground'
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
                  <div className="space-y-2">
                    <div className="p-3 rounded-lg border bg-muted">
                      <span className="text-sm text-muted-foreground">Your answer: </span>
                      <span className="font-medium">
                        {selectedAnswer?.content || '(no answer)'}
                      </span>
                    </div>
                    <div className="p-3 rounded-lg border bg-green-50 dark:bg-green-900/20">
                      <span className="text-sm text-green-600">Correct answer: </span>
                      <span className="font-medium">{correctAnswer?.content || '(N/A)'}</span>
                    </div>
                  </div>
                )}
                {q.explanation && (
                  <div className="p-3 rounded-lg border bg-blue-50 dark:bg-blue-900/20 text-sm">
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
