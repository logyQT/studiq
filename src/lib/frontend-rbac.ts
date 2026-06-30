import { UserRole } from '@/types';

type Scope = 'own' | 'organization' | 'any';

const ROLE_PERMISSIONS: Record<UserRole, Record<string, Scope>> = {
  [UserRole.FREE]: {
    'deck.read': 'own',
    'deck.update': 'own',
    'deck.delete': 'own',
    'flashcard.read': 'own',
    'flashcard.update': 'own',
    'flashcard.delete': 'own',
  },
  [UserRole.PREMIUM]: {
    'deck.read': 'own',
    'deck.update': 'own',
    'deck.delete': 'own',
    'flashcard.read': 'own',
    'flashcard.update': 'own',
    'flashcard.delete': 'own',
  },
  [UserRole.STUDENT]: {
    'deck.read': 'own',
    'deck.update': 'own',
    'deck.delete': 'own',
    'flashcard.read': 'own',
    'flashcard.update': 'own',
    'flashcard.delete': 'own',
  },
  [UserRole.TEACHER]: {
    'deck.read': 'organization',
    'deck.update': 'organization',
    'deck.delete': 'organization',
    'flashcard.read': 'organization',
    'flashcard.update': 'organization',
    'flashcard.delete': 'organization',
  },
  [UserRole.UNIVERSITY_ADMIN]: {
    'deck.read': 'organization',
    'deck.update': 'organization',
    'deck.delete': 'organization',
    'flashcard.read': 'organization',
    'flashcard.update': 'organization',
    'flashcard.delete': 'organization',
  },
  [UserRole.SYS_ADMIN]: {
    'deck.read': 'any',
    'deck.update': 'any',
    'deck.delete': 'any',
    'flashcard.read': 'any',
    'flashcard.update': 'any',
    'flashcard.delete': 'any',
  },
};

export function can(
  role: UserRole | undefined,
  permission: string,
  createdBy: string | undefined,
  userId: string | undefined,
  activeOrgId?: string | null,
): boolean {
  if (!role || !userId || !createdBy) return false;
  const scope = ROLE_PERMISSIONS[role]?.[permission];
  if (!scope) return false;
  if (scope === 'any') return true;
  if (scope === 'organization' && activeOrgId === undefined) return true;
  if (scope === 'organization') return activeOrgId != null;
  return createdBy === userId;
}
