import { describe, it, expect, vi, beforeEach } from 'vitest';
import { subjectController } from './subject.controller';
import { subjectService } from '@/server/services';
import { AppError } from '@/lib/errors';

vi.mock('@/server/services', () => ({
  subjectService: {
    create: vi.fn(),
    list: vi.fn(),
    getById: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

const mockService = vi.mocked(subjectService);

describe('SubjectController', () => {
  const userId = 'test-user-id';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('returns success when service creates successfully', async () => {
      const body = { name: 'Math 101' };
      const createdSubject = { id: 'sub-1', name: 'Math 101', created_at: '2024-01-01' };

      mockService.create.mockResolvedValueOnce(createdSubject);

      const response = await subjectController.create(body, userId);

      expect(response).toEqual({
        success: true,
        statusCode: 201,
        data: createdSubject,
      });
      expect(mockService.create).toHaveBeenCalledWith({ name: 'Math 101' }, userId);
    });

    it('returns UNPROCESSABLE_ENTITY when body fails validation', async () => {
      const response = await subjectController.create({ name: '' }, userId);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect((response as any).error).toBe('UNPROCESSABLE_ENTITY');
      expect((response as any).details).toBeDefined();
      expect((response as any).details!.length).toBeGreaterThan(0);
    });

    it('returns INTERNAL_SERVER when service throws AppError', async () => {
      mockService.create.mockRejectedValueOnce(new AppError('INTERNAL_SERVER'));

      const response = await subjectController.create({ name: 'Math 101' }, userId);

      expect(response).toEqual({
        success: false,
        statusCode: 500,
        error: 'INTERNAL_SERVER',
      });
    });

    it('returns INTERNAL_SERVER when service throws unknown error', async () => {
      mockService.create.mockRejectedValueOnce(new Error('database connection lost'));

      const response = await subjectController.create({ name: 'Math 101' }, userId);

      expect(response).toEqual({
        success: false,
        statusCode: 500,
        error: 'INTERNAL_SERVER',
      });
    });
  });

  describe('create with FORBIDDEN', () => {
    it('returns FORBIDDEN when service throws FORBIDDEN', async () => {
      mockService.create.mockRejectedValueOnce(new AppError('FORBIDDEN'));

      const response = await subjectController.create({ name: 'Math 101' }, userId);

      expect(response).toEqual({
        success: false,
        statusCode: 403,
        error: 'FORBIDDEN',
      });
    });
  });

  describe('list', () => {
    it('returns subjects without requiring userId', async () => {
      const subjects = [{ id: 'sub-1', name: 'Math 101' }];
      mockService.list.mockResolvedValueOnce(subjects);

      const response = await subjectController.list();

      expect(response).toEqual({
        success: true,
        statusCode: 200,
        data: subjects,
      });
    });

    it('passes universityId filter to service', async () => {
      mockService.list.mockResolvedValueOnce([]);

      await subjectController.list('uni-123');

      expect(mockService.list).toHaveBeenCalledWith('uni-123');
    });

    it('returns INTERNAL_SERVER when service throws generic error', async () => {
      mockService.list.mockRejectedValueOnce(new Error('unexpected'));

      const response = await subjectController.list();

      expect(response).toEqual({
        success: false,
        statusCode: 500,
        error: 'INTERNAL_SERVER',
      });
    });
  });

  describe('getById', () => {
    it('returns subject when found', async () => {
      const subject = { id: 'sub-1', name: 'Math 101' };
      mockService.getById.mockResolvedValueOnce(subject);

      const response = await subjectController.getById('sub-1');

      expect(response).toEqual({
        success: true,
        statusCode: 200,
        data: subject,
      });
    });

    it('returns NOT_FOUND when service throws', async () => {
      mockService.getById.mockRejectedValueOnce(new AppError('NOT_FOUND'));

      const response = await subjectController.getById('nonexistent');

      expect(response).toEqual({
        success: false,
        statusCode: 404,
        error: 'NOT_FOUND',
      });
    });

    it('returns INTERNAL_SERVER when service throws generic error', async () => {
      mockService.getById.mockRejectedValueOnce(new Error('unexpected'));

      const response = await subjectController.getById('sub-1');

      expect(response).toEqual({
        success: false,
        statusCode: 500,
        error: 'INTERNAL_SERVER',
      });
    });
  });

  describe('update', () => {
    it('returns success when service updates successfully', async () => {
      const updated = { id: 'sub-1', name: 'Updated' };
      mockService.update.mockResolvedValueOnce(updated);

      const response = await subjectController.update('sub-1', { name: 'Updated' }, userId);

      expect(response).toEqual({
        success: true,
        statusCode: 200,
        data: updated,
      });
      expect(mockService.update).toHaveBeenCalledWith('sub-1', { name: 'Updated' }, userId);
    });

    it('returns FORBIDDEN when service throws FORBIDDEN', async () => {
      mockService.update.mockRejectedValueOnce(new AppError('FORBIDDEN'));

      const response = await subjectController.update('sub-1', { name: 'Updated' }, userId);

      expect(response).toEqual({
        success: false,
        statusCode: 403,
        error: 'FORBIDDEN',
      });
    });

    it('returns INTERNAL_SERVER when service throws generic error', async () => {
      mockService.update.mockRejectedValueOnce(new Error('unexpected'));

      const response = await subjectController.update('sub-1', { name: 'Updated' }, userId);

      expect(response).toEqual({
        success: false,
        statusCode: 500,
        error: 'INTERNAL_SERVER',
      });
    });
  });

  describe('delete', () => {
    it('returns success when service deletes successfully', async () => {
      mockService.delete.mockResolvedValueOnce(undefined);

      const response = await subjectController.delete('sub-1', userId);

      expect(response).toEqual({
        success: true,
        statusCode: 200,
        data: { success: true },
      });
    });

    it('returns FORBIDDEN when service throws FORBIDDEN', async () => {
      mockService.delete.mockRejectedValueOnce(new AppError('FORBIDDEN'));

      const response = await subjectController.delete('sub-1', userId);

      expect(response).toEqual({
        success: false,
        statusCode: 403,
        error: 'FORBIDDEN',
      });
    });

    it('returns INTERNAL_SERVER when service throws generic error', async () => {
      mockService.delete.mockRejectedValueOnce(new Error('unexpected'));

      const response = await subjectController.delete('sub-1', userId);

      expect(response).toEqual({
        success: false,
        statusCode: 500,
        error: 'INTERNAL_SERVER',
      });
    });
  });
});
