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

type ReportQuestionDialogProps = {
  /** Controlled mode: hides the built-in flag-icon trigger, caller drives open state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
} & ({ questionId: string; groupId?: never } | { groupId: string; questionId?: never });

export function ReportQuestionDialog({
  questionId,
  groupId,
  open: controlledOpen,
  onOpenChange,
}: ReportQuestionDialogProps) {
  const t = useTranslations('QuestionReports');
  const isControlled = controlledOpen !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = isControlled ? (onOpenChange ?? (() => {})) : setUncontrolledOpen;
  const [message, setMessage] = useState('');

  const reportUrl = questionId
    ? `/api/v1/questions/${questionId}/reports`
    : `/api/v1/organization/groups/${groupId}/reports`;

  const submit = useApiMutation<unknown, string>({
    mutationFn: (body) => apiPost(reportUrl, { message: body }),
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
      {!isControlled && (
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
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t(questionId ? 'report_dialog_title' : 'report_dialog_title_group')}
          </DialogTitle>
          <DialogDescription>
            {t(questionId ? 'report_dialog_description' : 'report_dialog_description_group')}
          </DialogDescription>
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
