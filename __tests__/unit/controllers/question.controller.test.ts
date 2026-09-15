import { RequestContext } from '@studiq/authz';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ControllerResponse } from '@/lib/controller-response';
import { failure, success } from '@/lib/service-result';
import { createClient } from '@/lib/supabase/server';
import { QuestionController } from '@/server/controllers/question.controller';

function createMockQuestionService() {
  return {
    create: vi.fn(),
    list: vi.fn(),
    getById: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
}

const mockCtx: RequestContext = {
  traceId: 'test-trace',
  userId: 'test-user-id',
  accountType: 'student',
  orgRoleId: null,
  activeOrgId: null,
  url: '/test',
  method: 'GET',
  groupIds: [],
  permissionScopes: {},
};

describe('QuestionController', () => {
  let mockService: ReturnType<typeof createMockQuestionService>;
  let controller: QuestionController;

  beforeEach(() => {
    vi.clearAllMocks();
    mockService = createMockQuestionService();
    controller = new QuestionController(mockService as any);
  });

  function mockBankLookup(bankId: string) {
    const queryChain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: bankId,
          created_by: mockCtx.userId,
          organization_id: null,
          visibility: 'personal',
        },
        error: null,
      }),
    };
    const mockSupabase: any = { from: vi.fn().mockReturnValue(queryChain) };
    vi.mocked(createClient).mockResolvedValue(mockSupabase);
  }

  describe('create', () => {
    const VALID_BANK_ID = '00000000-0000-4000-8020-000000000001';

    it('returns success when service creates successfully', async () => {
      mockBankLookup(VALID_BANK_ID);
      const body = {
        bankId: VALID_BANK_ID,
        type: 'mcq',
        content: 'What is 2+2?',
        answers: [{ content: '4', isCorrect: true }],
      };
      const created = { id: 'q-1', ...body };
      mockService.create.mockResolvedValueOnce(success(created));

      const response = await controller.create(body, mockCtx);

      expect(response).toEqual({ success: true, statusCode: 201, data: created });
    });

    it('returns UNPROCESSABLE_ENTITY when body fails validation', async () => {
      const response = await controller.create({ type: 'mcq', content: '' }, mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect((response as any).error).toBe('UNPROCESSABLE_ENTITY');
    });

    it('returns error when service returns failure', async () => {
      mockBankLookup(VALID_BANK_ID);
      mockService.create.mockResolvedValueOnce(failure('INTERNAL_SERVER'));

      const response = await controller.create(
        {
          bankId: VALID_BANK_ID,
          type: 'mcq',
          content: 'Q',
          answers: [{ content: 'A', isCorrect: true }],
        },
        mockCtx,
      );

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });

    it('passes bankVisibility to service when bankId is valid', async () => {
      const bankId = '550e8400-e29b-41d4-a716-446655440000';
      const body = {
        type: 'mcq',
        content: 'Q',
        bankId,
        answers: [{ content: 'A', isCorrect: true }],
      };
      const created = { id: 'q-1', content: 'Q', bank_id: bankId };
      mockService.create.mockResolvedValueOnce(success(created));

      const queryChain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: bankId,
            created_by: mockCtx.userId,
            organization_id: null,
            visibility: 'personal',
          },
          error: null,
        }),
      };
      const mockSupabase: any = { from: vi.fn().mockReturnValue(queryChain) };
      vi.mocked(createClient).mockResolvedValue(mockSupabase);

      const response = await controller.create(body, mockCtx);

      expect(response).toEqual({ success: true, statusCode: 201, data: created });
      expect(mockService.create).toHaveBeenCalledWith(
        expect.objectContaining({ bankId }),
        mockCtx,
        'personal',
      );
    });
  });

  describe('list', () => {
    it('returns questions without filters', async () => {
      const questions = [{ id: 'q-1', content: 'Q1' }];
      mockService.list.mockResolvedValueOnce(success(questions));

      const response = await controller.list(mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data: questions });
    });

    it('passes filters to service', async () => {
      mockService.list.mockResolvedValueOnce(success([]));

      await controller.list(mockCtx, { bankId: 'sub-1', type: 'mcq' });

      expect(mockService.list).toHaveBeenCalledWith(mockCtx, {
        bankId: 'sub-1',
        type: 'mcq',
      });
    });

    it('returns failure when service returns failure', async () => {
      mockService.list.mockResolvedValueOnce(failure('INTERNAL_SERVER'));

      const response = await controller.list(mockCtx);

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });
  });

  describe('getById', () => {
    it('returns question when found', async () => {
      const question = { id: 'q-1', content: 'Q1' };
      mockService.getById.mockResolvedValueOnce(success(question));

      const response = await controller.getById('q-1', mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data: question });
    });

    it('returns NOT_FOUND when service returns failure', async () => {
      mockService.getById.mockResolvedValueOnce(failure('NOT_FOUND'));

      const response = await controller.getById('nonexistent', mockCtx);

      expect(response).toEqual({ success: false, statusCode: 404, error: 'NOT_FOUND' });
    });
  });

  describe('update', () => {
    it('returns success when service updates successfully', async () => {
      const updated = { id: 'q-1', content: 'Updated' };
      mockService.update.mockResolvedValueOnce(success(updated));

      const response = await controller.update('q-1', { content: 'Updated' }, mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data: updated });
    });

    it('returns UNPROCESSABLE_ENTITY when body fails validation', async () => {
      const response = await controller.update('q-1', { content: '' }, mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect((response as any).error).toBe('UNPROCESSABLE_ENTITY');
    });

    it('returns FORBIDDEN when service returns failure', async () => {
      mockService.update.mockResolvedValueOnce(failure('FORBIDDEN'));

      const response = await controller.update('q-1', { content: 'Updated' }, mockCtx);

      expect(response).toEqual({ success: false, statusCode: 403, error: 'FORBIDDEN' });
    });
  });

  describe('delete', () => {
    it('returns success when service deletes successfully', async () => {
      mockService.delete.mockResolvedValueOnce(success(undefined));

      const response = await controller.delete('q-1', mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data: { success: true } });
    });

    it('returns error when service returns failure', async () => {
      mockService.delete.mockResolvedValueOnce(failure('FORBIDDEN'));

      const response = await controller.delete('q-1', mockCtx);

      expect(response).toEqual({ success: false, statusCode: 403, error: 'FORBIDDEN' });
    });
  });
});
