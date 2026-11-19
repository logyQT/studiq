'use client';

import {
  ENTITLEMENT_PROFILES,
  type EntitlementProfile,
  isCatalogScope,
  isPermissionCatalogKey,
  isRoleTemplateName,
  PERMISSIONS,
  ROLE_TEMPLATE_NAMES,
  type CatalogScope,
  type PermissionCatalogKey,
  type RoleTemplateName,
} from '@studiq/authz';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Loader2, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { SrLabel } from '@/components/shared/sr-label';
import { EmptyState, ErrorState } from '@/components/shared/empty-state';
import { useOrgs } from '@/hooks/use-orgs';
import { useOrgScopedLoad } from '@/hooks/use-org-scoped-load';
import { usePermission } from '@/hooks/use-permission';
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from '@/lib/api';
import { isArrayOf } from '@/lib/unknown-value';

/** The closed catalog, grouped by key family: content families, then groups, then org. */
const CATALOG_KEYS: readonly PermissionCatalogKey[] =
  Object.keys(PERMISSIONS).filter(isPermissionCatalogKey);

const CATALOG_SECTIONS = CATALOG_KEYS.reduce<{ family: string; keys: PermissionCatalogKey[] }[]>(
  (sections, key) => {
    const family = key.slice(0, key.indexOf('.'));
    const section = sections.find((candidate) => candidate.family === family);
    if (section) section.keys.push(key);
    else sections.push({ family, keys: [key] });
    return sections;
  },
  [],
);

/** Section heading per catalog family; a family without a message falls back to its name. */
const SECTION_LABEL_KEYS: Record<string, string> = {
  flashcard: 'section_flashcards',
  deck: 'section_decks',
  topic: 'section_topics',
  question: 'section_questions',
  question_bank: 'section_question_banks',
  quiz: 'section_quizzes',
  assignment: 'section_assignments',
  stats: 'section_stats',
  group: 'section_classes',
  org: 'section_organization',
};

/** next-intl's translator, including `has` for catalog keys a locale may not name yet. */
interface RolesTranslator {
  (key: string, values?: Record<string, string | number>): string;
  has: (key: string) => boolean;
}

type ScopeMap = Record<string, CatalogScope | null>;

interface OrgRole {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  entitlementProfile: EntitlementProfile;
  memberCount: number;
  permissionCount: number;
}

interface OrgRoleDetail extends OrgRole {
  permissions: { permissionName: string; scope: string }[];
}

interface RolePermission {
  permissionName: string;
  scope: CatalogScope | null;
}

export default function RolesPage() {
  const t = useTranslations('ManageRolesPage');
  const permission = usePermission();
  const { activeOrg } = useOrgs();
  // The write gate is `org.role.manage` (ADR-0015 §4.4). `usePermission()` is a
  // provisional `false` until /permissions/me resolves, so the write affordances
  // stay fail-closed; the list is ungated and stays readable for every member.
  const canBuild = permission('org.role.manage', { orgId: activeOrg?.id });
  const [data, setData] = useState<OrgRole[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState<OrgRole | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<OrgRole | null>(null);
  const [permRole, setPermRole] = useState<OrgRoleDetail | null>(null);
  const [permDialogOpen, setPermDialogOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const roles: unknown = await apiGet('/api/v1/organization/roles');
      setData(isArrayOf<OrgRole>(roles) ? roles : []);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useOrgScopedLoad(load);

  async function handleSave(
    role: { name: string; description?: string | null; template?: RoleTemplateName },
    id?: string,
  ) {
    try {
      if (id) await apiPut(`/api/v1/organization/roles/${id}`, role);
      else await apiPost('/api/v1/organization/roles', role);
      toast.success(id ? t('role_updated') : t('role_created'));
      setEditing(null);
      setCreating(false);
      void load();
    } catch {
      toast.error(t(id ? 'update_failed' : 'create_failed'));
    }
  }

  async function handleDelete(id: string) {
    try {
      await apiDelete(`/api/v1/organization/roles/${id}`);
      toast.success(t('role_deleted'));
      setDeleting(null);
      void load();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'FORBIDDEN') {
        toast.error(t('cant_delete_system'));
        setDeleting(null);
      } else if (error instanceof ApiError && error.code === 'CONFLICT') {
        toast.error(t('cant_delete_has_members'));
        setDeleting(null);
      } else {
        toast.error(t('delete_failed'));
      }
    }
  }

  async function openPermEditor(role: OrgRole) {
    try {
      setPermRole(await apiGet<OrgRoleDetail>(`/api/v1/organization/roles/${role.id}`));
      setPermDialogOpen(true);
    } catch {
      toast.error(t('perms_save_failed'));
    }
  }

  async function handleSavePermissions(
    roleId: string,
    permissions: RolePermission[],
    entitlementProfile: EntitlementProfile | null,
  ) {
    try {
      await apiPut(`/api/v1/organization/roles/${roleId}/permissions`, { permissions });
      // `null` = the editor does not manage this role's profile (system roles).
      if (entitlementProfile !== null) {
        await apiPut(`/api/v1/organization/roles/${roleId}`, { entitlementProfile });
      }
      toast.success(t('perms_saved'));
      setPermDialogOpen(false);
      setPermRole(null);
      void load();
    } catch {
      toast.error(t('perms_save_failed'));
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <Loader2 className="size-5 animate-spin mr-2" />
        {t('common_loading')}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        {canBuild && (
          <Dialog open={creating} onOpenChange={setCreating}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                {t('new_role')}
              </Button>
            </DialogTrigger>
            <DialogContent aria-describedby={undefined}>
              <DialogHeader>
                <DialogTitle>{t('create_title')}</DialogTitle>
              </DialogHeader>
              <RoleForm onSave={(r) => handleSave(r)} onCancel={() => setCreating(false)} t={t} />
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('col_name')}</TableHead>
                <TableHead className="text-center">{t('col_type')}</TableHead>
                <TableHead className="text-center">{t('col_members')}</TableHead>
                <TableHead className="text-center">{t('col_permissions')}</TableHead>
                {canBuild && <TableHead className="text-right">{t('col_actions')}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.map((role) => (
                <TableRow key={role.id}>
                  <TableCell>
                    <div>
                      <p className="font-medium">{role.name}</p>
                      {role.description && (
                        <p className="text-xs text-muted-foreground">{role.description}</p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant={role.isSystem ? 'secondary' : 'default'}>
                      {role.isSystem ? t('type_system') : t('type_custom')}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant={role.memberCount > 0 ? 'secondary' : 'outline'}>
                      {role.memberCount}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    {t('permissions_count', { count: role.permissionCount })}
                  </TableCell>
                  {canBuild && (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openPermEditor(role)}>
                          <ShieldCheck className="w-4 h-4" />
                          <SrLabel k="role_permissions" values={{ name: role.name }} />
                        </Button>
                        <Dialog
                          open={editing?.id === role.id}
                          onOpenChange={(o) => !o && setEditing(null)}
                        >
                          <DialogTrigger asChild>
                            <Button variant="ghost" size="icon" onClick={() => setEditing(role)}>
                              <Pencil className="w-4 h-4" />
                              <SrLabel k="edit_role" values={{ name: role.name }} />
                            </Button>
                          </DialogTrigger>
                          <DialogContent aria-describedby={undefined}>
                            <DialogHeader>
                              <DialogTitle>{t('edit_title')}</DialogTitle>
                            </DialogHeader>
                            {editing?.id === role.id && (
                              <RoleForm
                                initial={role}
                                onSave={(r) => handleSave(r, role.id)}
                                onCancel={() => setEditing(null)}
                                t={t}
                              />
                            )}
                          </DialogContent>
                        </Dialog>
                        {!role.isSystem && (
                          <Dialog
                            open={deleting?.id === role.id}
                            onOpenChange={(o) => !o && setDeleting(null)}
                          >
                            <DialogTrigger asChild>
                              <Button variant="ghost" size="icon" onClick={() => setDeleting(role)}>
                                <Trash2 className="w-4 h-4 text-destructive" />
                                <SrLabel k="delete_role" values={{ name: role.name }} />
                              </Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>{t('delete_title')}</DialogTitle>
                                <DialogDescription>{t('delete_desc')}</DialogDescription>
                              </DialogHeader>
                              <DialogFooter>
                                <Button variant="outline" onClick={() => setDeleting(null)}>
                                  {t('common_cancel')}
                                </Button>
                                <Button variant="destructive" onClick={() => handleDelete(role.id)}>
                                  {t('common_delete')}
                                </Button>
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {(!data || data.length === 0) && (
                <TableRow>
                  <TableCell colSpan={canBuild ? 5 : 4} className="p-0">
                    {loadError ? (
                      <ErrorState compact onRetry={load} />
                    ) : (
                      <EmptyState compact icon={ShieldCheck} title={t('no_roles')} />
                    )}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <PermissionEditorDialog
        key={permRole?.id ?? 'perm-editor'}
        open={permDialogOpen}
        onOpenChange={(o) => {
          setPermDialogOpen(o);
          if (!o) setPermRole(null);
        }}
        role={permRole}
        t={t}
        onSave={handleSavePermissions}
      />
    </div>
  );
}

/**
 * Create/edit form. The template picker is create-only: a template describes the
 * permission rows a *new* role starts with (D17), so an edit never offers one —
 * permissions are edited in the permission dialog instead.
 */
interface RoleFormProps {
  initial?: OrgRole;
  onSave: (role: {
    name: string;
    description?: string | null;
    template?: RoleTemplateName;
  }) => Promise<void>;
  onCancel: () => void;
  t: RolesTranslator;
}

function RoleForm({ initial, onSave, onCancel, t }: RoleFormProps) {
  const [draft, setDraft] = useState({
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    template: 'blank' as RoleTemplateName,
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await onSave({
      name: draft.name,
      description: draft.description || null,
      ...(initial ? {} : { template: draft.template }),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="role-name">{t('name_label')}</Label>
        <Input
          id="role-name"
          value={draft.name}
          onChange={(e) => setDraft((current) => ({ ...current, name: e.target.value }))}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="role-description">{t('description_label')}</Label>
        <Input
          id="role-description"
          value={draft.description}
          onChange={(e) => setDraft((current) => ({ ...current, description: e.target.value }))}
        />
      </div>
      {!initial && (
        <div className="space-y-2">
          <Label htmlFor="role-template">{t('template_label')}</Label>
          <Select
            value={draft.template}
            onValueChange={(value) => {
              if (!isRoleTemplateName(value)) return;
              setDraft((current) => ({ ...current, template: value }));
            }}
          >
            <SelectTrigger id="role-template" className="w-full" aria-label={t('template_label')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLE_TEMPLATE_NAMES.map((name) => (
                <SelectItem key={name} value={name}>
                  {t(`template_${name}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{t('template_hint')}</p>
        </div>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('common_cancel')}
        </Button>
        <Button type="submit">{initial ? t('common_save') : t('common_create')}</Button>
      </DialogFooter>
    </form>
  );
}

function PermissionEditorDialog({
  open,
  onOpenChange,
  role,
  t,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: OrgRoleDetail | null;
  t: RolesTranslator;
  onSave: (
    roleId: string,
    permissions: RolePermission[],
    entitlementProfile: EntitlementProfile | null,
  ) => Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="max-w-2xl max-h-[80vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>{t('perms_title', { name: role?.name ?? '' })}</DialogTitle>
        </DialogHeader>
        {/* Radix unmounts the content on close, so the editor state is rebuilt from
            the role the page just fetched every time the dialog opens. */}
        {role && (
          <PermissionEditorBody
            role={role}
            t={t}
            onSave={onSave}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The role's current scopes, one entry per catalog key (`null` = not granted). */
function initialScopes(role: OrgRoleDetail): ScopeMap {
  const storedScopes = new Map(role.permissions.map((p) => [p.permissionName, p.scope]));
  const scopes: ScopeMap = {};

  for (const key of CATALOG_KEYS) {
    const stored = storedScopes.get(key);
    const allowed: readonly string[] = PERMISSIONS[key].allowedScopes;
    // The old editor accepted free strings, so a stored scope can fall outside the
    // catalog's allowed set. Such a grant falls back to revoked, never to a wider
    // scope than the role held (the first allowed scope can be wider — e.g.
    // `group.invite`, where `any` is not one of `own | group | organization`).
    scopes[key] =
      stored !== undefined && isCatalogScope(stored) && allowed.includes(stored) ? stored : null;
  }

  return scopes;
}

function actionLabel(key: string, t: RolesTranslator): string {
  const action = key.slice(key.indexOf('.') + 1).replaceAll('.', '_');
  const messageKey = `action_${action}`;
  return t.has(messageKey) ? t(messageKey) : action.replaceAll('_', ' ');
}

function sectionTitle(family: string, t: RolesTranslator): string {
  const messageKey = SECTION_LABEL_KEYS[family];
  return messageKey && t.has(messageKey) ? t(messageKey) : family;
}

function PermissionEditorBody({
  role,
  t,
  onSave,
  onCancel,
}: {
  role: OrgRoleDetail;
  t: RolesTranslator;
  onSave: (
    roleId: string,
    permissions: RolePermission[],
    entitlementProfile: EntitlementProfile | null,
  ) => Promise<void>;
  onCancel: () => void;
}) {
  const [scopes, setScopes] = useState<ScopeMap>(() => initialScopes(role));
  const [profile, setProfile] = useState<EntitlementProfile>(role.entitlementProfile);

  function grant(key: PermissionCatalogKey, granted: boolean) {
    // A granted key starts at its narrowest allowed scope (ADR §4.1).
    const next = granted ? PERMISSIONS[key].allowedScopes[0] : null;
    setScopes((current) => ({ ...current, [key]: next }));
  }

  function setScope(key: PermissionCatalogKey, scope: CatalogScope) {
    setScopes((current) => ({ ...current, [key]: scope }));
  }

  return (
    <>
      <p className="text-xs text-muted-foreground">{t('perms_hint')}</p>
      <div className="space-y-6 py-4">
        {CATALOG_SECTIONS.map((section) => (
          <div key={section.family}>
            <h3 className="text-sm font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
              {sectionTitle(section.family, t)}
            </h3>
            <div className="space-y-2">
              {section.keys.map((key) => (
                <PermissionRow
                  key={key}
                  permissionKey={key}
                  scope={scopes[key] ?? null}
                  // Ownership is not grantable through the editor (D16): a held
                  // `org.admin` stays a no-op, an absent one stays revoked.
                  locked={!PERMISSIONS[key].assignable}
                  t={t}
                  onGrant={(granted) => grant(key, granted)}
                  onScope={(scope) => setScope(key, scope)}
                />
              ))}
            </div>
          </div>
        ))}

        {/* A system role's profile is what its entitlement surface rests on: the
            Admin role's `all` must not be movable from the dictionary editor. */}
        {!role.isSystem && (
          <fieldset className="space-y-2 border-t pt-4">
            <legend className="text-sm font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
              {t('profile_title')}
            </legend>
            <p className="text-xs text-muted-foreground">{t('profile_hint')}</p>
            <div className="flex flex-wrap gap-4">
              {ENTITLEMENT_PROFILES.map((candidate) => (
                <label key={candidate} className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="entitlement-profile"
                    value={candidate}
                    checked={profile === candidate}
                    onChange={() => setProfile(candidate)}
                    data-profile-radio="true"
                    className="size-4"
                  />
                  <span>{t(`profile_${candidate}`)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          {t('common_cancel')}
        </Button>
        <Button
          onClick={() => {
            // The payload is the role's whole set: one entry per catalog key, so a
            // save can never delete a permission it did not render (D24).
            const permissions: RolePermission[] = CATALOG_KEYS.map((key) => ({
              permissionName: key,
              scope: scopes[key] ?? null,
            }));
            void onSave(role.id, permissions, role.isSystem ? null : profile);
          }}
        >
          {t('perms_save')}
        </Button>
      </DialogFooter>
    </>
  );
}

function PermissionRow({
  permissionKey,
  scope,
  locked,
  t,
  onGrant,
  onScope,
}: {
  permissionKey: PermissionCatalogKey;
  scope: CatalogScope | null;
  locked: boolean;
  t: RolesTranslator;
  onGrant: (granted: boolean) => void;
  onScope: (scope: CatalogScope) => void;
}) {
  const granted = scope !== null;

  return (
    <div className="flex items-center justify-between gap-4 text-sm" data-perm-row={permissionKey}>
      <label className="flex flex-1 items-center gap-2 font-medium">
        <input
          type="checkbox"
          name={permissionKey}
          checked={granted}
          disabled={locked}
          onChange={(e) => onGrant(e.target.checked)}
          data-perm-toggle="true"
          className="size-4"
        />
        <span>{actionLabel(permissionKey, t)}</span>
      </label>
      <div className="flex gap-4">
        {PERMISSIONS[permissionKey].allowedScopes.map((candidate) => (
          <label
            key={candidate}
            className={`flex items-center gap-1.5 ${locked || !granted ? 'opacity-50' : 'cursor-pointer'}`}
          >
            <input
              type="radio"
              name={permissionKey}
              value={candidate}
              checked={scope === candidate}
              disabled={locked || !granted}
              onChange={() => onScope(candidate)}
              data-perm-radio="true"
              className="size-4"
            />
            <span className="text-muted-foreground">{t(`scope_${candidate}`)}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
