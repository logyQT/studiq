'use client';

import { ArrowRight, Key, Radio, Users, Zap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Label } from '@/components/ui/label';

export default function LiveClient() {
  const t = useTranslations('AppLiveStudyPage');
  const [code, setCode] = useState('');

  function handleJoin() {
    if (!code.trim()) return;
    toast.info(t('coming_soon'));
  }

  const steps = [
    {
      icon: Key,
      title: t('step1_title'),
      desc: t('step1_desc'),
      color: 'text-violet-500',
      bg: 'bg-violet-500/10',
    },
    {
      icon: Users,
      title: t('step2_title'),
      desc: t('step2_desc'),
      color: 'text-blue-500',
      bg: 'bg-blue-500/10',
    },
    {
      icon: Zap,
      title: t('step3_title'),
      desc: t('step3_desc'),
      color: 'text-emerald-500',
      bg: 'bg-emerald-500/10',
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col items-center text-center gap-4 pt-4">
        <div className="rounded-2xl bg-gradient-to-br from-violet-500/20 via-primary/10 to-blue-500/20 p-5 ring-1 ring-primary/10">
          <Radio className="size-10 text-primary" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">{t('title')}</h1>
          <p className="text-muted-foreground mt-2 max-w-lg">{t('subtitle')}</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {steps.map(({ icon: Icon, title, desc, color, bg }) => (
          <Card
            key={title}
            className="overflow-hidden border-0 bg-gradient-to-b from-card to-muted/30 shadow-sm"
          >
            <CardHeader>
              <div className={`mb-2 inline-flex rounded-xl ${bg} p-3 w-fit`}>
                <Icon className={`size-5 ${color}`} />
              </div>
              <CardTitle className="text-base">{title}</CardTitle>
              <CardDescription className="text-sm">{desc}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card className="border-primary/10 bg-gradient-to-b from-card to-muted/20 shadow-sm">
        <CardHeader className="text-center pb-2">
          <CardTitle className="text-lg">{t('join_button')}</CardTitle>
          <CardDescription>{t('code_placeholder')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center gap-6 max-w-sm mx-auto">
            <div className="space-y-3 text-center">
              <Label className="text-sm font-medium text-muted-foreground">{t('code_label')}</Label>
              <InputOTP
                maxLength={6}
                value={code}
                onChange={(val) => setCode(val.toUpperCase())}
                onComplete={handleJoin}
              >
                <InputOTPGroup>
                  <InputOTPSlot index={0} />
                  <InputOTPSlot index={1} />
                  <InputOTPSlot index={2} />
                  <InputOTPSlot index={3} />
                  <InputOTPSlot index={4} />
                  <InputOTPSlot index={5} />
                </InputOTPGroup>
              </InputOTP>
              <p className="text-xs text-muted-foreground">{t('code_placeholder')}</p>
            </div>
            <Button
              size="lg"
              className="w-full gap-2"
              disabled={code.length < 6}
              onClick={handleJoin}
            >
              {t('join_button')} <ArrowRight className="size-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
