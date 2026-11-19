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
  ASSIGNMENT_CREATE: 'assignment.create',
  ASSIGNMENT_READ: 'assignment.read',
  ASSIGNMENT_UPDATE: 'assignment.update',
  ASSIGNMENT_DELETE: 'assignment.delete',
  ASSIGNMENT_PUBLISH: 'assignment.publish',
  ASSIGNMENT_GRADE: 'assignment.grade',
} as const;

export type PermissionKey = (typeof Permission)[keyof typeof Permission];

/** The three scopes a catalog permission can declare (ADR-0015 §4.1). */
export type CatalogScope = 'own' | 'group' | 'organization';

export type PermissionCategory = 'content' | 'group' | 'org';

export interface PermissionDefinition {
  category: PermissionCategory;
  /** The scopes a role may hold this permission at, in the role editor. */
  allowedScopes: readonly CatalogScope[];
  /** Whether a custom role may be granted the key at all. */
  assignable: boolean;
  description: string;
}

const CONTENT_SCOPES = ['own', 'group', 'organization'] as const;
const GROUP_SCOPES = ['own', 'group', 'organization'] as const;
const GROUP_INVITE_SCOPES = ['group', 'organization'] as const;
const ORG_SCOPES = ['organization'] as const;

/**
 * The closed permission catalog (ADR-0015 §4.1). `permissions` in the database
 * is this object — `__tests__/integration/catalog-invariants.test.ts` fails on
 * any divergence between the two. `Permission` stays the narrower 26-key set
 * that code reads through `ctx.permissionScopes`; every one of its keys is here.
 *
 * `org.admin` is ownership only and is not assignable to a custom role (D16).
 */
export const PERMISSIONS = {
  'flashcard.read': {
    category: 'content',
    allowedScopes: CONTENT_SCOPES,
    assignable: true,
    description: 'Read flashcards',
  },
  'flashcard.create': {
    category: 'content',
    allowedScopes: CONTENT_SCOPES,
    assignable: true,
    description: 'Create flashcards',
  },
  'flashcard.update': {
    category: 'content',
    allowedScopes: CONTENT_SCOPES,
    assignable: true,
    description: 'Edit flashcards',
  },
  'flashcard.delete': {
    category: 'content',
    allowedScopes: CONTENT_SCOPES,
    assignable: true,
    description: 'Delete flashcards',
  },
  'deck.read': {
    category: 'content',
    allowedScopes: CONTENT_SCOPES,
    assignable: true,
    description: 'Read decks',
  },
  'deck.create': {
    category: 'content',
    allowedScopes: CONTENT_SCOPES,
    assignable: true,
    description: 'Create decks',
  },
  'deck.update': {
    category: 'content',
    allowedScopes: CONTENT_SCOPES,
    assignable: true,
    description: 'Edit decks',
  },
  'deck.delete': {
    category: 'content',
    allowedScopes: CONTENT_SCOPES,
    assignable: true,
    description: 'Delete decks',
  },
  'topic.read': {
    category: 'content',
    allowedScopes: CONTENT_SCOPES,
    assignable: true,
    description: 'Read topics',
  },
  'topic.create': {
    category: 'content',
    allowedScopes: CONTENT_SCOPES,
    assignable: true,
    description: 'Create topics',
  },
  'topic.update': {
    category: 'content',
    allowedScopes: CONTENT_SCOPES,
    assignable: true,
    description: 'Edit topics',
  },
  'topic.delete': {
    category: 'content',
    allowedScopes: CONTENT_SCOPES,
    assignable: true,
    description: 'Delete topics',
  },
  'question.read': {
    category: 'content',
    allowedScopes: CONTENT_SCOPES,
    assignable: true,
    description: 'Read questions',
  },
  'question.create': {
    category: 'content',
    allowedScopes: CONTENT_SCOPES,
    assignable: true,
    description: 'Create questions',
  },
  'question.update': {
    category: 'content',
    allowedScopes: CONTENT_SCOPES,
    assignable: true,
    description: 'Edit questions',
  },
  'question.delete': {
    category: 'content',
    allowedScopes: CONTENT_SCOPES,
    assignable: true,
    description: 'Delete questions',
  },
  'question_bank.read': {
    category: 'content',
    allowedScopes: CONTENT_SCOPES,
    assignable: true,
    description: 'Read question banks',
  },
  'question_bank.create': {
    category: 'content',
    allowedScopes: CONTENT_SCOPES,
    assignable: true,
    description: 'Create question banks',
  },
  'question_bank.update': {
    category: 'content',
    allowedScopes: CONTENT_SCOPES,
    assignable: true,
    description: 'Edit question banks',
  },
  'question_bank.delete': {
    category: 'content',
    allowedScopes: CONTENT_SCOPES,
    assignable: true,
    description: 'Delete question banks',
  },
  'quiz.read': {
    category: 'content',
    allowedScopes: CONTENT_SCOPES,
    assignable: true,
    description: 'Read quizzes',
  },
  'quiz.create': {
    category: 'content',
    allowedScopes: CONTENT_SCOPES,
    assignable: true,
    description: 'Create quizzes',
  },
  'quiz.update': {
    category: 'content',
    allowedScopes: CONTENT_SCOPES,
    assignable: true,
    description: 'Edit quizzes',
  },
  'quiz.delete': {
    category: 'content',
    allowedScopes: CONTENT_SCOPES,
    assignable: true,
    description: 'Delete quizzes',
  },
  'assignment.read': {
    category: 'content',
    allowedScopes: CONTENT_SCOPES,
    assignable: true,
    description: 'Read assignments',
  },
  'assignment.create': {
    category: 'content',
    allowedScopes: CONTENT_SCOPES,
    assignable: true,
    description: 'Create assignments',
  },
  'assignment.update': {
    category: 'content',
    allowedScopes: CONTENT_SCOPES,
    assignable: true,
    description: 'Edit assignments',
  },
  'assignment.delete': {
    category: 'content',
    allowedScopes: CONTENT_SCOPES,
    assignable: true,
    description: 'Delete assignments',
  },
  'assignment.publish': {
    category: 'content',
    allowedScopes: CONTENT_SCOPES,
    assignable: true,
    description: 'Publish assignments to a class',
  },
  'assignment.grade': {
    category: 'content',
    allowedScopes: CONTENT_SCOPES,
    assignable: true,
    description: 'Grade assignment submissions',
  },
  'stats.read': {
    category: 'content',
    allowedScopes: CONTENT_SCOPES,
    assignable: true,
    description: 'Read study statistics',
  },
  'group.read': {
    category: 'group',
    allowedScopes: GROUP_SCOPES,
    assignable: true,
    description: 'Read classes',
  },
  'group.manage': {
    category: 'group',
    allowedScopes: GROUP_SCOPES,
    assignable: true,
    description: 'Create, edit and delete classes',
  },
  'group.member.manage': {
    category: 'group',
    allowedScopes: GROUP_SCOPES,
    assignable: true,
    description: 'Add and remove class members',
  },
  'group.invite': {
    category: 'group',
    allowedScopes: GROUP_INVITE_SCOPES,
    assignable: true,
    description: 'Invite existing org members to a class',
  },
  'org.settings.manage': {
    category: 'org',
    allowedScopes: ORG_SCOPES,
    assignable: true,
    description: 'Edit organization name, slug and general settings',
  },
  'org.member.manage': {
    category: 'org',
    allowedScopes: ORG_SCOPES,
    assignable: true,
    description: 'Change member roles and remove members',
  },
  'org.invitation.manage': {
    category: 'org',
    allowedScopes: ORG_SCOPES,
    assignable: true,
    description: 'Invite people to the organization',
  },
  'org.role.manage': {
    category: 'org',
    allowedScopes: ORG_SCOPES,
    assignable: true,
    description: 'Create and edit roles and their permissions',
  },
  'org.seat.manage': {
    category: 'org',
    allowedScopes: ORG_SCOPES,
    assignable: true,
    description: 'Manage seat pools and seat assignments',
  },
  'org.billing.manage': {
    category: 'org',
    allowedScopes: ORG_SCOPES,
    assignable: true,
    description: 'Manage the organization plan and billing',
  },
  'org.report.manage': {
    category: 'org',
    allowedScopes: ORG_SCOPES,
    assignable: true,
    description: 'Manage the organization question-report inbox',
  },
  'org.audit.read': {
    category: 'org',
    allowedScopes: ORG_SCOPES,
    assignable: true,
    description: 'Read the organization audit log',
  },
  'org.admin': {
    category: 'org',
    allowedScopes: ORG_SCOPES,
    assignable: false,
    description: 'Ownership: delete the organization and transfer ownership',
  },
} as const satisfies Record<string, PermissionDefinition>;

export type PermissionCatalogKey = keyof typeof PERMISSIONS;

/** Whether `value` is a key of the closed permission catalog. */
export function isPermissionCatalogKey(value: string): value is PermissionCatalogKey {
  return Object.hasOwn(PERMISSIONS, value);
}

/** Whether `value` is one of the three scopes a catalog key can carry (not `any`). */
export function isCatalogScope(value: string): value is CatalogScope {
  return value === 'own' || value === 'group' || value === 'organization';
}

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

/**
 * Whether `held` is at least as wide as `wanted` (own < group < organization <
 * any). The role editor uses it to decide whether the caller may grant a scope
 * or remove a grant it currently holds (ADR-0015 §4.4, D21).
 */
export function scopeCovers(
  held: PermissionScope | null | undefined,
  wanted: PermissionScope,
): boolean {
  if (!held) return false;
  return SCOPE_ORDER[held] >= SCOPE_ORDER[wanted];
}

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
