'use client';

import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { useApiQuery } from '@/hooks/use-api';
import { assignmentKeys } from '@/lib/query-keys';

interface PrintData {
  id: string;
  title: string;
  description: string | null;
  total_points: number;
  assignment_questions: Array<{
    id: string;
    order_index: number | null;
    points: number;
    question: {
      id: string;
      content: string;
      type: string;
      question_answers: Array<{
        id: string;
        content: string;
        is_correct: boolean;
      }>;
    };
  }>;
}

export default function PrintAssignmentClient() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations('EduAssignmentPrintPage');

  const { data: assignment } = useApiQuery<PrintData>({
    queryKey: assignmentKeys.detail(id),
    url: `/api/v1/teacher/assignments/${id}`,
  });

  useEffect(() => {
    const timer = setTimeout(() => window.print(), 500);
    return () => clearTimeout(timer);
  }, []);

  if (!assignment) return null;

  const questions = assignment.assignment_questions ?? [];

  return (
    <div className="print-container">
      <style>{`
        @page { margin: 20mm 15mm; }
        @media print {
          body { font-family: serif; font-size: 12pt; line-height: 1.5; color: #000; }
          .print-container { max-width: 100%; padding: 0; }
          .no-print { display: none !important; }
          .question-block { page-break-inside: avoid; margin-bottom: 2em; }
          .answer-line { border-bottom: 1px solid #000; height: 1.5em; margin-top: 0.5em; }
          .answer-bubbles { display: flex; gap: 2em; margin-top: 0.5em; }
          .bubble { display: inline-flex; align-items: center; gap: 0.3em; }
          .bubble-circle { width: 14px; height: 14px; border: 1.5px solid #000; border-radius: 50%; display: inline-block; }
          .checkbox-box { width: 14px; height: 14px; border: 1.5px solid #000; display: inline-block; }
          .answer-key { page-break-before: always; }
          .answer-key .correct { color: #070; font-weight: bold; }
        }
        @media screen {
          .print-container { max-width: 800px; margin: 2em auto; padding: 2em; font-family: serif; font-size: 12pt; line-height: 1.6; }
          .no-print { margin-bottom: 2em; }
        }
      `}</style>

      <div className="no-print">
        <p className="text-sm text-muted-foreground">{t('print_hint')}</p>
      </div>

      <div className="text-center mb-8">
        <h1 className="text-xl font-bold">{assignment.title}</h1>
        {assignment.description && <p className="text-sm mt-1">{assignment.description}</p>}
        <p className="text-sm mt-4">{t('total', { points: assignment.total_points })}</p>
      </div>

      <div className="flex gap-8 mb-8">
        <div>
          <span className="font-medium">{t('name')}:</span> _______________________________
        </div>
        <div>
          <span className="font-medium">{t('class')}:</span> _______________________________
        </div>
        <div>
          <span className="font-medium">{t('date')}:</span> _______________________________
        </div>
      </div>

      {questions.map((aq, i) => {
        const q = aq.question;
        const isMcq = q.type === 'mcq';
        const isTf = q.type === 'true_false';
        const isOpen = q.type === 'open';

        return (
          <div key={aq.id} className="question-block">
            <p className="font-medium mb-2">
              {i + 1}. {q.content}
              <span className="text-xs ml-2 font-normal">
                {t(aq.points !== 1 ? 'pts_plural' : 'pts_single', { count: aq.points })}
              </span>
            </p>

            {isMcq && q.question_answers && (
              <div className="answer-bubbles">
                {q.question_answers.map((ans) => (
                  <div key={ans.id} className="bubble">
                    <span className="bubble-circle" />
                    <span>{ans.content}</span>
                  </div>
                ))}
              </div>
            )}

            {isTf && q.question_answers && (
              <div className="answer-bubbles">
                {q.question_answers.map((ans) => (
                  <div key={ans.id} className="bubble">
                    <span className="checkbox-box" />
                    <span>{ans.content}</span>
                  </div>
                ))}
              </div>
            )}

            {isOpen && (
              <div>
                {Array.from({ length: 3 }).map((_, line) => (
                  <div key={line} className="answer-line" />
                ))}
              </div>
            )}
          </div>
        );
      })}

      <div className="answer-key">
        <h2 className="text-lg font-bold mb-4">{t('answer_key')}</h2>
        {questions.map((aq, i) => {
          const q = aq.question;
          const correctAnswers = q.question_answers?.filter((a) => a.is_correct) ?? [];

          return (
            <p key={aq.id} className="mb-2">
              {i + 1}.{' '}
              {correctAnswers.length > 0
                ? correctAnswers.map((a) => a.content).join(', ')
                : t('open_question')}
            </p>
          );
        })}
      </div>
    </div>
  );
}
