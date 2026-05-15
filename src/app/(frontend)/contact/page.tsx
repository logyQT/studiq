'use client';

import { useTranslations } from 'next-intl';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Mail, Phone, Building2, Users, Shield, Briefcase, Headphones } from 'lucide-react';

const teams = [
  {
    icon: Users,
    nameKey: 'sales',
    descKey: 'sales_desc',
    email: 'sales@studiq.pl',
    phone: '+48 123 567 890',
  },
  {
    icon: Shield,
    nameKey: 'dpo',
    descKey: 'dpo_desc',
    email: 'dpo@studiq.pl',
    phone: '+48 123 567 891',
  },
  {
    icon: Briefcase,
    nameKey: 'careers',
    descKey: 'careers_desc',
    email: 'careers@studiq.pl',
    phone: '+48 123 567 892',
  },
  {
    icon: Headphones,
    nameKey: 'support',
    descKey: 'support_desc',
    email: 'support@studiq.pl',
    phone: '+48 123 567 893',
  },
];

export default function ContactPage() {
  const t = useTranslations('ContactPage');

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold">{t('title')}</h1>
        <p className="mt-3 text-lg text-muted-foreground">{t('description')}</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {teams.map((team) => (
          <Card key={team.nameKey}>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <team.icon className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <CardTitle>{t(team.nameKey)}</CardTitle>
                  <CardDescription>{t(team.descKey)}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <a
                  href={`mailto:${team.email}`}
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition"
                >
                  <Mail className="h-4 w-4 shrink-0" />
                  {team.email}
                </a>
                <a
                  href={`tel:${team.phone.replace(/\s/g, '')}`}
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition"
                >
                  <Phone className="h-4 w-4 shrink-0" />
                  {team.phone}
                </a>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mt-8">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Building2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle>{t('headquarters')}</CardTitle>
              <CardDescription>{t('headquarters_desc')}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>{t('company_name')}</p>
            <p>{t('company_address')}</p>
            <p>{t('company_city')}</p>
            <p className="pt-2">{t('company_nip')}</p>
            <p>{t('company_krs')}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
