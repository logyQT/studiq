'use client';

import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { APP_ERRORS } from '@/lib/errors';

export default function OrgSetupPage() {
  const t = useTranslations('Onboarding');
  const router = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [loading, setLoading] = useState(false);

  function handleNameChange(value: string) {
    setName(value);
    setSlug(
      value
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, ''),
    );
  }

  async function handleCreate() {
    if (!name) return;
    setLoading(true);
    try {
      const res = await fetch('/api/v1/admin/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, slug }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'FAILED');
      }

      const data = await res.json();

      // Switch to the new org
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
    <div className="flex min-h-screen items-center justify-center bg-muted/50 p-6">
      <Card className="w-full max-w-lg">
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
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder={t('org_name_placeholder')}
              />
            </div>
            <div>
              <Label htmlFor="slug">{t('slug_label')}</Label>
              <Input
                id="slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder={t('slug_placeholder')}
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
