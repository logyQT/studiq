import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type BeforeResult,
  before,
  createTestUser,
  type TestUserFixture,
} from '#test/helpers/test-user';
import {
  useRealSupabase,
  cleanupFlashcardDecks,
  cleanupOrganizationDeep,
  createServiceClient,
  mockUser,
} from '#test/integration/helpers';
import { createNextRequest, createNextRequestWithParams } from '#test/integration/test-utils';
import {
  DELETE as deleteFn,
  GET as getById,
  PUT as update,
} from '@/app/(backend)/api/v1/flashcards/decks/[id]/route';
import { GET, POST } from '@/app/(backend)/api/v1/flashcards/decks/route';
import { POST as createOrganization } from '@/app/(backend)/api/v1/organization/route';

const suiteId = crypto.randomUUID().slice(0, 8);

describe(`Flashcard Decks Integration`, () => {
  let teacher!: BeforeResult;
  let other!: TestUserFixture;
  let crossOrgId!: string;
  let crossOrgGroupId!: string;

  beforeAll(async () => {
    // Fresh educator + 5 decks via the real API.
    // Index plan: [0]=GET found, [1]=PUT own, [2]=DELETE own,
    // [3]=GET 404 (another user), [4]=PUT/DELETE 403 (another user)
    // groups[0] = default group (creator is a teacher there),
    // groups[1] = extra group created via the API with no teacher membership.
    // A distinct org name keeps questions.test.ts's `cleanupOrganizationByName`
    // from racing this org away (same reason as flashcard-practice-group-scoping).
    teacher = await before({
      role: 'educator',
      org: `deck-140-org-${suiteId}`,
      decks: 5,
      groups: 1,
    });
    other = await createTestUser({ role: 'manager' });

    // Second org the same teacher belongs to: OrganizationService.create()
    // enrolls the creator as a `teacher` in the default group.
    mockUser(teacher.user);
    const orgRes = await createOrganization(
      createNextRequest('http://localhost/api/v1/organization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `deck-140-cross-org-${suiteId}` }),
      }),
    );
    const orgBody = await orgRes.json();
    if (orgRes.status !== 201) {
      throw new Error(`[deck-140] cross-org fixture failed: ${JSON.stringify(orgBody)}`);
    }
    crossOrgId = orgBody.data.id as string;

    const { data: crossGroup } = await createServiceClient()
      .from('groups')
      .select('id')
      .eq('organization_id', crossOrgId)
      .eq('is_default', true)
      .single();
    crossOrgGroupId = crossGroup!.id as string;

    // The API makes the creator an org admin (`deck.update` = organization scope),
    // which would 403 on a deck from the first org before the group guard runs.
    // Use the plain `teacher` role there so `check()` passes on `created_by`
    // and the request actually reaches the share guard (the case #140 needs).
    const service = createServiceClient();
    const { data: teacherRole } = await service
      .from('org_roles')
      .select('id')
      .eq('organization_id', crossOrgId)
      .eq('name', 'teacher')
      .single();
    await service
      .from('org_members')
      .update({ org_role_id: teacherRole!.id })
      .eq('organization_id', crossOrgId)
      .eq('user_id', teacher.user.id);
  });

  afterAll(async () => {
    await cleanupFlashcardDecks(teacher.user.id);
    await cleanupFlashcardDecks(other.id);
    await cleanupOrganizationDeep(crossOrgId);
    await cleanupOrganizationDeep(teacher.orgId!);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useRealSupabase();
  });

  describe('POST /api/v1/flashcards/decks', () => {
    it('creates a deck and returns 201', async () => {
      mockUser(teacher.user);

      const req = createNextRequest('http://localhost/api/v1/flashcards/decks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'deck-Study Deck' }),
      });

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.name).toBe('deck-Study Deck');
    });

    it('returns 422 when name is empty', async () => {
      mockUser(teacher.user);

      const req = createNextRequest('http://localhost/api/v1/flashcards/decks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '' }),
      });

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(422);
      expect(body.success).toBe(false);
    });

    // #361 — a whitespace-only name is empty, not a valid title.
    it('returns 422 when name is whitespace-only', async () => {
      mockUser(teacher.user);

      const req = createNextRequest('http://localhost/api/v1/flashcards/decks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '   ' }),
      });

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(422);
      expect(body.success).toBe(false);
      expect(body.issues.properties.name.errors).toEqual([
        'VALIDATION_REQUIRED',
        'VALIDATION_TOO_SHORT',
      ]);
    });

    it('trims a padded name', async () => {
      mockUser(teacher.user);

      const req = createNextRequest('http://localhost/api/v1/flashcards/decks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '  deck-Padded  ' }),
      });

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.data.name).toBe('deck-Padded');
    });

    it('returns 401 when not authenticated', async () => {
      mockUser(null);

      const req = createNextRequest('http://localhost/api/v1/flashcards/decks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'deck-Study Deck' }),
      });

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
    });
  });

  describe('POST /api/v1/flashcards/decks — group sharing authorization (#140)', () => {
    const postDeck = async (body: Record<string, unknown>) => {
      mockUser(teacher.user);
      const req = createNextRequest(
        'http://localhost/api/v1/flashcards/decks',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        { active_org_id: teacher.orgId! },
      );
      const response = await POST(req);
      return { response, body: await response.json() };
    };

    it('returns 403 and creates no row for a group the caller does not teach', async () => {
      const name = `deck-140-forbidden-${suiteId}`;
      const untaughtGroup = teacher.groups[1];

      const { response, body } = await postDeck({
        name,
        visibility: 'group',
        groupIds: [untaughtGroup],
      });

      expect(response.status).toBe(403);
      expect(body.success).toBe(false);
      expect(response.headers.get('x-error-code')).toBe('FORBIDDEN');

      const service = createServiceClient();
      const { count } = await service
        .from('flashcard_decks')
        .select('*', { count: 'exact', head: true })
        .eq('name', name);
      expect(count).toBe(0);
    });

    it('returns 201 and persists the group link for a group the caller teaches', async () => {
      const taughtGroup = teacher.groups[0];

      const { response, body } = await postDeck({
        name: `deck-140-allowed-${suiteId}`,
        visibility: 'group',
        groupIds: [taughtGroup],
      });

      expect(response.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.groupIds).toEqual([taughtGroup]);
    });

    it('returns 403 for a group from another organization the caller teaches', async () => {
      const name = `deck-140-cross-post-${suiteId}`;

      const { response, body } = await postDeck({
        name,
        visibility: 'group',
        groupIds: [crossOrgGroupId],
      });

      expect(response.status).toBe(403);
      expect(body.success).toBe(false);
      expect(response.headers.get('x-error-code')).toBe('FORBIDDEN');

      const service = createServiceClient();
      const { count } = await service
        .from('flashcard_decks')
        .select('*', { count: 'exact', head: true })
        .eq('name', name);
      expect(count).toBe(0);
    });
  });

  describe('PUT /api/v1/flashcards/decks/:id — group sharing authorization (#140)', () => {
    it('returns 403 and keeps the existing links when adding an untaught group', async () => {
      const taughtGroup = teacher.groups[0];
      const untaughtGroup = teacher.groups[1];

      mockUser(teacher.user);
      const createReq = createNextRequest(
        'http://localhost/api/v1/flashcards/decks',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `deck-140-update-${suiteId}`,
            visibility: 'group',
            groupIds: [taughtGroup],
          }),
        },
        { active_org_id: teacher.orgId! },
      );
      const createRes = await POST(createReq);
      const created = await createRes.json();
      expect(createRes.status).toBe(201);
      const deckId = created.data.id as string;

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/decks/${deckId}`,
        { id: deckId },
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groupIds: [untaughtGroup] }),
        },
        { active_org_id: teacher.orgId! },
      );
      const updateRes = await update(request, { params });
      const updateBody = await updateRes.json();

      expect(updateRes.status).toBe(403);
      expect(updateBody.success).toBe(false);

      const { request: getReq, params: getParams } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/decks/${deckId}`,
        { id: deckId },
        undefined,
        { active_org_id: teacher.orgId! },
      );
      const getRes = await getById(getReq, { params: getParams });
      const getBody = await getRes.json();

      expect(getRes.status).toBe(200);
      expect(getBody.data.groupIds).toEqual([taughtGroup]);
    });
  });

  describe('PUT /api/v1/flashcards/decks/:id — cross-org group guard (#140)', () => {
    const createGroupDeck = async (name: string, groupId: string): Promise<string> => {
      mockUser(teacher.user);
      const req = createNextRequest(
        'http://localhost/api/v1/flashcards/decks',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, visibility: 'group', groupIds: [groupId] }),
        },
        { active_org_id: teacher.orgId! },
      );
      const res = await POST(req);
      const body = await res.json();
      expect(res.status).toBe(201);
      return body.data.id as string;
    };

    const putGroupIds = async (deckId: string, groupIds: string[], activeOrgId: string) => {
      mockUser(teacher.user);
      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/decks/${deckId}`,
        { id: deckId },
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groupIds }),
        },
        { active_org_id: activeOrgId },
      );
      return update(request, { params });
    };

    it('returns 403 and keeps the org-A links when switching to a group the caller teaches in another org', async () => {
      const taughtGroup = teacher.groups[0];
      const deckId = await createGroupDeck(`deck-140-cross-put-${suiteId}`, taughtGroup);

      const updateRes = await putGroupIds(deckId, [crossOrgGroupId], crossOrgId);
      const updateBody = await updateRes.json();

      expect(updateRes.status).toBe(403);
      expect(updateBody.success).toBe(false);
      expect(updateRes.headers.get('x-error-code')).toBe('FORBIDDEN');

      const service = createServiceClient();
      const { data: links } = await service
        .from('deck_groups')
        .select('group_id')
        .eq('deck_id', deckId);
      expect(links?.map((l) => l.group_id)).toEqual([taughtGroup]);

      const { request: getReq, params: getParams } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/decks/${deckId}`,
        { id: deckId },
        undefined,
        { active_org_id: teacher.orgId! },
      );
      const getRes = await getById(getReq, { params: getParams });
      const getBody = await getRes.json();
      expect(getRes.status).toBe(200);
      expect(getBody.data.groupIds).toEqual([taughtGroup]);
    });
  });

  describe('GET /api/v1/flashcards/decks', () => {
    it('lists decks for user', async () => {
      mockUser(teacher.user);

      const req = createNextRequest('http://localhost/api/v1/flashcards/decks');
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(Array.isArray(body.data?.items)).toBe(true);
      expect(body.data?.items?.length).toBeGreaterThanOrEqual(5);
      expect(body.data?.total).toBeGreaterThanOrEqual(body.data?.items?.length);
    });

    it('keeps total stable across pages (cursor does not shrink it)', async () => {
      mockUser(teacher.user);

      const first = await (
        await GET(createNextRequest('http://localhost/api/v1/flashcards/decks?limit=2'))
      ).json();
      expect(first.data.hasMore).toBe(true);
      const second = await (
        await GET(
          createNextRequest(
            `http://localhost/api/v1/flashcards/decks?limit=2&cursor=${first.data.nextCursor}`,
          ),
        )
      ).json();

      expect(second.data.total).toBe(first.data.total);
    });

    it('returns 401 when not authenticated', async () => {
      mockUser(null);

      const req = createNextRequest('http://localhost/api/v1/flashcards/decks');
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
    });
  });

  describe('GET /api/v1/flashcards/decks/:id', () => {
    it('returns deck when found', async () => {
      mockUser(teacher.user);

      const deckId = teacher.created.decks[0];
      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/decks/${deckId}`,
        { id: deckId },
      );
      const response = await getById(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.id).toBe(deckId);
      expect(body.data.name).toContain('seed-deck-');
    });

    it('returns 404 for another user deck', async () => {
      mockUser(other);

      const deckId = teacher.created.decks[3];
      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/decks/${deckId}`,
        { id: deckId },
      );
      const response = await getById(request, { params });
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.success).toBe(false);
    });
  });

  describe('PUT /api/v1/flashcards/decks/:id', () => {
    it('updates own deck and returns 200', async () => {
      mockUser(teacher.user);

      const deckId = teacher.created.decks[1];
      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/decks/${deckId}`,
        { id: deckId },
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Updated' }),
        },
      );
      const response = await update(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.name).toBe('Updated');
    });

    it('returns 403 when updating another user deck', async () => {
      mockUser(other);

      const deckId = teacher.created.decks[0];
      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/decks/${deckId}`,
        { id: deckId },
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Hacked' }),
        },
      );
      const response = await update(request, { params });
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.success).toBe(false);
    });
  });

  describe('DELETE /api/v1/flashcards/decks/:id', () => {
    it('deletes own deck and returns 200', async () => {
      mockUser(teacher.user);

      const deckId = teacher.created.decks[2];
      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/decks/${deckId}`,
        { id: deckId },
        { method: 'DELETE' },
      );
      const response = await deleteFn(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
    });

    it('returns 403 when deleting another user deck', async () => {
      mockUser(other);

      const deckId = teacher.created.decks[4];
      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/decks/${deckId}`,
        { id: deckId },
        { method: 'DELETE' },
      );
      const response = await deleteFn(request, { params });
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.success).toBe(false);
    });
  });
});
