import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@studiq/ui';
import { Building2, CreditCard, Flag, Shield, Users } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

const SECTIONS = [
  { key: 'feature_flags', href: '/feature-flags', icon: Flag },
  { key: 'subscription_plans', href: '/subscription-plans', icon: CreditCard },
  { key: 'user_overrides', href: '/user-overrides', icon: Users },
  { key: 'orgs', href: '/orgs', icon: Building2 },
] as const;

export default function AdminDashboard() {
  const t = useTranslations('AdminDashboard');

  return (
    <div className="space-y-8 p-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <Shield className="h-8 w-8 text-primary" />
          {t('title')}
        </h1>
        <p className="text-muted-foreground mt-2">{t('description')}</p>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
        {SECTIONS.map(({ key, href, icon: Icon }) => (
          <Link key={key} href={href}>
            <Card className="transition-colors hover:bg-accent/50 cursor-pointer">
              <CardHeader className="flex flex-row items-center gap-3 pb-2">
                <Icon className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">{t(key)}</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>{t(`${key}_desc`)}</CardDescription>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
