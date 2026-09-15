'use client';

import { Button, Card, Textarea, UserAvatar } from '@studiq/ui';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Send } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { useApiMutation, useApiQuery } from '@/hooks/use-api';
import { apiPost } from '@/lib/api';
import { questionReportKeys } from '@/lib/query-keys';
import { cn } from '@/lib/utils';

interface Message {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
  sender: { id: string; full_name: string | null; email: string } | null;
}

interface ReportDetail {
  report: {
    id: string;
    reported_by: string;
    teacher_id: string;
    question: { id: string; content: string } | null;
    reporter: { id: string; full_name: string | null; email: string } | null;
    teacher: { id: string; full_name: string | null; email: string } | null;
  };
  messages: Message[];
}

export function ReportThreadScreen({ reportId, basePath }: { reportId: string; basePath: string }) {
  const t = useTranslations('QuestionReports');
  const { user } = useAuth();
  const [reply, setReply] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useApiQuery<ReportDetail>({
    queryKey: questionReportKeys.detail(reportId),
    url: `/api/v1/question-reports/${reportId}`,
  });

  const send = useApiMutation<Message, string>({
    mutationFn: (body) => apiPost(`/api/v1/question-reports/${reportId}/messages`, { body }),
    invalidateKeys: [
      questionReportKeys.detail(reportId),
      questionReportKeys.all,
      questionReportKeys.unreadCount,
    ],
  });

  const queryClient = useQueryClient();

  useEffect(() => {
    apiPost(`/api/v1/question-reports/${reportId}/read`, {})
      .then(() => {
        queryClient.invalidateQueries({ queryKey: questionReportKeys.all });
        queryClient.invalidateQueries({ queryKey: questionReportKeys.unreadCount });
      })
      .catch(() => {});
  }, [reportId, queryClient]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: message count is an intentional scroll trigger
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [data?.messages.length]);

  if (isLoading || !data) {
    return <div className="p-8 text-center text-muted-foreground">{t('common_loading')}</div>;
  }

  const { report, messages } = data;
  const counterpart = report.reported_by === user?.id ? report.teacher : report.reporter;

  function handleSend() {
    if (!reply.trim()) return;
    send.mutate(reply, { onSuccess: () => setReply('') });
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] max-w-2xl">
      <div className="flex items-center gap-3 pb-4 border-b">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`${basePath}/reports`}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <UserAvatar name={counterpart?.full_name} email={counterpart?.email} size={36} />
        <div className="min-w-0">
          <p className="font-medium text-sm">{counterpart?.full_name || counterpart?.email}</p>
          <p className="text-xs text-muted-foreground truncate">{report.question?.content}</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-4 space-y-3">
        {messages.map((msg) => {
          const isMine = msg.sender_id === user?.id;
          return (
            <div key={msg.id} className={cn('flex', isMine ? 'justify-end' : 'justify-start')}>
              <Card
                className={cn(
                  'max-w-[75%] p-3',
                  isMine ? 'bg-primary text-primary-foreground' : 'bg-muted',
                )}
              >
                <p className="text-sm whitespace-pre-wrap">{msg.body}</p>
                <p className="text-[10px] opacity-70 mt-1">
                  {new Date(msg.created_at).toLocaleString()}
                </p>
              </Card>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="flex items-end gap-2 pt-3 border-t">
        <Textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder={t('reply_placeholder')}
          rows={2}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        <Button size="icon" onClick={handleSend} disabled={!reply.trim() || send.isPending}>
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
