'use client';

import { Badge, Button, Card, Input, Label, OrgAvatar, Separator } from '@studiq/ui';
import { CheckCircle2, Loader2, ShieldAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

type VerifyState = 'idle' | 'verifying' | 'valid' | 'invalid';

interface InviteData {
  organizationName: string;
  organizationId: string;
  orgRoleName: string;
  token: string;
}

export default function JoinPage() {
  const t = useTranslations('SetupPage');
  const router = useRouter();
  const [inviteCode, setInviteCode] = useState('');
  const [inviteData, setInviteData] = useState<InviteData | null>(null);
  const [verifyState, setVerifyState] = useState<VerifyState>('idle');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!inviteCode || inviteCode.length < 10) {
      setInviteData(null);
      setVerifyState('idle');
      return;
    }

    const timer = setTimeout(async () => {
      setVerifyState('verifying');
      try {
        const res = await fetch(
          `/api/v1/organization/invites?token=${encodeURIComponent(inviteCode)}`,
        );
        const result = await res.json();
        if (!res.ok || !result.success) {
          setVerifyState('invalid');
          setInviteData(null);
        } else {
          setVerifyState('valid');
          setInviteData({
            organizationName: result.data.organizationName,
            organizationId: result.data.organizationId,
            orgRoleName: result.data.orgRoleName,
            token: inviteCode,
          });
        }
      } catch {
        setVerifyState('invalid');
        setInviteData(null);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [inviteCode]);

  async function handleJoin() {
    if (!inviteData) return;
    setLoading(true);
    try {
      const res = await fetch('/api/v1/organization/invites/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: inviteData.token }),
      });
      if (!res.ok) throw new Error();
      router.push('/edu');
    } catch {
      toast.error(t('join_failed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">{t('join_title')}</h1>
        <p className="text-muted-foreground">{t('join_desc')}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="invite-code" className="text-sm font-medium">
          {t('invite_code_label')}
        </Label>
        <div className="relative">
          <Input
            id="invite-code"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            placeholder={t('invite_code_placeholder')}
            className={`h-12 text-center text-lg tracking-widest font-mono transition-all ${
              verifyState === 'invalid'
                ? 'border-destructive ring-1 ring-destructive'
                : verifyState === 'valid'
                  ? 'border-emerald-500 ring-1 ring-emerald-500/30'
                  : ''
            }`}
          />
        </div>
        <p className="text-xs text-muted-foreground px-1">{t('invite_code_hint')}</p>
      </div>

      {/* Verifying state */}
      {verifyState === 'verifying' && (
        <div className="flex items-center gap-3 rounded-lg bg-muted/50 p-4 animate-pulse">
          <div className="size-10 rounded-full bg-muted-foreground/20" />
          <div className="space-y-2 flex-1">
            <div className="h-4 w-1/2 rounded bg-muted-foreground/20" />
            <div className="h-3 w-1/4 rounded bg-muted-foreground/20" />
          </div>
        </div>
      )}

      {/* Invalid state */}
      {verifyState === 'invalid' && (
        <div className="flex items-start gap-3 rounded-lg bg-destructive/10 p-4">
          <ShieldAlert className="mt-0.5 size-5 text-destructive shrink-0" />
          <div>
            <p className="text-sm font-medium text-destructive">{t('invite_invalid')}</p>
            <p className="text-xs text-destructive/80 mt-0.5">{t('invite_error')}</p>
          </div>
        </div>
      )}

      {/* Valid state — show org preview */}
      {verifyState === 'valid' && inviteData && (
        <div className="space-y-6 animate-in fade-in slide-in-from-top-2 duration-300">
          <Card className="overflow-hidden border-l-4 border-l-primary">
            <div className="p-6 space-y-5">
              <div className="flex items-center gap-4">
                <OrgAvatar
                  orgId={inviteData.organizationId}
                  name={inviteData.organizationName}
                  size={48}
                />
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">
                    {t('invite_org_label')}
                  </p>
                  <p className="text-lg font-semibold leading-none">
                    {inviteData.organizationName}
                  </p>
                  <Badge variant="secondary" className="text-xs">
                    {inviteData.orgRoleName}
                  </Badge>
                </div>
              </div>

              <Separator />

              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 size-5 text-emerald-500 shrink-0" />
                <div>
                  <p className="text-sm font-medium">{t('join_hint')}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{t('join_hint_detail')}</p>
                </div>
              </div>

              <Button onClick={handleJoin} className="w-full h-11" disabled={loading}>
                {loading && <Loader2 className="mr-2 size-4 animate-spin" />}
                {t('join_button')}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
