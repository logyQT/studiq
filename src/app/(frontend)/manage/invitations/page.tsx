'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Copy, Send, Upload, Plus } from 'lucide-react';
import { ORGANIZATION_ROLES, OrganizationRole } from '@/types';

interface InvitationResult {
  success: boolean;
  data?: { inviteLink?: string };
  error?: string;
}

export default function InvitationsPage() {
  const t = useTranslations('ManageInvitationsPage');
  const [results, setResults] = useState<InvitationResult[]>([]);
  const [singleForm, setSingleForm] = useState<{
    name: string;
    email: string;
    role: OrganizationRole;
  }>({ name: '', email: '', role: ORGANIZATION_ROLES[0] });
  const [bulkText, setBulkText] = useState('');
  const [bulkRole, setBulkRole] = useState<OrganizationRole>(ORGANIZATION_ROLES[0]);
  const [loading, setLoading] = useState(false);

  async function handleSingleInvite() {
    if (!singleForm.name || !singleForm.email) {
      toast.error(t('name_email_required'));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/v1/organization/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(singleForm),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (data.inviteLink) {
        setResults([{ success: true, data: { inviteLink: data.inviteLink } }, ...results]);
        toast.success(t('invitation_created'));
        setSingleForm({ name: '', email: '', role: ORGANIZATION_ROLES[0] });
      }
    } catch {
      toast.error(t('invitation_create_failed'));
    }
    setLoading(false);
  }

  async function handleBulkInvite() {
    const lines = bulkText
      .split(/[\n,]+/)
      .map((l) => l.trim())
      .filter((l) => l);
    if (lines.length === 0) {
      toast.error(t('no_emails_found'));
      return;
    }
    setLoading(true);
    const invitations = lines.map((email) => ({
      name: email.split('@')[0],
      email,
      role: bulkRole,
    }));
    try {
      const res = await fetch('/api/v1/organization/invitations/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invitations }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setResults([...data.results, ...results]);
      setBulkText('');
      toast.success(
        t('bulk_invitations_created', { count: data.results.filter((r: InvitationResult) => r.success).length }),
      );
    } catch {
      toast.error(t('bulk_invitations_failed'));
    }
    setLoading(false);
  }

  async function handleCsvUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setBulkText(text);
    toast.success(t('csv_loaded'));
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">{t('title')}</h2>

      <Tabs defaultValue="single">
        <TabsList>
          <TabsTrigger value="single">{t('tab_single')}</TabsTrigger>
          <TabsTrigger value="bulk-text">{t('tab_bulk_text')}</TabsTrigger>
          <TabsTrigger value="bulk-csv">{t('tab_bulk_csv')}</TabsTrigger>
        </TabsList>

        <TabsContent value="single">
          <Card>
            <CardHeader>
              <CardTitle>{t('single_title')}</CardTitle>
              <CardDescription>{t('single_desc')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>{t('full_name_label')}</Label>
                <Input
                  value={singleForm.name}
                  onChange={(e) => setSingleForm({ ...singleForm, name: e.target.value })}
                  placeholder={t('full_name_placeholder')}
                />
              </div>
              <div>
                <Label>{t('email_label')}</Label>
                <Input
                  type="email"
                  value={singleForm.email}
                  onChange={(e) => setSingleForm({ ...singleForm, email: e.target.value })}
                  placeholder={t('email_placeholder')}
                />
              </div>
              <div>
                <Label>{t('role_label')}</Label>
                <Select
                  value={singleForm.role}
                    onValueChange={(v) => setSingleForm({ ...singleForm, role: v as OrganizationRole })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ORGANIZATION_ROLES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {t(`role_${r}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleSingleInvite} disabled={loading}>
                <Send className="mr-2 h-4 w-4" /> {t('send_invitation')}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="bulk-text">
          <Card>
            <CardHeader>
              <CardTitle>{t('bulk_text_title')}</CardTitle>
              <CardDescription>{t('bulk_text_desc')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>{t('bulk_role_label')}</Label>
                <Select value={bulkRole} onValueChange={(v) => setBulkRole(v as OrganizationRole)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ORGANIZATION_ROLES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {t(`role_${r}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t('emails_label')}</Label>
                <Textarea
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  placeholder={t('emails_placeholder')}
                  rows={8}
                  className="font-mono text-sm"
                />
              </div>
              <Button onClick={handleBulkInvite} disabled={loading}>
                <Plus className="mr-2 h-4 w-4" /> {t('generate_invitations')}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="bulk-csv">
          <Card>
            <CardHeader>
              <CardTitle>{t('bulk_csv_title')}</CardTitle>
              <CardDescription>
                {t('bulk_csv_desc')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>{t('csv_file_label')}</Label>
                <div className="border-2 border-dashed rounded-lg p-8 text-center">
                  <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
                  <p className="mt-2 text-sm text-muted-foreground">
                    {t('csv_drop_text')}
                  </p>
                  <input type="file" accept=".csv" onChange={handleCsvUpload} className="mt-2" />
                </div>
              </div>
              {bulkText && (
                <>
                  <div>
                    <Label>{t('parsed_data_label')}</Label>
                    <Textarea
                      value={bulkText}
                      onChange={(e) => setBulkText(e.target.value)}
                      rows={8}
                      className="font-mono text-sm"
                    />
                  </div>
                  <Button onClick={handleBulkInvite} disabled={loading}>
                    <Send className="mr-2 h-4 w-4" /> {t('send_invitations')}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {results.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('generated_links_title')}</CardTitle>
            <CardDescription>{t('generated_links_desc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {results
                .filter((r) => r.success && r.data?.inviteLink)
                .map((r, i) => (
                  <div key={i} className="flex items-center gap-2 p-2 rounded-lg border">
                    <Badge variant="default" className="shrink-0">
                      {t('status_success')}
                    </Badge>
                    <Input
                      readOnly
                      value={r.data!.inviteLink}
                      className="text-xs font-mono flex-1"
                    />
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={() => {
                        navigator.clipboard.writeText(r.data!.inviteLink!);
                        toast.success(t('copied'));
                      }}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              {results
                .filter((r) => !r.success)
                .map((r, i) => (
                  <div key={i} className="flex items-center gap-2 p-2 rounded-lg border">
                    <Badge variant="destructive">{t('status_failed')}</Badge>
                    <span className="text-sm text-muted-foreground">
                      {typeof r.error === 'string' ? r.error : t('unknown_error')}
                    </span>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
