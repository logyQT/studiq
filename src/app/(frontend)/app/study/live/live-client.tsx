'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Label } from '@/components/ui/label';

export default function LiveClient() {
  const t = useTranslations('AppLiveStudyPage');
  const [code, setCode] = useState('');

  function handleJoin() {
    if (!code.trim()) return;
    toast.info(t('coming_soon'));
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-8">
      <div className="flex flex-col items-center gap-3">
        <Label className="text-lg font-semibold text-foreground">{t('code_label')}</Label>
        <InputOTP
          maxLength={6}
          value={code}
          onChange={(val) => setCode(val.toUpperCase())}
          onComplete={handleJoin}
        >
          <InputOTPGroup>
            {Array.from({ length: 6 }, (_, i) => (
              <InputOTPSlot key={i} index={i} className="h-14 w-14 text-2xl" />
            ))}
          </InputOTPGroup>
        </InputOTP>
        <Link
          href="/app/study/live/faq"
          className="self-start text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground transition-colors"
        >
          {t('how_it_works')}
        </Link>
      </div>
    </div>
  );
}
