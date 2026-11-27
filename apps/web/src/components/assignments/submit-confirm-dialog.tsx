'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
} from '@studiq/ui';
import { useTranslations } from 'next-intl';

interface SubmitConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Positions (from 0) of the questions with no answer. */
  unanswered: number[];
  onJump: (index: number) => void;
  onConfirm: () => void;
}

/** The last step before a submission, which the student cannot undo (#1353). */
export function SubmitConfirmDialog({
  open,
  onOpenChange,
  unanswered,
  onJump,
  onConfirm,
}: SubmitConfirmDialogProps) {
  const t = useTranslations('AppAssignmentTakePage');

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('confirm_title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {unanswered.length > 0 && `${t('confirm_unanswered', { count: unanswered.length })} `}
            {t('confirm_final')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {unanswered.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {unanswered.map((index) => (
              <Button
                key={index}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  onJump(index);
                  onOpenChange(false);
                }}
              >
                {t('confirm_jump', { number: index + 1 })}
              </Button>
            ))}
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>{t('confirm_back')}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            {unanswered.length > 0 ? t('confirm_submit_anyway') : t('confirm_submit')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
