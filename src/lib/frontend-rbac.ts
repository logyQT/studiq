import { UserRole } from '@/types';

type Scope = 'own' | 'university' | 'any';

const ROLE_PERMISSIONS: Record<UserRole, Record<string, Scope>> = {
  [UserRole.FREE]: {
    'deck.update': 'own',
    'deck.delete': 'own',
    'flashcard.update': 'own',
    'flashcard.delete': 'own',
  },
  [UserRole.PREMIUM]: {
    'deck.update': 'own',
    'deck.delete': 'own',
    'flashcard.update': 'own',
    'flashcard.delete': 'own',
  },
  [UserRole.STUDENT]: {
    'deck.update': 'own',
    'deck.delete': 'own',
    'flashcard.update': 'own',
    'flashcard.delete': 'own',
  },
  [UserRole.TEACHER]: {
    'deck.update': 'university',
    'deck.delete': 'university',
    'flashcard.update': 'university',
    'flashcard.delete': 'university',
  },
  [UserRole.UNIVERSITY_ADMIN]: {
    'deck.update': 'university',
    'deck.delete': 'university',
    'flashcard.update': 'university',
    'flashcard.delete': 'university',
  },
  [UserRole.SYS_ADMIN]: {
    'deck.update': 'any',
    'deck.delete': 'any',
    'flashcard.update': 'any',
    'flashcard.delete': 'any',
  },
};

export function can(
  role: UserRole | undefined,
  permission: string,
  createdBy: string | undefined,
  userId: string | undefined,
): boolean {
  if (!role || !userId || !createdBy) return false;
  const scope = ROLE_PERMISSIONS[role]?.[permission];
  if (!scope) return false;
  if (scope === 'any') return true;
  if (scope === 'university') return true;
  return createdBy === userId;
}
