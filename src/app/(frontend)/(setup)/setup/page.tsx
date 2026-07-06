'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

export default function SetupLandingPage() {
  const t = useTranslations('SetupPage');
  const router = useRouter();

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <p className="text-muted-foreground">{t('desc')}</p>
      <div className="pt-4 space-y-3">
        <Button
          variant="outline"
          className="w-full justify-start h-auto p-5 text-left"
          onClick={() => router.push('/setup/join')}
        >
          <div>
            <div className="font-medium">{t('join_option')}</div>
            <div className="text-sm text-muted-foreground">{t('join_option_desc')}</div>
          </div>
        </Button>
        <Button
          variant="outline"
          className="w-full justify-start h-auto p-5 text-left"
          onClick={() => router.push('/setup/classroom')}
        >
          <div>
            <div className="font-medium">{t('create_option')}</div>
            <div className="text-sm text-muted-foreground">{t('create_option_desc')}</div>
          </div>
        </Button>
      </div>
    </div>
  );
}
