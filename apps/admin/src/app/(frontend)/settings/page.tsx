import { createClient } from '@studiq/server/lib/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@studiq/ui';
import { getTranslations } from 'next-intl/server';
import { ChangePasswordForm } from '@/app/(frontend)/settings/change-password-form';

export default async function SettingsPage() {
  const t = await getTranslations('Settings');
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="p-8 space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>

      <Card>
        <CardHeader>
          <CardTitle>{t('account_title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {t('signed_in_as')} <span className="font-medium text-foreground">{user?.email}</span>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('password_title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}
