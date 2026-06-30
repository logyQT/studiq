import { UserRole } from '@/types';

// TODO: Replace with async fetch from GET /api/v1/permissions/me
// This static map is a temporary copy of the backend RBAC data.

type Scope = 'own' | 'organization' | 'any';

const ROLE_PERMISSIONS: Record<UserRole, Record<string, Scope>> = {
  [UserRole.FREE]: {
    'flashcard.read': 'own',
    'flashcard.create': 'own',
    'flashcard.update': 'own',
    'flashcard.delete': 'own',
    'topic.read': 'own',
    'topic.create': 'own',
    'topic.update': 'own',
    'topic.delete': 'own',
    'deck.read': 'own',
    'deck.create': 'own',
    'deck.update': 'own',
    'deck.delete': 'own',
  },
  [UserRole.PREMIUM]: {
    'flashcard.read': 'own',
    'flashcard.create': 'own',
    'flashcard.update': 'own',
    'flashcard.delete': 'own',
    'topic.read': 'own',
    'topic.create': 'own',
    'topic.update': 'own',
    'topic.delete': 'own',
    'deck.read': 'own',
    'deck.create': 'own',
    'deck.update': 'own',
    'deck.delete': 'own',
  },
  [UserRole.STUDENT]: {
    'flashcard.read': 'organization',
    'flashcard.create': 'own',
    'flashcard.update': 'own',
    'flashcard.delete': 'own',
    'topic.read': 'organization',
    'topic.create': 'own',
    'topic.update': 'own',
    'topic.delete': 'own',
    'deck.read': 'organization',
    'deck.create': 'own',
    'deck.update': 'own',
    'deck.delete': 'own',
  },
  [UserRole.TEACHER]: {
    'flashcard.read': 'own',
    'flashcard.create': 'organization',
    'flashcard.update': 'own',
    'flashcard.delete': 'own',
    'topic.read': 'own',
    'topic.create': 'organization',
    'topic.update': 'own',
    'topic.delete': 'own',
    'deck.read': 'own',
    'deck.create': 'organization',
    'deck.update': 'own',
    'deck.delete': 'own',
  },
  [UserRole.UNIVERSITY_ADMIN]: {
    'flashcard.read': 'organization',
    'flashcard.create': 'own',
    'flashcard.update': 'organization',
    'flashcard.delete': 'organization',
    'topic.read': 'organization',
    'topic.create': 'own',
    'topic.update': 'organization',
    'topic.delete': 'organization',
    'deck.read': 'organization',
    'deck.create': 'own',
    'deck.update': 'organization',
    'deck.delete': 'organization',
  },
  [UserRole.SYS_ADMIN]: {
    'flashcard.read': 'any',
    'flashcard.create': 'any',
    'flashcard.update': 'any',
    'flashcard.delete': 'any',
    'topic.read': 'any',
    'topic.create': 'any',
    'topic.update': 'any',
    'topic.delete': 'any',
    'deck.read': 'any',
    'deck.create': 'any',
    'deck.update': 'any',
    'deck.delete': 'any',
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
