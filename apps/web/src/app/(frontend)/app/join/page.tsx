'use client';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '@studiq/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, LogIn } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { featureKeys, permissionKeys, questionReportKeys } from '@/lib/query-keys';

export default function AppJoinPage() {
  const t = useTranslations('AppJoinPage');
  const router = useRouter();
  const queryClient = useQueryClient();
  const [token, setToken] = useState('');
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token.trim()) return;

    setIsPending(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/organization/invites/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim() }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        // 429 USAGE_LIMIT_EXCEEDED: the code is valid but the org has no free seat (#240).
        if (err.error === 'USAGE_LIMIT_EXCEEDED' || err.error === 'ERROR_USAGE_LIMIT_EXCEEDED') {
          toast.error(t('org_full'));
          setError(t('org_full'));
          return;
        }
        throw new Error(err.error || 'Invalid token');
      }

      // The accept route already set the `active_org_id` cookie, so only client
      // state is stale. Refresh it in place instead of a hard reload, which
      // destroyed the toast before it painted (#316). Same pattern as setup/org.
      toast.success(t('success'));
      setToken('');
      await queryClient.invalidateQueries({ queryKey: ['orgs'], refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: permissionKeys.all });
      queryClient.invalidateQueries({ queryKey: featureKeys.all });
      queryClient.invalidateQueries({ queryKey: questionReportKeys.all });
      router.refresh();
    } catch {
      toast.error(t('invalid_token'));
      // The toast is transient; keep the failure visible next to the field.
      setError(t('invalid_token'));
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="max-w-md mx-auto pt-20">
      <Card>
        <CardHeader className="text-center">
          <div className="mx-auto rounded-full bg-primary/10 p-3 w-fit mb-4">
            <LogIn className="size-6 text-primary" />
          </div>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="token">{t('token_label')}</Label>
              <Input
                id="token"
                placeholder={t('token_placeholder')}
                value={token}
                onChange={(e) => {
                  setToken(e.target.value);
                  setError(null);
                }}
                disabled={isPending}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'token-error' : undefined}
              />
              {error && (
                <p id="token-error" role="alert" className="text-xs text-destructive">
                  {error}
                </p>
              )}
            </div>
            <Button type="submit" className="w-full" disabled={isPending || !token.trim()}>
              {isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
              {t('submit')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
