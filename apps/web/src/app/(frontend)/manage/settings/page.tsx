'use client';

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Skeleton,
} from '@studiq/ui';
import { Lock } from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { useApiMutation, useApiQuery } from '@/hooks/use-api';
import { useFeature } from '@/hooks/use-feature';
import { useFeatures } from '@/hooks/use-features';
import { useOrgs } from '@/hooks/use-orgs';
import { apiPut, apiUploadFile } from '@/lib/api';

interface OrganizationDetail {
  id: string;
  name: string;
  created_at: string;
  logo_url: string | null;
  brand_color: string | null;
}

/**
 * Locked state shown when the org's plan lacks the `branding` feature.
 * Mirrors the existing ai.chat upgrade affordance: disabled control with a
 * Lock icon, routed to the pricing page.
 */
function BrandingLockedCard({ onUpgrade }: { onUpgrade: () => void }) {
  const t = useTranslations('ManageSettingsPage');
  return (
    <div className="flex flex-col gap-3 rounded-md border border-dashed bg-muted/40 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2">
        <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium">{t('branding_locked_title')}</p>
          <p className="text-sm text-muted-foreground">{t('branding_locked_desc')}</p>
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={onUpgrade}>
        {t('branding_locked_cta')}
      </Button>
    </div>
  );
}

export default function SettingsPage() {
  const t = useTranslations('ManageSettingsPage');
  const router = useRouter();
  const { activeOrg } = useOrgs();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Branding controls are plan-gated (issue #108). Org name and the
  // subscription badge below stay visible either way — only the logo
  // upload and color picker are withheld.
  const canBrand = useFeature()('branding');
  // Same query as useFeature() — while it's in flight `canBrand` is a
  // provisional `false`, so the pending state shares the org-loading
  // skeleton below and entitled orgs never flash the locked card.
  const { isPending: featuresPending } = useFeatures();

  const {
    data: organization,
    isLoading,
    refetch,
  } = useApiQuery<OrganizationDetail>({
    queryKey: ['organization', activeOrg?.id],
    url: `/api/v1/organization/${activeOrg?.id}`,
    enabled: !!activeOrg?.id,
  });

  const [brandColor, setBrandColor] = useState('#000000');

  const updateColor = useApiMutation({
    mutationFn: (color: string) =>
      apiPut(`/api/v1/organization/${activeOrg?.id}`, { brandColor: color }),
    // Branding is read through useBranding() → useOrgs()' `['orgs']` query;
    // invalidate it so the sidebar/navbar pick the change up without a reload.
    invalidateKeys: [['orgs']],
    onSettled: () => refetch(),
  });

  const uploadLogo = useApiMutation({
    mutationFn: (file: File) => apiUploadFile(`/api/v1/organization/${activeOrg?.id}/logo`, file),
    invalidateKeys: [['orgs']],
    onSettled: () => refetch(),
  });

  async function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await uploadLogo.mutateAsync(file);
      toast.success(t('logo_updated'));
    } catch {
      toast.error(t('save_failed'));
    }
    e.target.value = '';
  }

  async function handleColorSave() {
    try {
      await updateColor.mutateAsync(brandColor);
      toast.success(t('color_updated'));
    } catch {
      toast.error(t('save_failed'));
    }
  }

  const displayColor = organization?.brand_color ?? brandColor;
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">{t('title')}</h2>

      <Card>
        <CardHeader>
          <CardTitle>{t('university_profile')}</CardTitle>
          <CardDescription>{t('university_desc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading || featuresPending ? (
            <div className="space-y-3">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-32" />
            </div>
          ) : organization ? (
            <div className="space-y-5">
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  {t('name')} <Badge variant="outline">{t('read_only')}</Badge>
                </p>
                <p className="text-lg font-semibold">{organization.name}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">{t('created')}</p>
                <p className="text-sm">
                  {organization.created_at
                    ? new Date(organization.created_at).toLocaleDateString()
                    : '—'}
                </p>
              </div>

              <div>
                <p className="text-sm font-medium text-muted-foreground mb-2">{t('logo_label')}</p>
                {!canBrand ? (
                  <BrandingLockedCard onUpgrade={() => router.push('/pricing')} />
                ) : (
                  <div className="flex items-center gap-3">
                    {organization.logo_url ? (
                      <Image
                        src={organization.logo_url}
                        alt={organization.name}
                        width={48}
                        height={48}
                        className="rounded-md border object-contain"
                        unoptimized
                      />
                    ) : (
                      <div className="h-12 w-12 rounded-md border border-dashed flex items-center justify-center text-xs text-muted-foreground">
                        {t('no_logo')}
                      </div>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/gif,image/webp"
                      className="hidden"
                      onChange={handleLogoChange}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={uploadLogo.isPending}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {uploadLogo.isPending ? t('uploading') : t('upload_logo')}
                    </Button>
                  </div>
                )}
              </div>

              {canBrand && (
                <div>
                  <Label
                    htmlFor="brand-color"
                    className="text-sm font-medium text-muted-foreground"
                  >
                    {t('brand_color_label')}
                  </Label>
                  <div className="flex items-center gap-2 mt-2">
                    <Input
                      id="brand-color"
                      type="color"
                      value={displayColor}
                      onChange={(e) => setBrandColor(e.target.value)}
                      className="h-9 w-16 p-1"
                    />
                    <span className="text-sm text-muted-foreground">{displayColor}</span>
                    <Button size="sm" disabled={updateColor.isPending} onClick={handleColorSave}>
                      {updateColor.isPending ? t('saving') : t('save_button')}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground">{t('no_university')}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('subscription')}</CardTitle>
          <CardDescription>{t('subscription_desc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Badge variant="default" className="text-sm px-3 py-1">
              {t('basic_plan')}
            </Badge>
            <span className="text-sm text-muted-foreground">{t('managed_by_admins')}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
