'use client';

import { Alert, AlertDescription, AlertTitle, Button } from '@studiq/ui';
import { AlertCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

interface ChatErrorAlertProps {
  /** App error code parsed from the transport error, `null` for plain/network failures. */
  errorCode: string | null;
  onRetry: () => void;
  onDismiss: () => void;
}

/**
 * Surfaces a failed send instead of swallowing it (#375). The daily token
 * budget and the per-user rate limiter both answer with a 429, which used to
 * leave the user message sitting in the transcript with no explanation.
 */
export function ChatErrorAlert({ errorCode, onRetry, onDismiss }: ChatErrorAlertProps) {
  const t = useTranslations('AiChatPage');
  const tErr = useTranslations('Errors');
  const router = useRouter();

  const isUsageLimit = errorCode === 'USAGE_LIMIT_EXCEEDED';
  const description = isUsageLimit
    ? t('error_usage_limit')
    : errorCode === 'RATE_LIMITED'
      ? tErr('ERROR_RATE_LIMITED')
      : t('error_generic');

  return (
    <Alert variant="destructive">
      <AlertCircle />
      <AlertTitle>{t('error_title')}</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
      <div className="col-span-full flex flex-wrap gap-2 pt-1">
        {isUsageLimit ? (
          <Button variant="outline" size="sm" onClick={() => router.push('/pricing')}>
            {t('locked_cta')}
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={onRetry}>
            {t('error_retry')}
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          {t('error_dismiss')}
        </Button>
      </div>
    </Alert>
  );
}
