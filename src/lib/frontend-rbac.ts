import { UserRole } from '@/types';

type Scope = 'own' | 'university' | 'any';

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
    'deck.read': 'university',
    'deck.update': 'university',
    'deck.delete': 'university',
    'flashcard.read': 'university',
    'flashcard.update': 'university',
    'flashcard.delete': 'university',
  },
  [UserRole.UNIVERSITY_ADMIN]: {
    'deck.read': 'university',
    'deck.update': 'university',
    'deck.delete': 'university',
    'flashcard.read': 'university',
    'flashcard.update': 'university',
    'flashcard.delete': 'university',
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
): boolean {
  if (!role || !userId || !createdBy) return false;
  const scope = ROLE_PERMISSIONS[role]?.[permission];
  if (!scope) return false;
  if (scope === 'any') return true;
  if (scope === 'university') return true;
  return createdBy === userId;
}
