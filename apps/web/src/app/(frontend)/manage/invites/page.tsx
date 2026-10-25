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
  displayName?: string;
}

interface InviteRow {
  email: string;
  orgRoleId: string;
}

type InviteRowError = 'missing_email' | 'missing_role';

/**
 * A row is either fully valid or explicitly flagged. A completely blank row is
 * ignored (the form always keeps one), but a half-filled one must never be
 * dropped silently: the previous `.filter()` sent the other rows and reported
 * success for a batch that never included this person (MGR-INV-02).
 */
function rowError(row: InviteRow): InviteRowError | null {
  const hasEmail = row.email.trim().length > 0;
  const hasRole = Boolean(row.orgRoleId);
  if (!hasEmail && !hasRole) return null;
  if (!hasEmail) return 'missing_email';
  if (!hasRole) return 'missing_role';
  return null;
}

interface InvitationResult {
  success: boolean;
  data?: { invitationId?: string; inviteLink?: string };
  error?: string;
  /** Set once the invitation is revoked, so the dead link is no longer offered. */
  cancelled?: boolean;
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
    setInvites([...invites, { email: '', orgRoleId: '' }]);
  }

  function removeInviteRow(index: number) {
    if (invites.length <= 1) return;
    setInvites(invites.filter((_, i) => i !== index));
  }

  // Derived, no extra state: a partially filled row is visible as an inline
  // error the moment it becomes incomplete, and blocks the send.
  const rowErrors = invites.map(rowError);
  const incompleteRowNumbers = rowErrors
    .map((error, index) => (error ? index + 1 : null))
    .filter((row): row is number => row !== null);
  const hasIncompleteRows = incompleteRowNumbers.length > 0;

  async function handleSend() {
    // Defensive guard: the button is disabled while a row is incomplete, but a
    // direct submit (Enter key) must not send a batch that skips a row.
    if (hasIncompleteRows) {
      toast.error(t('incomplete_rows', { rows: incompleteRowNumbers.join(', ') }));
      return;
    }

    const payload = invites
      .filter((i) => i.email.trim() && i.orgRoleId)
      .map((i) => ({ email: i.email.trim(), targetOrgRoleId: i.orgRoleId }));
    if (payload.length === 0) {
      toast.error(t('no_invites'));
      return;
    }

    setSending(true);
    try {
      const res = await fetch('/api/v1/organization/invites/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invitations: payload }),
      });

      const resJson = await res.json().catch(() => null);
      const bulkResults: InvitationResult[] = Array.isArray(resJson?.data?.results)
        ? resJson.data.results
        : [];

      // The endpoint is all-or-nothing: anything short of a 2xx carrying one
      // result per entry is a failure. Never report a partial send as success,
      // and keep the rows so the manager can retry.
      if (!res.ok || !resJson?.success || bulkResults.length !== payload.length) {
        toast.error(t('send_failed'));
        return;
      }

      setResults([...bulkResults, ...results]);
      toast.success(t('invitations_sent', { count: bulkResults.length }));
      setInvites([{ email: '', orgRoleId: '' }]);
      fetchInvitations();
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
        // Mark the send result of exactly this invitation as cancelled (#258).
        setResults((prev) =>
          prev.map((r) => (r.data?.invitationId === invitationId ? { ...r, cancelled: true } : r)),
        );
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
          {invites.map((invite, i) => {
            const error = rowErrors[i];
            const errorId = `row-error-${i}`;
            return (
              <div key={i} className="space-y-1">
                <div className="flex items-start gap-2">
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
                      aria-invalid={error === 'missing_email'}
                      aria-describedby={error === 'missing_email' ? errorId : undefined}
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
                      <SelectTrigger
                        id={`role-${i}`}
                        aria-invalid={error === 'missing_role'}
                        aria-describedby={error === 'missing_role' ? errorId : undefined}
                      >
                        <SelectValue placeholder={t('role_label')} />
                      </SelectTrigger>
                      <SelectContent>
                        {orgRoles.map((role) => (
                          <SelectItem key={role.id} value={role.id}>
                            {role.displayName ?? role.name}
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
                {error && (
                  <p id={errorId} className="text-xs text-destructive">
                    {t(
                      error === 'missing_email'
                        ? 'row_error_missing_email'
                        : 'row_error_missing_role',
                      {
                        row: i + 1,
                      },
                    )}
                  </p>
                )}
              </div>
            );
          })}

          <Button variant="outline" size="sm" onClick={addInviteRow}>
            <Plus className="size-4 mr-1" />
            {t('add_member')}
          </Button>

          <Button onClick={handleSend} className="w-full" disabled={sending || hasIncompleteRows}>
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
                  <Badge
                    variant={
                      result.cancelled ? 'outline' : result.success ? 'default' : 'destructive'
                    }
                  >
                    {result.cancelled
                      ? t('result_cancelled')
                      : result.success
                        ? t('success')
                        : t('failed')}
                  </Badge>
                  {!result.cancelled && result.data?.inviteLink && (
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
                          <span className="text-sm">
                            {orgRoles.find((r) => r.name === inv.orgRoleName)?.displayName ??
                              inv.orgRoleName}
                          </span>
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
                                  {role.displayName ?? role.name}
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
