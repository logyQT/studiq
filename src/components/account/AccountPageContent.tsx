'use client';

import { Loader2, Lock, Mail, PenLine, User } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/components/providers/AuthProvider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { UserAvatar } from '@/components/ui/user-avatar';
import { useOrgs } from '@/hooks/use-orgs';
import { apiPost, apiPut } from '@/lib/api';

export function AccountPageContent() {
  const t = useTranslations('AccountPage');
  const { user } = useAuth();
  const { activeOrg } = useOrgs();

  const [name, setName] = useState(user?.user_metadata?.name || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSavingName, setIsSavingName] = useState(false);
  const [isSavingPassword, setIsSavingPassword] = useState(false);

  const userName = user?.user_metadata?.name || user?.email?.split('@')[0] || '';
  const role = (activeOrg?.orgRoleName ?? user?.app_metadata?.account_type) as string;
  const createdAt = user?.created_at ? new Date(user.created_at).toLocaleDateString() : '';

  async function handleSaveName() {
    if (!name.trim() || name === user?.user_metadata?.name) return;
    setIsSavingName(true);
    try {
      await apiPut('/api/v1/auth/profile', { name: name.trim() });
      toast.success(t('name_saved'));
    } catch {
      toast.error(t('name_saved'));
    } finally {
      setIsSavingName(false);
    }
  }

  async function handleUpdatePassword() {
    if (newPassword !== confirmPassword) {
      toast.error(t('password_mismatch'));
      return;
    }
    if (!currentPassword || !newPassword || !confirmPassword) return;
    setIsSavingPassword(true);
    try {
      await apiPost('/api/v1/auth/password/update', {
        password: newPassword,
        confirmPassword,
      });
      toast.success(t('password_updated'));
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch {
      toast.error(t('password_updated'));
    } finally {
      setIsSavingPassword(false);
    }
  }

  function handleAvatarClick() {
    toast.info(t('avatar_coming_soon'));
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground mt-1">{t('subtitle')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('avatar_label')}</CardTitle>
        </CardHeader>
        <CardContent>
          <button type="button" onClick={handleAvatarClick} className="group relative inline-flex">
            <UserAvatar
              name={userName}
              email={user?.email}
              size={80}
              className="size-20 rounded-full"
            />
            <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
              <div className="flex flex-col items-center gap-1 text-white">
                <PenLine className="size-5" />
                <span className="text-[10px] font-medium">{t('update_avatar')}</span>
              </div>
            </div>
          </button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('name_label')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">{t('name_label')}</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Button
                onClick={handleSaveName}
                disabled={isSavingName || !name.trim() || name === user?.user_metadata?.name}
              >
                {isSavingName && <Loader2 className="size-4 mr-2 animate-spin" />}
                {isSavingName ? t('saving') : 'Save'}
              </Button>
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label>{t('email_label')}</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              <Input value={user?.email || ''} readOnly className="pl-9 bg-muted" />
            </div>
          </div>

          <Separator />

          <div className="flex items-center gap-4">
            <div>
              <Label className="text-sm text-muted-foreground">{t('role_label')}</Label>
              <p className="font-medium mt-0.5">
                <Badge variant="secondary">{role}</Badge>
              </p>
            </div>
            {createdAt && (
              <div>
                <Label className="text-sm text-muted-foreground">{t('member_since')}</Label>
                <p className="font-medium mt-0.5">{createdAt}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('password_section')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="currentPassword">{t('current_password')}</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              <Input
                id="currentPassword"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="newPassword">{t('new_password')}</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">{t('confirm_password')}</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
          <Button
            onClick={handleUpdatePassword}
            disabled={isSavingPassword || !currentPassword || !newPassword || !confirmPassword}
          >
            {isSavingPassword && <Loader2 className="size-4 mr-2 animate-spin" />}
            {isSavingPassword ? t('saving') : t('update_password')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
