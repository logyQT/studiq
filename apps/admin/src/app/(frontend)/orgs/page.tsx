'use client';

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderOpen, Shield, Users } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { QueryError } from '@/app/(frontend)/components/query-error';
import { ApiError, apiGet, apiPut } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

type Org = {
  id: string;
  name: string;
  plan: string;
  created_at: string;
  member_count: number;
  group_count: number;
  role_count: number;
};

type PlanOption = {
  key: string;
  name: string;
  scope: string;
};

export default function OrgsPage() {
  const t = useTranslations('Orgs');

  const {
    data: orgs = [],
    error,
    isLoading,
    isError,
  } = useQuery({
    queryKey: queryKeys.organizations.all,
    queryFn: () => apiGet<Org[]>('/organizations'),
  });

  // The plan column names the row the organization points at; the field stays
  // the key, so a plan the catalogue no longer holds still prints something.
  const { data: plans = [] } = useQuery({
    queryKey: queryKeys.subscriptionPlans.all,
    queryFn: () => apiGet<PlanOption[]>('/subscription-plans'),
  });

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground mt-1">{t('description')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('list_title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">{t('loading')}</p>
          ) : isError ? (
            <QueryError error={error} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('col_name')}</TableHead>
                  <TableHead>{t('col_members')}</TableHead>
                  <TableHead>{t('col_groups')}</TableHead>
                  <TableHead>{t('col_roles')}</TableHead>
                  <TableHead>{t('col_plan')}</TableHead>
                  <TableHead>{t('col_created')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orgs.map((org) => (
                  <TableRow key={org.id}>
                    <TableCell>
                      <Link
                        href={`/orgs/${org.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {org.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1.5">
                        <Users className="h-3.5 w-3.5 text-muted-foreground" />
                        {org.member_count}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1.5">
                        <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
                        {org.group_count}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1.5">
                        <Shield className="h-3.5 w-3.5 text-muted-foreground" />
                        {org.role_count}
                      </span>
                    </TableCell>
                    <TableCell>
                      <OrgPlanEditor org={org} plans={plans} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(org.created_at).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
                {orgs.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      {t('empty')}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * The plan picker (B3 follow-up). It sets `organizations.plan` through
 * `change_org_plan`, which is the only writer, so an unlisted plan the
 * organization is not assigned to is refused by the database and reported as a
 * state rule the operator can fix, never as a stack trace.
 */
function OrgPlanEditor({ org, plans }: { org: Org; plans: PlanOption[] }) {
  const t = useTranslations('Orgs');
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (plan: string) => apiPut(`/organizations/${org.id}/plan`, { plan }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.organizations.all });
    },
    onError: (err: Error) => {
      if (err instanceof ApiError && err.code === 'BAD_REQUEST') {
        setError(t('plan_error_scope'));
        return;
      }
      if (err instanceof ApiError && err.code === 'CONFLICT') {
        setError(t('plan_error_unassigned'));
        return;
      }
      if (err instanceof ApiError && err.code === 'NOT_FOUND') {
        setError(t('plan_error_unknown'));
        return;
      }
      setError(t('plan_error_failed', { code: err.message }));
    },
  });

  // Only an organization plan may be the organization's plan: the database
  // refuses any other scope, so the picker does not offer one.
  const orgPlans = plans.filter((plan) => plan.scope === 'organization');
  const currentPlan = plans.find((plan) => plan.key === org.plan);

  if (!orgPlans.some((plan) => plan.key === org.plan)) {
    // A legacy row on another scope stays visible as text instead of blanking
    // the picker. The database refuses a personal plan, so this row cannot be
    // created today; it only appears on a row that predates the rule.
    return (
      <span className="text-sm">
        {currentPlan?.name ?? org.plan}
        {currentPlan && (
          <span className="ml-1 font-mono text-xs text-muted-foreground">{org.plan}</span>
        )}
      </span>
    );
  }

  const value = draft ?? org.plan;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Select value={value} onValueChange={setDraft}>
          <SelectTrigger className="h-8 w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {orgPlans.map((plan) => (
              <SelectItem key={plan.key} value={plan.key}>
                {plan.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          disabled={value === org.plan || mutation.isPending}
          onClick={() => mutation.mutate(value)}
        >
          {t('plan_move')}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
