'use client';

import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  Label,
} from '@studiq/ui';
import { Clock, Key, Users, Zap } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

const SESSION_CODE_LENGTH = 6;

export default function LiveClient() {
  const t = useTranslations('AppLiveStudyPage');
  const [code, setCode] = useState('');
  const isCodeComplete = code.length === SESSION_CODE_LENGTH;

  const steps = [
    { icon: Key, title: t('step1_title'), desc: t('step1_desc'), number: '01' },
    { icon: Users, title: t('step2_title'), desc: t('step2_desc'), number: '02' },
    { icon: Zap, title: t('step3_title'), desc: t('step3_desc'), number: '03' },
  ];

  function handleJoin() {
    if (!isCodeComplete) return;
    toast.info(t('coming_soon'));
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <div className="flex flex-col gap-2 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">{t('title')}</h1>
        <p className="mx-auto max-w-lg text-muted-foreground">{t('subtitle')}</p>
      </div>

      <Alert className="border-dashed text-muted-foreground">
        <Clock className="size-4" />
        <AlertDescription>{t('coming_soon')}</AlertDescription>
      </Alert>

      <Card>
        <CardContent className="flex flex-col items-center gap-6">
          <div className="flex flex-col items-center gap-3">
            <Label htmlFor="live-session-code" className="text-lg font-semibold text-foreground">
              {t('code_label')}
            </Label>
            <InputOTP
              id="live-session-code"
              aria-describedby="live-session-code-hint"
              maxLength={SESSION_CODE_LENGTH}
              value={code}
              onChange={(val) => setCode(val.toUpperCase())}
            >
              <InputOTPGroup>
                {Array.from({ length: SESSION_CODE_LENGTH }, (_, i) => (
                  <InputOTPSlot key={i} index={i} className="h-14 w-14 text-2xl" />
                ))}
              </InputOTPGroup>
            </InputOTP>
            <p id="live-session-code-hint" className="text-xs text-muted-foreground">
              {t('code_placeholder')}
            </p>
          </div>

          <Button
            size="lg"
            className="w-full max-w-sm"
            disabled={!isCodeComplete}
            onClick={handleJoin}
          >
            {t('join_button')}
          </Button>

          <Link
            href="/app/study/live/faq"
            className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground transition-colors"
          >
            {t('how_it_works')}
          </Link>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        {steps.map(({ icon: Icon, title, desc, number }) => (
          <Card key={number}>
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-primary/10 p-2.5">
                  <Icon className="size-5 text-primary" />
                </div>
                <span className="select-none text-2xl font-bold text-muted-foreground/20">
                  {number}
                </span>
              </div>
              <h2 className="text-base font-semibold">{title}</h2>
              <p className="text-sm text-muted-foreground">{desc}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
