import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@studiq/ui';
import { Shield } from 'lucide-react';
import { useTranslations } from 'next-intl';

export default function AdminDashboard() {
  const t = useTranslations('AdminDashboard');

  return (
    <div className="space-y-8 p-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground mt-2">{t('description')}</p>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center gap-4">
            <Shield className="w-8 h-8 text-primary" />
            <div>
              <CardTitle className="text-lg">{t('adminPanel')}</CardTitle>
              <CardDescription>{t('standaloneApp')}</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{t('portInfo')}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
