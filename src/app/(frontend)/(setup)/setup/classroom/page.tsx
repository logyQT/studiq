'use client';

import { Check, Loader2, Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const STEPS = 3;

export default function ClassroomPage() {
  const t = useTranslations('SetupPage');
  const router = useRouter();
  const [step, setStep] = useState(0);

  const [orgName, setOrgName] = useState('');
  const [invites, setInvites] = useState<{ email: string }[]>([]);
  const inviteRole = 'member';
  const [loading, setLoading] = useState(false);

  function addInviteRow() {
    setInvites([...invites, { email: '' }]);
  }

  function updateInvite(index: number, email: string) {
    const updated = [...invites];
    updated[index] = { email };
    setInvites(updated);
  }

  function removeInvite(index: number) {
    setInvites(invites.filter((_, i) => i !== index));
  }

  async function handleCreate() {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/teacher/classrooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: orgName }),
      });

      if (!res.ok) throw new Error();

      const validInvites = invites.filter((i) => i.email.trim());
      if (validInvites.length > 0) {
        const bulkRes = await fetch('/api/v1/organization/invites/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            invitations: validInvites.map((i) => ({
              email: i.email,
              targetOrgRoleId: inviteRole,
            })),
          }),
        });

        if (!bulkRes.ok) throw new Error();
      }

      setStep(2);
    } catch {
      toast.error(t('create_failed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6 min-h-[400px] flex flex-col justify-between">
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">
          {step === 0 && t('create_title')}
          {step === 1 && t('invites_title')}
          {step === 2 && t('done_title')}
        </h1>

        {/* Step 0: Name */}
        {step === 0 && (
          <div className="space-y-4">
            <div>
              <Label htmlFor="org-name">{t('name_label')}</Label>
              <Input
                id="org-name"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder={t('name_placeholder')}
              />
            </div>
            <Button onClick={() => setStep(1)} className="w-full" disabled={!orgName.trim()}>
              {t('continue')}
            </Button>
          </div>
        )}

        {/* Step 1: Invites */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="space-y-2">
              {invites.map((invite, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={invite.email}
                    onChange={(e) => updateInvite(i, e.target.value)}
                    placeholder={t('email_placeholder')}
                    type="email"
                  />
                  <Button variant="ghost" size="icon" onClick={() => removeInvite(i)}>
                    <X className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={addInviteRow}>
              <Plus className="size-4 mr-1" />
              {t('add_member')}
            </Button>
            <Button onClick={handleCreate} className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 size-4 animate-spin" />}
              {t('create_button')}
            </Button>
          </div>
        )}

        {/* Step 2: Done */}
        {step === 2 && (
          <div className="text-center space-y-4 py-4">
            <Check className="size-12 mx-auto text-primary" />
            <p>{t('done_message')}</p>
            <Button onClick={() => router.push('/edu')} className="w-full">
              {t('go_to_dashboard')}
            </Button>
          </div>
        )}
      </div>

      {/* Dot navigation */}
      <div className="flex justify-center gap-2 pt-8">
        {Array.from({ length: STEPS }).map((_, i) => (
          <button
            key={i}
            className={`size-2.5 rounded-full transition-colors ${
              i === step ? 'bg-primary' : 'bg-muted-foreground/30 hover:bg-muted-foreground/50'
            }`}
            onClick={() => {
              if (i <= step) setStep(i);
            }}
          />
        ))}
      </div>
    </div>
  );
}
