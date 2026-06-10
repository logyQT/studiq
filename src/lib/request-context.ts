import type { Nullable } from '@/types';
import { UserRole } from '@/types';

export interface RequestContext {
  userId: string;
  universityId: Nullable<string>;
  role: UserRole;
  url: string;
  method: string;
}
