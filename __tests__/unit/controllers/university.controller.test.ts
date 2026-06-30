import { describe, it, expect, vi, beforeEach } from 'vitest';
import { organizationController } from '@/server/controllers/organization.controller';
import { organizationService } from '@/server/services';
import { AppError } from '@/lib/errors';

vi.mock('@/server/services', () => ({
  organizationService: {
    create: vi.fn(),
    getAll: vi.fn(),
    getById: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

const mockService = vi.mocked(organizationService);

describe('OrganizationController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('returns success when university is created', async () => {
      const university = { id: 'uni-1', name: 'Test University', slug: 'test' };
      mockService.create.mockResolvedValueOnce(university);

      const response = await organizationController.create({ name: 'Test University', slug: 'test' });

      expect(response).toEqual({
        success: true,
        statusCode: 201,
        data: university,
      });
    });

    it('returns UNPROCESSABLE_ENTITY for invalid input', async () => {
      const response = await organizationController.create({ name: 'AB', slug: 'bad slug!' });

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect((response as any).error).toBe('UNPROCESSABLE_ENTITY');
    });

    it('returns CONFLICT when slug already exists', async () => {
      mockService.create.mockRejectedValueOnce(new AppError('CONFLICT'));

      const response = await organizationController.create({ name: 'Test', slug: 'taken' });

      expect(response).toEqual({
        success: false,
        statusCode: 409,
        error: 'CONFLICT',
      });
    });

    it('returns INTERNAL_SERVER when service throws generic error', async () => {
      mockService.create.mockRejectedValueOnce(new Error('unexpected'));

      const response = await organizationController.create({ name: 'Test', slug: 'test' });

      expect(response).toEqual({
        success: false,
        statusCode: 500,
        error: 'INTERNAL_SERVER',
      });
    });
  });

  describe('getAll', () => {
    it('returns success with list of universities', async () => {
      const universities = [
        { id: 'uni-1', name: 'University 1', slug: 'uni-1' },
        { id: 'uni-2', name: 'University 2', slug: 'uni-2' },
      ];
      mockService.getAll.mockResolvedValueOnce(universities);

      const response = await organizationController.getAll();

      expect(response).toEqual({
        success: true,
        statusCode: 200,
        data: universities,
      });
    });

    it('returns INTERNAL_SERVER when service throws', async () => {
      mockService.getAll.mockRejectedValueOnce(new Error('db error'));

      const response = await organizationController.getAll();

      expect(response).toEqual({
        success: false,
        statusCode: 500,
        error: 'INTERNAL_SERVER',
      });
    });
  });

  describe('getById', () => {
    const validId = '550e8400-e29b-41d4-a716-446655440000';

    it('returns success when university is found', async () => {
      const university = { id: validId, name: 'Test University', slug: 'test' };
      mockService.getById.mockResolvedValueOnce(university);

      const response = await organizationController.getById(validId);

      expect(response).toEqual({
        success: true,
        statusCode: 200,
        data: university,
      });
    });

    it('returns BAD_REQUEST for invalid UUID', async () => {
      const response = await organizationController.getById('not-a-uuid');

      expect(response).toEqual({
        success: false,
        statusCode: 400,
        error: 'BAD_REQUEST',
      });
    });

    it('returns NOT_FOUND when university does not exist', async () => {
      mockService.getById.mockRejectedValueOnce(new AppError('NOT_FOUND'));

      const response = await organizationController.getById(validId);

      expect(response).toEqual({
        success: false,
        statusCode: 404,
        error: 'NOT_FOUND',
      });
    });

    it('returns INTERNAL_SERVER when service throws generic error', async () => {
      mockService.getById.mockRejectedValueOnce(new Error('unexpected'));

      const response = await organizationController.getById(validId);

      expect(response).toEqual({
        success: false,
        statusCode: 500,
        error: 'INTERNAL_SERVER',
      });
    });
  });

  describe('update', () => {
    const validId = '550e8400-e29b-41d4-a716-446655440000';

    it('returns success when university is updated', async () => {
      const updated = { id: validId, name: 'Updated Name', slug: 'test' };
      mockService.update.mockResolvedValueOnce(updated);

      const response = await organizationController.update(validId, { name: 'Updated Name' });

      expect(response).toEqual({
        success: true,
        statusCode: 200,
        data: updated,
      });
    });

    it('returns BAD_REQUEST for invalid UUID', async () => {
      const response = await organizationController.update('not-a-uuid', { name: 'Updated' });

      expect(response).toEqual({
        success: false,
        statusCode: 400,
        error: 'BAD_REQUEST',
      });
    });

    it('returns UNPROCESSABLE_ENTITY for invalid body', async () => {
      const response = await organizationController.update(validId, {});

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect((response as any).error).toBe('UNPROCESSABLE_ENTITY');
    });

    it('returns CONFLICT when slug already exists', async () => {
      mockService.update.mockRejectedValueOnce(new AppError('CONFLICT'));

      const response = await organizationController.update(validId, { slug: 'taken' });

      expect(response).toEqual({
        success: false,
        statusCode: 409,
        error: 'CONFLICT',
      });
    });

    it('returns NOT_FOUND when university does not exist', async () => {
      mockService.update.mockRejectedValueOnce(new AppError('NOT_FOUND'));

      const response = await organizationController.update(validId, { name: 'New' });

      expect(response).toEqual({
        success: false,
        statusCode: 404,
        error: 'NOT_FOUND',
      });
    });

    it('returns INTERNAL_SERVER when service throws generic error', async () => {
      mockService.update.mockRejectedValueOnce(new Error('unexpected'));

      const response = await organizationController.update(validId, { name: 'New' });

      expect(response).toEqual({
        success: false,
        statusCode: 500,
        error: 'INTERNAL_SERVER',
      });
    });
  });

  describe('delete', () => {
    const validId = '550e8400-e29b-41d4-a716-446655440000';

    it('returns success when university is deleted', async () => {
      mockService.delete.mockResolvedValueOnce({ success: true });

      const response = await organizationController.delete(validId);

      expect(response).toEqual({
        success: true,
        statusCode: 200,
        data: { success: true },
      });
    });

    it('returns BAD_REQUEST for invalid UUID', async () => {
      const response = await organizationController.delete('not-a-uuid');

      expect(response).toEqual({
        success: false,
        statusCode: 400,
        error: 'BAD_REQUEST',
      });
    });

    it('returns NOT_FOUND when university does not exist', async () => {
      mockService.delete.mockRejectedValueOnce(new AppError('NOT_FOUND'));

      const response = await organizationController.delete(validId);

      expect(response).toEqual({
        success: false,
        statusCode: 404,
        error: 'NOT_FOUND',
      });
    });

    it('returns INTERNAL_SERVER when service throws generic error', async () => {
      mockService.delete.mockRejectedValueOnce(new Error('unexpected'));

      const response = await organizationController.delete(validId);

      expect(response).toEqual({
        success: false,
        statusCode: 500,
        error: 'INTERNAL_SERVER',
      });
    });
  });
});
