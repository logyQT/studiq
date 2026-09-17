'use client';

import { APP_ERRORS } from '@studiq/server/lib/errors';
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
import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

export default function OrgSetupPage() {
  const t = useTranslations('Onboarding');
  const router = useRouter();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleCreate() {
    if (!name) return;
    setLoading(true);
    try {
      const res = await fetch('/api/v1/organization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'FAILED');
      }

      const data = await res.json();

      await fetch('/api/v1/me/orgs/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId: data.id }),
      });

      router.push('/manage');
    } catch {
      toast.error(t('create_failed') || APP_ERRORS.INTERNAL_SERVER.code);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg py-12">
      <Card>
        <CardHeader>
          <CardTitle>{t('org_title')}</CardTitle>
          <CardDescription>{t('org_desc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <Label htmlFor="name">{t('org_name_label')}</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('org_name_placeholder')}
              />
            </div>
            <Button onClick={handleCreate} className="w-full" disabled={loading || !name}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('create_org')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
