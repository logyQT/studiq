import type { Nullable } from '@/types';
import { UserRole } from '@/types';

export interface RequestContext {
  traceId: string;
  userId: string;
  activeOrgId: Nullable<string>;
  role: UserRole;
  url: string;
  method: string;
}
