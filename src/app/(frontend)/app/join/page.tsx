'use client';

import { Loader2, LogIn } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function AppJoinPage() {
  const t = useTranslations('AppJoinPage');
  const [token, setToken] = useState('');
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token.trim()) return;

    setIsPending(true);
    try {
      const res = await fetch('/api/v1/organization/invitations/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim() }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Invalid token');
      }

      toast.success(t('success'));
      window.location.reload();
    } catch {
      toast.error(t('invalid_token'));
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
                onChange={(e) => setToken(e.target.value)}
                disabled={isPending}
              />
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
