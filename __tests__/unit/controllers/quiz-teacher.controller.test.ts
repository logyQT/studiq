import type { RequestContext } from '@studiq/authz';
import { QuizTeacherController } from '@studiq/server/controllers/quiz-teacher.controller';
import { AppError } from '@studiq/server/lib/errors';
import { failure, success } from '@studiq/server/lib/service-result';
import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import { QuizTeacherService } from '@studiq/server/services/quiz-teacher.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireEntitlementMock = vi.fn<(...args: unknown[]) => Promise<void>>();
vi.mock('@studiq/server/lib/entitlements', () => ({
  requireEntitlement: (...args: unknown[]) => requireEntitlementMock(...args),
}));

function createMockService() {
  // The mocked methods never touch the database, so the client factory only
  // has to satisfy the constructor's type.
  return Object.assign(new QuizTeacherService(() => Promise.reject(new Error('unused'))), {
    create: vi.fn(),
    list: vi.fn(),
    getById: vi.fn(),
    bulkSave: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    addQuestions: vi.fn(),
    removeQuestion: vi.fn(),
    reorderQuestions: vi.fn(),
    createAssignment: vi.fn(),
  });
}

const mockCtx: RequestContext = {
  traceId: 't',
  userId: 'teacher-1',
  accountType: 'educator',
  orgRoleId: 'role-1',
  activeOrgId: 'org-1',
  url: '/test',
  method: 'GET',
  groupIds: [],
  permissionScopes: {
    'quiz.read': 'own',
    'quiz.create': 'own',
    'quiz.update': 'own',
    'quiz.delete': 'own',
    'assignment.create': 'own',
  },
};

describe('QuizTeacherController', () => {
  let mockService: ReturnType<typeof createMockService>;
  let controller: QuizTeacherController;

  beforeEach(() => {
    vi.clearAllMocks();
    requireEntitlementMock.mockResolvedValue(undefined);
    mockService = createMockService();
    controller = new QuizTeacherController(mockService);
  });

  describe('create', () => {
    it('returns 201 when service creates successfully', async () => {
      const created = { id: 'quiz-1', name: 'My Quiz' };
      mockService.create.mockResolvedValueOnce(success(created));

      const response = await controller.create({ name: 'My Quiz' }, mockCtx);

      expect(response).toEqual({ success: true, statusCode: 201, data: created });
    });

    it('returns 422 when name is missing', async () => {
      const response = await controller.create({}, mockCtx);

      expect(response.success).toBe(false);
      if (!response.success) {
        expect(response.statusCode).toBe(422);
        expect(response.error).toBe('UNPROCESSABLE_ENTITY');
      }
    });

    it('returns 422 when name is whitespace only', async () => {
      const response = await controller.create({ name: '   ' }, mockCtx);

      expect(response.success).toBe(false);
      if (!response.success) {
        expect(response.statusCode).toBe(422);
        expect(response.error).toBe('UNPROCESSABLE_ENTITY');
        expect(response.details?.[0]?.path).toEqual(['name']);
        expect(response.details?.[0]?.message).toBe(ValidationErrorCode.REQUIRED);
      }
      expect(mockService.create).not.toHaveBeenCalled();
    });

    it('passes the trimmed name to the service', async () => {
      mockService.create.mockResolvedValueOnce(success({ id: 'quiz-1', name: 'My Quiz' }));

      await controller.create({ name: '  My Quiz  ' }, mockCtx);

      expect(mockService.create).toHaveBeenCalledWith({ name: 'My Quiz' }, mockCtx);
    });

    it('returns error when service fails', async () => {
      mockService.create.mockResolvedValueOnce(failure('INTERNAL_SERVER'));

      const response = await controller.create({ name: 'My Quiz' }, mockCtx);

      expect(response.success).toBe(false);
      if (!response.success) {
        expect(response.error).toBe('INTERNAL_SERVER');
      }
    });
  });

  describe('list', () => {
    it('returns quizzes list', async () => {
      const quizzes = [{ id: 'quiz-1', name: 'My Quiz' }];
      mockService.list.mockResolvedValueOnce(success(quizzes));

      const response = await controller.list(mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data: quizzes });
    });

    it('returns 403 when the service reports FORBIDDEN', async () => {
      mockService.list.mockResolvedValueOnce(failure('FORBIDDEN'));

      const response = await controller.list({ ...mockCtx, activeOrgId: null });

      expect(response).toEqual({ success: false, statusCode: 403, error: 'FORBIDDEN' });
    });
  });

  describe('getById', () => {
    it('returns a single quiz', async () => {
      const quiz = { id: 'quiz-1', name: 'My Quiz' };
      mockService.getById.mockResolvedValueOnce(success(quiz));

      const response = await controller.getById('quiz-1', mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data: quiz });
    });
  });

  describe('bulkSave', () => {
    it('returns 200 when service saves successfully', async () => {
      const saved = { id: 'quiz-1', name: 'Updated Quiz', quiz_questions: [] };
      mockService.bulkSave.mockResolvedValueOnce(success(saved));

      const response = await controller.bulkSave(
        'quiz-1',
        { name: 'Updated Quiz', questions: [{ question_id: uuid, order_index: 0, points: 1 }] },
        mockCtx,
      );

      expect(response).toEqual({ success: true, statusCode: 200, data: saved });
    });

    it('returns 422 when name is missing', async () => {
      const response = await controller.bulkSave(
        'quiz-1',
        { questions: [{ question_id: uuid, order_index: 0, points: 1 }] },
        mockCtx,
      );

      expect(response.success).toBe(false);
      if (!response.success) {
        expect(response.statusCode).toBe(422);
        expect(response.error).toBe('UNPROCESSABLE_ENTITY');
      }
    });

    it('returns 422 when name is empty', async () => {
      const response = await controller.bulkSave('quiz-1', { name: '', questions: [] }, mockCtx);

      expect(response.success).toBe(false);
      if (!response.success) {
        expect(response.statusCode).toBe(422);
      }
    });

    it('returns 422 when name is whitespace only', async () => {
      const response = await controller.bulkSave('quiz-1', { name: '   ', questions: [] }, mockCtx);

      expect(response.success).toBe(false);
      if (!response.success) {
        expect(response.statusCode).toBe(422);
        expect(response.error).toBe('UNPROCESSABLE_ENTITY');
        expect(response.details?.[0]?.message).toBe(ValidationErrorCode.REQUIRED);
      }
      expect(mockService.bulkSave).not.toHaveBeenCalled();
    });

    it('propagates service error', async () => {
      mockService.bulkSave.mockResolvedValueOnce(failure('NOT_FOUND'));

      const response = await controller.bulkSave(
        'quiz-1',
        { name: 'Quiz', questions: [] },
        mockCtx,
      );

      expect(response.success).toBe(false);
      if (!response.success) {
        expect(response.statusCode).toBe(404);
        expect(response.error).toBe('NOT_FOUND');
      }
    });
  });

  describe('update', () => {
    it('updates quiz successfully', async () => {
      const updated = { id: 'quiz-1', name: 'Updated' };
      mockService.update.mockResolvedValueOnce(success(updated));

      const response = await controller.update('quiz-1', { name: 'Updated' }, mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data: updated });
    });

    it('returns 422 when name is whitespace only', async () => {
      const response = await controller.update('quiz-1', { name: '   ' }, mockCtx);

      expect(response.success).toBe(false);
      if (!response.success) {
        expect(response.statusCode).toBe(422);
        expect(response.error).toBe('UNPROCESSABLE_ENTITY');
      }
      expect(mockService.update).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('deletes quiz successfully', async () => {
      mockService.delete.mockResolvedValueOnce(success(null));

      const response = await controller.delete('quiz-1', mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data: null });
    });
  });

  const uuid = '00000000-0000-4000-8000-000000000001';

  describe('addQuestions', () => {
    it('adds questions successfully', async () => {
      const added = [{ question_id: uuid, order_index: 0, points: 1 }];
      mockService.addQuestions.mockResolvedValueOnce(success(added));

      const response = await controller.addQuestions('quiz-1', { questionIds: [uuid] }, mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data: added });
    });

    it('returns 422 when questionIds is empty', async () => {
      const response = await controller.addQuestions('quiz-1', { questionIds: [] }, mockCtx);

      expect(response.success).toBe(false);
      if (!response.success) {
        expect(response.statusCode).toBe(422);
      }
    });
  });

  describe('removeQuestion', () => {
    it('removes a question successfully', async () => {
      mockService.removeQuestion.mockResolvedValueOnce(success(null));

      const response = await controller.removeQuestion('quiz-1', uuid, mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data: null });
    });
  });

  describe('reorderQuestions', () => {
    it('reorders questions successfully', async () => {
      mockService.reorderQuestions.mockResolvedValueOnce(success(null));

      const response = await controller.reorderQuestions(
        'quiz-1',
        { questionIds: [uuid] },
        mockCtx,
      );

      expect(response).toEqual({ success: true, statusCode: 200, data: null });
    });
  });

  describe('createAssignment', () => {
    it('creates assignment from quiz successfully', async () => {
      const assignment = { id: 'assign-1', title: 'My Quiz' };
      mockService.createAssignment.mockResolvedValueOnce(success(assignment));

      const response = await controller.createAssignment('quiz-1', mockCtx);

      expect(response).toEqual({ success: true, statusCode: 201, data: assignment });
    });
  });

  describe('entitlement gate (ADR-0015 §7, phase 5d)', () => {
    // The ctx below holds every quiz permission, so only the entitlement can
    // refuse: deleting the gate line turns these rejections into 200/422.
    it('refuses every gated write with FORBIDDEN before the permission check and the parse', async () => {
      requireEntitlementMock.mockRejectedValue(new AppError('FORBIDDEN'));
      // A resolution per method, so a deleted gate produces a 200/201 that fails
      // the rejection assertion — not a crash on an undefined service result.
      mockService.create.mockResolvedValueOnce(success({ id: 'q-1' }));
      mockService.update.mockResolvedValueOnce(success({ id: 'q-1' }));
      mockService.delete.mockResolvedValueOnce(success(undefined));
      mockService.addQuestions.mockResolvedValueOnce(success({ added: 1 }));
      mockService.removeQuestion.mockResolvedValueOnce(success(undefined));
      mockService.reorderQuestions.mockResolvedValueOnce(success(undefined));
      mockService.createAssignment.mockResolvedValueOnce(success({ id: 'a-1' }));
      mockService.bulkSave.mockResolvedValueOnce(success({ id: 'q-1' }));
      for (const call of [
        () => controller.create({}, mockCtx),
        () => controller.update('q-1', {}, mockCtx),
        () => controller.delete('q-1', mockCtx),
        () => controller.addQuestions('q-1', {}, mockCtx),
        () => controller.removeQuestion('q-1', 'qq-1', mockCtx),
        () => controller.reorderQuestions('q-1', {}, mockCtx),
        () => controller.createAssignment('q-1', mockCtx),
        () => controller.bulkSave('q-1', {}, mockCtx),
      ]) {
        await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
      }
      expect(requireEntitlementMock).toHaveBeenCalledWith(mockCtx, 'quiz.templates');
      expect(mockService.create).not.toHaveBeenCalled();
      expect(mockService.update).not.toHaveBeenCalled();
      expect(mockService.delete).not.toHaveBeenCalled();
      expect(mockService.addQuestions).not.toHaveBeenCalled();
      expect(mockService.removeQuestion).not.toHaveBeenCalled();
      expect(mockService.reorderQuestions).not.toHaveBeenCalled();
      expect(mockService.createAssignment).not.toHaveBeenCalled();
      expect(mockService.bulkSave).not.toHaveBeenCalled();
    });

    it('an entitled caller passes the gate and reaches the permission check', async () => {
      mockService.create.mockResolvedValueOnce(success({ id: 'q-1' }));
      const response = await controller.create({ name: 'My Quiz' }, mockCtx);
      expect(response).toEqual({ success: true, statusCode: 201, data: { id: 'q-1' } });
      expect(requireEntitlementMock).toHaveBeenCalledWith(mockCtx, 'quiz.templates');
    });

    it('the free reads stay open without the entitlement', async () => {
      requireEntitlementMock.mockRejectedValue(new AppError('FORBIDDEN'));
      mockService.list.mockResolvedValueOnce(success([]));
      mockService.getById.mockResolvedValueOnce(success({ id: 'q-1', name: 'Q' }));
      expect(await controller.list(mockCtx)).toEqual({ success: true, statusCode: 200, data: [] });
      expect(await controller.getById('q-1', mockCtx)).toEqual({
        success: true,
        statusCode: 200,
        data: { id: 'q-1', name: 'Q' },
      });
      expect(requireEntitlementMock).not.toHaveBeenCalled();
    });
  });

  describe('permission gate (ADR-0015 §7, phase 2b-6)', () => {
    const body = { name: 'My Quiz' };

    it.each(['own', 'group', 'organization'] as const)(
      'a caller holding quiz.create at %s scope is allowed',
      async (scope) => {
        mockService.create.mockResolvedValueOnce(success({ id: 'q-1' }));
        const response = await controller.create(body, {
          ...mockCtx,
          permissionScopes: { 'quiz.create': scope },
        });
        expect(response).toEqual({ success: true, statusCode: 201, data: { id: 'q-1' } });
      },
    );

    it('a caller without the key is 403 and the service is never called', async () => {
      const response = await controller.create(body, { ...mockCtx, permissionScopes: {} });
      expect(response).toEqual({ success: false, statusCode: 403, error: 'FORBIDDEN' });
      expect(mockService.create).not.toHaveBeenCalled();
    });

    it('the gate runs before the schema parse: a malformed body still answers 403', async () => {
      const response = await controller.create({}, { ...mockCtx, permissionScopes: {} });
      expect(response).toEqual({ success: false, statusCode: 403, error: 'FORBIDDEN' });
      expect(mockService.create).not.toHaveBeenCalled();
    });

    it('a student-persona holder of the key is allowed (D13: the persona is irrelevant)', async () => {
      mockService.create.mockResolvedValueOnce(success({ id: 'q-1' }));
      const response = await controller.create(body, {
        ...mockCtx,
        accountType: 'student',
        permissionScopes: { 'quiz.create': 'organization' },
      });
      expect(response).toEqual({ success: true, statusCode: 201, data: { id: 'q-1' } });
    });

    it('a read without quiz.read is 403 on list and getById', async () => {
      const ctx = { ...mockCtx, permissionScopes: {} };
      expect(await controller.list(ctx)).toEqual({
        success: false,
        statusCode: 403,
        error: 'FORBIDDEN',
      });
      expect(await controller.getById('q-1', ctx)).toEqual({
        success: false,
        statusCode: 403,
        error: 'FORBIDDEN',
      });
      expect(mockService.list).not.toHaveBeenCalled();
      expect(mockService.getById).not.toHaveBeenCalled();
    });

    it('a write without quiz.update is 403 on update and the child routes', async () => {
      const ctx = { ...mockCtx, permissionScopes: { 'quiz.read': 'own' } };
      for (const call of [
        () => controller.update('q-1', body, ctx),
        () => controller.bulkSave('q-1', { name: 'x', questions: [] }, ctx),
        () => controller.addQuestions('q-1', { questionIds: [] }, ctx),
        () => controller.removeQuestion('q-1', 'qq-1', ctx),
        () => controller.reorderQuestions('q-1', { questionIds: [] }, ctx),
      ]) {
        expect(await call()).toEqual({ success: false, statusCode: 403, error: 'FORBIDDEN' });
      }
      expect(mockService.update).not.toHaveBeenCalled();
    });

    it('a delete without quiz.delete is 403', async () => {
      const ctx = { ...mockCtx, permissionScopes: { 'quiz.update': 'own' } };
      expect(await controller.delete('q-1', ctx)).toEqual({
        success: false,
        statusCode: 403,
        error: 'FORBIDDEN',
      });
      expect(mockService.delete).not.toHaveBeenCalled();
    });

    it('createAssignment asks the parent quiz.update key and assignment.create', async () => {
      const noUpdate = { ...mockCtx, permissionScopes: { 'assignment.create': 'own' } };
      expect(await controller.createAssignment('q-1', noUpdate)).toEqual({
        success: false,
        statusCode: 403,
        error: 'FORBIDDEN',
      });
      const noCreate = { ...mockCtx, permissionScopes: { 'quiz.update': 'own' } };
      expect(await controller.createAssignment('q-1', noCreate)).toEqual({
        success: false,
        statusCode: 403,
        error: 'FORBIDDEN',
      });
      mockService.createAssignment.mockResolvedValueOnce(success({ id: 'a-1' }));
      const both = {
        ...mockCtx,
        permissionScopes: { 'quiz.update': 'own', 'assignment.create': 'own' },
      };
      expect(await controller.createAssignment('q-1', both)).toEqual({
        success: true,
        statusCode: 201,
        data: { id: 'a-1' },
      });
    });
  });
});
