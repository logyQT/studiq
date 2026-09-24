'use client';

import { Button, Input, Label } from '@studiq/ui';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

export function ChangePasswordForm() {
  const t = useTranslations('Settings');

  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setIsLoading(true);

    try {
      const res = await fetch('/api/v1/auth/password/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const json = await res.json();

      if (!json.success) {
        setMessage({ type: 'error', text: t('password_update_error') });
        return;
      }

      setMessage({ type: 'success', text: t('password_update_success') });
      setPassword('');
    } catch {
      setMessage({ type: 'error', text: t('password_update_error') });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-sm">
      {message && (
        <p
          className={
            message.type === 'success'
              ? 'rounded-md bg-green-500/10 px-3 py-2 text-sm text-green-600'
              : 'rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive'
          }
        >
          {message.text}
        </p>
      )}
      <div className="space-y-2">
        <Label htmlFor="new-password">{t('new_password_label')}</Label>
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={isLoading}
          minLength={8}
          required
        />
      </div>
      <Button type="submit" disabled={isLoading || password.length === 0}>
        {isLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
        {t('password_update_button')}
      </Button>
    </form>
  );
}
