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
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { apiPost } from '@/lib/api';
import { featureKeys, permissionKeys } from '@/lib/query-keys';

export default function OrgSetupPage() {
  const t = useTranslations('Onboarding');
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleCreate() {
    if (!name) return;
    setLoading(true);
    try {
      // apiPost() unwraps the `{ success, data }` envelope. The previous code read
      // `id` off the envelope, so the follow-up switch was sent with `orgId: undefined` (#306).
      const org = await apiPost<{ id: string }>('/api/v1/organization', { name });

      // POST /api/v1/organization already set `active_org_id` for the creator, so the
      // org is active server-side; the client cache is the only stale piece. Refetch it
      // *before* leaving this screen: `manage/layout.tsx` bounces back to /setup/org
      // while `['orgs']` still holds the cached empty list.
      // `refetchType: 'all'` also refetches the inactive entry — under /setup there is
      // no useOrgs() observer, and the default 'active' would only mark it stale.
      await queryClient.invalidateQueries({ queryKey: ['orgs'], refetchType: 'all' });

      const cachedOrgs = queryClient.getQueryData<Array<{ id: string }>>(['orgs']);

      // Permission scopes and plan features are resolved from the active org on the
      // server and both hooks cache for 5 minutes (same as useOrgs.switchOrgMutation).
      queryClient.invalidateQueries({ queryKey: permissionKeys.all });
      queryClient.invalidateQueries({ queryKey: featureKeys.all });

      if (cachedOrgs && !cachedOrgs.some((o) => o.id === org.id)) {
        // The refresh failed while a stale list is cached. A full load drops the SPA
        // cache, so the successfully created org is not "lost" and cannot bounce.
        window.location.assign('/manage');
        return;
      }

      // replace, not push: /setup/org must not stay in history, otherwise "back"
      // re-opens the create form and can produce a duplicate organization.
      router.replace('/manage');
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
