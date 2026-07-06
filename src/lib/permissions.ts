export type PermissionScope = 'own' | 'group' | 'organization' | 'any';

export const Permission = {
  FLASHCARD_READ: 'flashcard.read',
  FLASHCARD_CREATE: 'flashcard.create',
  FLASHCARD_UPDATE: 'flashcard.update',
  FLASHCARD_DELETE: 'flashcard.delete',
  TOPIC_READ: 'topic.read',
  TOPIC_CREATE: 'topic.create',
  TOPIC_UPDATE: 'topic.update',
  TOPIC_DELETE: 'topic.delete',
  DECK_READ: 'deck.read',
  DECK_CREATE: 'deck.create',
  DECK_UPDATE: 'deck.update',
  DECK_DELETE: 'deck.delete',
  QUESTION_READ: 'question.read',
  QUESTION_CREATE: 'question.create',
  QUESTION_UPDATE: 'question.update',
  QUESTION_DELETE: 'question.delete',
  QUESTION_BANK_READ: 'question_bank.read',
  QUESTION_BANK_CREATE: 'question_bank.create',
  QUESTION_BANK_UPDATE: 'question_bank.update',
  QUESTION_BANK_DELETE: 'question_bank.delete',
} as const;

export type PermissionKey = (typeof Permission)[keyof typeof Permission];

export interface ResourceAccess {
  createdBy: string;
  orgId: string | null;
  activeOrgId: string | null;
}

const SCOPE_ORDER: Record<PermissionScope, number> = {
  own: 0,
  group: 1,
  organization: 2,
  any: 3,
};

export function evaluateScope(
  scope: PermissionScope | null | undefined,
  userId: string,
  resource: ResourceAccess,
): boolean {
  if (!scope) return false;

  if (resource.createdBy === userId) return true;

  const level = SCOPE_ORDER[scope];
  if (level < 1) return false;

  if (level < 2) return false;

  if (resource.activeOrgId != null && resource.orgId === resource.activeOrgId) return true;
  if (level < 3) return false;

  return true;
}

export const DEFAULT_ROLE_PERMISSIONS: Record<string, Record<string, PermissionScope>> = {
  member: {
    'deck.read': 'group',
    'deck.create': 'own',
    'deck.update': 'own',
    'deck.delete': 'own',
    'flashcard.read': 'group',
    'flashcard.create': 'own',
    'flashcard.update': 'own',
    'flashcard.delete': 'own',
    'topic.read': 'group',
    'topic.create': 'own',
    'topic.update': 'own',
    'topic.delete': 'own',
    'question.read': 'group',
    'question.create': 'own',
    'question.update': 'own',
    'question.delete': 'own',
    'question_bank.read': 'group',
    'question_bank.create': 'own',
    'question_bank.update': 'own',
    'question_bank.delete': 'own',
  },

  teacher: {
    'deck.read': 'own',
    'deck.create': 'own',
    'deck.update': 'own',
    'deck.delete': 'own',
    'flashcard.read': 'own',
    'flashcard.create': 'own',
    'flashcard.update': 'own',
    'flashcard.delete': 'own',
    'topic.read': 'own',
    'topic.create': 'own',
    'topic.update': 'own',
    'topic.delete': 'own',
    'question.read': 'own',
    'question.create': 'own',
    'question.update': 'own',
    'question.delete': 'own',
    'question_bank.read': 'own',
    'question_bank.create': 'own',
    'question_bank.update': 'own',
    'question_bank.delete': 'own',
  },

  admin: {
    'deck.read': 'organization',
    'deck.create': 'organization',
    'deck.update': 'organization',
    'deck.delete': 'organization',
    'flashcard.read': 'organization',
    'flashcard.create': 'organization',
    'flashcard.update': 'organization',
    'flashcard.delete': 'organization',
    'topic.read': 'organization',
    'topic.create': 'organization',
    'topic.update': 'organization',
    'topic.delete': 'organization',
    'question.read': 'organization',
    'question.create': 'organization',
    'question.update': 'organization',
    'question.delete': 'organization',
    'question_bank.read': 'organization',
    'question_bank.create': 'organization',
    'question_bank.update': 'organization',
    'question_bank.delete': 'organization',
  },
};
