'use client';

import { Flag } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useApiMutation } from '@/hooks/use-api';
import { apiPost } from '@/lib/api';
import { questionReportKeys } from '@/lib/query-keys';

export function ReportQuestionDialog({ questionId }: { questionId: string }) {
  const t = useTranslations('QuestionReports');
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');

  const submit = useApiMutation<unknown, string>({
    mutationFn: (body) => apiPost(`/api/v1/questions/${questionId}/reports`, { message: body }),
    invalidateKeys: [questionReportKeys.all, questionReportKeys.unreadCount],
  });

  function handleSubmit() {
    if (!message.trim()) return;
    submit.mutate(message, {
      onSuccess: () => {
        toast.success(t('report_sent'));
        setMessage('');
        setOpen(false);
      },
      onError: () => toast.error(t('report_error')),
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="icon"
        title={t('report_button_title')}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <Flag className="h-4 w-4" />
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('report_dialog_title')}</DialogTitle>
          <DialogDescription>{t('report_dialog_description')}</DialogDescription>
        </DialogHeader>
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t('report_message_placeholder')}
          rows={5}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {t('cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={!message.trim() || submit.isPending}>
            {t('send')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
