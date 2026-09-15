'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@studiq/ui';
import { Copy, Plus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

interface OrgRole {
  id: string;
  name: string;
}

interface InviteRow {
  email: string;
  orgRoleId: string;
}

interface InvitationResult {
  success: boolean;
  data?: { inviteLink?: string };
  error?: string;
}

interface Invitation {
  id: string;
  email: string;
  targetOrgRoleId: string;
  orgRoleName: string;
  isAccepted: boolean;
  expiresAt: string;
  createdAt: string;
}

export default function InvitationsPage() {
  const t = useTranslations('ManageInvitationsPage');
  const [orgRoles, setOrgRoles] = useState<OrgRole[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([{ email: '', orgRoleId: '' }]);
  const [results, setResults] = useState<InvitationResult[]>([]);
  const [sending, setSending] = useState(false);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAccepted, setShowAccepted] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetch('/api/v1/organization/roles')
      .then((r) => r.json())
      .then((res) => {
        if (res.success && Array.isArray(res.data)) {
          setOrgRoles(res.data);
        }
      });
  }, []);

  const fetchInvitations = useCallback(() => {
    setLoading(true);
    fetch(`/api/v1/organization/invites?isAccepted=${showAccepted}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.success && Array.isArray(res.data)) {
          setInvitations(res.data);
        }
      })
      .finally(() => setLoading(false));
  }, [showAccepted]);

  useEffect(() => {
    fetchInvitations();
  }, [fetchInvitations]);

  function updateInvite(index: number, field: keyof InviteRow, value: string) {
    const updated = [...invites];
    updated[index] = { ...updated[index], [field]: value };
    setInvites(updated);
  }

  function addInviteRow() {
    setInvites([...invites, { email: '', orgRoleId: orgRoles[0]?.id ?? '' }]);
  }

  function removeInviteRow(index: number) {
    if (invites.length <= 1) return;
    setInvites(invites.filter((_, i) => i !== index));
  }

  async function handleSend() {
    const validInvites = invites
      .filter((i) => i.email.trim() && i.orgRoleId)
      .map((i) => ({ email: i.email, targetOrgRoleId: i.orgRoleId }));
    if (validInvites.length === 0) {
      toast.error(t('no_invites'));
      return;
    }

    setSending(true);
    try {
      const res = await fetch('/api/v1/organization/invites/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invitations: validInvites }),
      });

      const resJson = await res.json();
      const bulkResults = resJson?.data?.results ?? [];
      if (bulkResults.length) {
        setResults([...bulkResults, ...results]);
        toast.success(
          t('invitations_sent', {
            count: bulkResults.filter((r: InvitationResult) => r.success).length,
          }),
        );
        setInvites([{ email: '', orgRoleId: orgRoles[0]?.id ?? '' }]);
        fetchInvitations();
      }
    } catch {
      toast.error(t('send_failed'));
    } finally {
      setSending(false);
    }
  }

  async function handleRoleChange(invitationId: string, orgRoleId: string) {
    try {
      const res = await fetch(`/api/v1/organization/invites/${invitationId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetOrgRoleId: orgRoleId }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(t('update_success'));
        fetchInvitations();
      }
    } catch {
      toast.error(t('send_failed'));
    }
  }

  async function handleRevoke(invitationId: string) {
    setRevokingId(invitationId);
    try {
      const res = await fetch(`/api/v1/organization/invites/${invitationId}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (json.success) {
        toast.success(t('revoke_success'));
        fetchInvitations();
      }
    } catch {
      toast.error(t('send_failed'));
    } finally {
      setRevokingId(null);
    }
  }

  function getStatus(inv: Invitation): {
    label: string;
    variant: 'default' | 'secondary' | 'destructive' | 'outline';
  } {
    if (inv.isAccepted) return { label: t('status_accepted'), variant: 'default' };
    if (new Date(inv.expiresAt) < new Date())
      return { label: t('status_expired'), variant: 'destructive' };
    return { label: t('status_pending'), variant: 'secondary' };
  }

  const filteredInvitations = invitations.filter((inv) =>
    inv.email.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">{t('title')}</h2>

      <Card>
        <CardHeader>
          <CardTitle>{t('card_title')}</CardTitle>
          <CardDescription>{t('card_desc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {invites.map((invite, i) => (
            <div key={i} className="flex items-start gap-2">
              <div className="flex-1">
                <Label className="sr-only" htmlFor={`email-${i}`}>
                  {t('email_label')}
                </Label>
                <Input
                  id={`email-${i}`}
                  type="email"
                  value={invite.email}
                  onChange={(e) => updateInvite(i, 'email', e.target.value)}
                  placeholder={t('email_placeholder')}
                />
              </div>
              <div className="w-40">
                <Label className="sr-only" htmlFor={`role-${i}`}>
                  {t('role_label')}
                </Label>
                <Select
                  value={invite.orgRoleId}
                  onValueChange={(v) => updateInvite(i, 'orgRoleId', v)}
                >
                  <SelectTrigger id={`role-${i}`}>
                    <SelectValue placeholder={t('role_label')} />
                  </SelectTrigger>
                  <SelectContent>
                    {orgRoles.map((role) => (
                      <SelectItem key={role.id} value={role.id}>
                        {role.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {invites.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="mt-0"
                  onClick={() => removeInviteRow(i)}
                >
                  <X className="size-4" />
                </Button>
              )}
            </div>
          ))}

          <Button variant="outline" size="sm" onClick={addInviteRow}>
            <Plus className="size-4 mr-1" />
            {t('add_member')}
          </Button>

          <Button onClick={handleSend} className="w-full" disabled={sending}>
            {t('send_invitations')}
          </Button>
        </CardContent>
      </Card>

      {results.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('results_title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {results.map((result, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-3 bg-muted rounded-lg"
              >
                <div className="flex items-center gap-2">
                  <Badge variant={result.success ? 'default' : 'destructive'}>
                    {result.success ? t('success') : t('failed')}
                  </Badge>
                  {result.data?.inviteLink && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(result.data!.inviteLink!);
                        toast.success(t('link_copied'));
                      }}
                    >
                      <Copy className="h-3 w-3 mr-1" />
                      {t('copy_link')}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>{t('table_title')}</CardTitle>
          </div>
          <div className="flex items-center gap-4">
            <Input
              placeholder={t('email_label')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="max-w-60"
            />
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={showAccepted}
                onChange={(e) => setShowAccepted(e.target.checked)}
                className="rounded"
              />
              {t('show_accepted')}
            </label>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center text-muted-foreground py-8">
              <div className="animate-spin size-6 border-2 border-primary border-t-transparent rounded-full mx-auto mb-2" />
            </div>
          ) : filteredInvitations.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">{t('no_invitations')}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('col_email')}</TableHead>
                  <TableHead>{t('col_role')}</TableHead>
                  <TableHead>{t('col_status')}</TableHead>
                  <TableHead>{t('col_sent')}</TableHead>
                  <TableHead className="text-right">{t('col_actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredInvitations.map((inv) => {
                  const status = getStatus(inv);
                  return (
                    <TableRow key={inv.id}>
                      <TableCell className="font-medium">{inv.email}</TableCell>
                      <TableCell>
                        {inv.isAccepted ? (
                          <span className="text-sm">{inv.orgRoleName}</span>
                        ) : (
                          <Select
                            value={inv.targetOrgRoleId}
                            onValueChange={(v) => handleRoleChange(inv.id, v)}
                          >
                            <SelectTrigger className="w-40">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {orgRoles.map((role) => (
                                <SelectItem key={role.id} value={role.id}>
                                  {role.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(inv.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        {!inv.isAccepted && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="sm" className="text-destructive">
                                {t('revoke')}
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>{t('revoke_title')}</AlertDialogTitle>
                                <AlertDialogDescription>{t('revoke_desc')}</AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>{t('common_close')}</AlertDialogCancel>
                                <AlertDialogAction
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  onClick={() => handleRevoke(inv.id)}
                                  disabled={revokingId === inv.id}
                                >
                                  {t('revoke')}
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
