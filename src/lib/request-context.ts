import type { AccountType, Nullable } from '@/types';

export interface RequestContext {
  traceId: string;
  userId: string;
  accountType: AccountType;
  orgRoleId: string | null;
  activeOrgId: Nullable<string>;
  url: string;
  method: string;
}
