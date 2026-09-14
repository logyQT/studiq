import { Building2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function SysAdminDashboard() {
  const t = useTranslations('AdminPage');

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground mt-2">{t('description')}</p>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center gap-4">
            <Building2 className="w-8 h-8 text-primary" />
            <div>
              <CardTitle className="text-lg">{t('orgs_title')}</CardTitle>
              <CardDescription>{t('orgs_desc')}</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{t('orgs_hint')}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
