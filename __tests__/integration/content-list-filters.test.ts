import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { forEachCopy, registerMock } from '#test/helpers/concurrent';
import { type BeforeResult, before } from '#test/helpers/test-user';
import {
  applyRegisteredMock,
  cleanupFlashcardDecks,
  cleanupFlashcardTopics,
  cleanupOrganizationDeep,
  createServiceClient,
  mockUser,
} from '#test/integration/helpers';
import { createNextRequest } from '#test/integration/test-utils';
import { GET as getDecks, POST as createDeck } from '@/app/(backend)/api/v1/flashcards/decks/route';
import {
  GET as getTopicsScreen,
  POST as createTopicsScreen,
} from '@/app/(backend)/api/v1/flashcards/topics/route';
import { GET as getBanks, POST as createBank } from '@/app/(backend)/api/v1/questions/banks/route';
import { GET as getTopics } from '@/app/(backend)/api/v1/topics/route';

interface ListResponse {
  status: number;
  body: { success: boolean; data?: { items: Array<{ id: string }> } };
}

const BASE = 'http://localhost';

function uuid(n: number): string {
  return `9f1b0c7e-2d3a-4b5c-8d6e-${String(n).padStart(12, '0')}`;
}

forEachCopy((copyId) => {
  describe(`Content list filters (#595) [${copyId}]`, () => {
    registerMock(copyId, null);

    let teacher!: BeforeResult;
    let groupId!: string;
    let linkedDeckId!: string;
    let linkedBankId!: string;
    let linkedTopicId!: string;
    let cookie!: Record<string, string>;

    async function post(
      handler: (req: ReturnType<typeof createNextRequest>) => Promise<Response>,
      url: string,
      body: unknown,
    ): Promise<string> {
      mockUser(teacher.user);
      const res = await handler(
        createNextRequest(
          `${BASE}${url}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
          cookie,
        ),
      );
      const payload = await res.json();
      if (res.status !== 201) {
        throw new Error(`[595] ${url} seed failed (${res.status}): ${JSON.stringify(payload)}`);
      }
      return payload.data.id as string;
    }

    beforeAll(async () => {
      teacher = await before({
        role: 'educator',
        org: `content-filters-595-org-${copyId}`,
        groups: 1,
        decks: 2,
        topics: 2,
      });
      // groups[0] is the org default group, where the creator is a teacher.
      groupId = teacher.groups[0];
      cookie = { active_org_id: teacher.orgId! };

      linkedDeckId = await post(createDeck, '/api/v1/flashcards/decks', {
        name: `content-filters-595-deck-${copyId}`,
        visibility: 'group',
        groupIds: [groupId],
      });
      linkedBankId = await post(createBank, '/api/v1/questions/banks', {
        name: `content-filters-595-bank-${copyId}`,
        visibility: 'group',
        groupIds: [groupId],
      });
      linkedTopicId = await post(createTopicsScreen, '/api/v1/flashcards/topics', {
        name: `content-filters-595-topic-${copyId}`,
        visibility: 'group',
        groupIds: [groupId],
      });
    });

    afterAll(async () => {
      await cleanupFlashcardDecks(teacher.user.id);
      await cleanupFlashcardTopics(teacher.user.id);
      await createServiceClient().from('question_banks').delete().eq('created_by', teacher.user.id);
      await cleanupOrganizationDeep(teacher.orgId!);
    });

    beforeEach(() => {
      vi.clearAllMocks();
      applyRegisteredMock(copyId);
    });

    const endpoints = [
      {
        label: 'GET /api/v1/flashcards/decks',
        get: getDecks,
        url: '/api/v1/flashcards/decks',
        linkedId: () => linkedDeckId,
      },
      {
        label: 'GET /api/v1/questions/banks',
        get: getBanks,
        url: '/api/v1/questions/banks',
        linkedId: () => linkedBankId,
      },
      {
        label: 'GET /api/v1/flashcards/topics',
        get: getTopicsScreen,
        url: '/api/v1/flashcards/topics',
        linkedId: () => linkedTopicId,
      },
      {
        label: 'GET /api/v1/topics',
        get: getTopics,
        url: '/api/v1/topics',
        linkedId: () => linkedTopicId,
      },
    ] as const;

    async function list(
      endpoint: (typeof endpoints)[number],
      query: string,
    ): Promise<ListResponse> {
      mockUser(teacher.user);
      const separator = query === '' ? '' : `?${query}`;
      const res = await endpoint.get(
        createNextRequest(`${BASE}${endpoint.url}${separator}`, undefined, cookie),
      );
      return { status: res.status, body: await res.json() };
    }

    describe.each(endpoints)('$label', (endpoint) => {
      it('filters to content linked to the selected group', async () => {
        const { status, body } = await list(endpoint, `groups=${groupId}`);

        expect(status).toBe(200);
        expect(body.data?.items.map((item) => item.id)).toEqual([endpoint.linkedId()]);
      });

      it('dedupes a repeated group id', async () => {
        const { status, body } = await list(endpoint, `groups=${groupId},${groupId}`);

        expect(status).toBe(200);
        expect(body.data?.items.map((item) => item.id)).toEqual([endpoint.linkedId()]);
      });

      it('treats an empty groups param as no restriction', async () => {
        const { status, body } = await list(endpoint, 'groups=');

        expect(status).toBe(200);
        expect(body.data?.items.map((item) => item.id)).toContain(endpoint.linkedId());
      });

      it('returns an empty page for a group id that matches nothing', async () => {
        const { status, body } = await list(endpoint, `groups=${uuid(1)}`);

        expect(status).toBe(200);
        expect(body.data?.items).toEqual([]);
      });

      it('rejects a non-UUID group id', async () => {
        expect((await list(endpoint, 'groups=not-a-uuid')).status).toBe(422);
      });

      it('rejects more than 50 group ids', async () => {
        const ids = Array.from({ length: 51 }, (_, i) => uuid(i)).join(',');
        expect((await list(endpoint, `groups=${ids}`)).status).toBe(422);
      });

      it.each(['owner=group', 'owner=shared', 'groupFilter=mine'])(
        'rejects the retired filter %s',
        async (query) => {
          expect((await list(endpoint, query)).status).toBe(422);
        },
      );
    });
  });
});
