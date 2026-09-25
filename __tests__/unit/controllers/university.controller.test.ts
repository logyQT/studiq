import type { RequestContext } from '@studiq/authz';
import { OrganizationController } from '@studiq/server/controllers/organization.controller';
import { AppError } from '@studiq/server/lib/errors';
import { requireFeature } from '@studiq/server/lib/features';
import { failure, success } from '@studiq/server/lib/service-result';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@studiq/server/lib/features', () => ({
  requireFeature: vi.fn().mockResolvedValue(undefined),
}));

const mockRequireFeature = vi.mocked(requireFeature);

function createMockService() {
  return { create: vi.fn(), getAll: vi.fn(), getById: vi.fn(), update: vi.fn(), delete: vi.fn() };
}

let mockService: ReturnType<typeof createMockService>;
let controller: OrganizationController;

const mockCtx: RequestContext = {
  traceId: 'test-trace',
  userId: 'test-user-id',
  accountType: 'student' as any,
  orgRoleId: null,
  activeOrgId: null,
  url: 'http://localhost',
  method: 'POST',
  groupIds: [],
  permissionScopes: {},
};

describe('OrganizationController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockService = createMockService();
    controller = new OrganizationController(mockService as any);
  });

  describe('create', () => {
    it('returns success when university is created', async () => {
      const university = { id: 'uni-1', name: 'Test University', slug: 'test' };
      mockService.create.mockResolvedValueOnce(success(university));

      const response = await controller.create(
        {
          name: 'Test University',
          slug: 'test',
        },
        mockCtx,
      );

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(201);
      expect((response as any).data).toEqual(university);
    });

    it('returns UNPROCESSABLE_ENTITY for invalid input', async () => {
      const response = await controller.create({ name: 'AB', slug: 'bad slug!' }, mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect((response as any).error).toBe('UNPROCESSABLE_ENTITY');
    });

    it('returns CONFLICT when slug already exists', async () => {
      mockService.create.mockResolvedValueOnce(failure('CONFLICT'));

      const response = await controller.create({ name: 'Test', slug: 'taken' }, mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(409);
      expect((response as any).error).toBe('CONFLICT');
    });

    it('returns error when service returns failure', async () => {
      mockService.create.mockResolvedValueOnce(failure('INTERNAL_SERVER'));

      const response = await controller.create({ name: 'Test', slug: 'test' }, mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(500);
      expect((response as any).error).toBe('INTERNAL_SERVER');
    });
  });

  describe('getAll', () => {
    it('returns success with list of universities', async () => {
      const universities = [
        { id: 'uni-1', name: 'University 1', slug: 'uni-1' },
        { id: 'uni-2', name: 'University 2', slug: 'uni-2' },
      ];
      mockService.getAll.mockResolvedValueOnce(success(universities));

      const response = await controller.getAll();

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
      expect((response as any).data).toEqual(universities);
    });

    it('returns error when service returns failure', async () => {
      mockService.getAll.mockResolvedValueOnce(failure('INTERNAL_SERVER'));

      const response = await controller.getAll();

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(500);
      expect((response as any).error).toBe('INTERNAL_SERVER');
    });
  });

  describe('getById', () => {
    const validId = '550e8400-e29b-41d4-a716-446655440000';

    it('returns success when university is found', async () => {
      const university = { id: validId, name: 'Test University', slug: 'test' };
      mockService.getById.mockResolvedValueOnce(success(university));

      const response = await controller.getById(validId);

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
      expect((response as any).data).toEqual(university);
    });

    it('returns BAD_REQUEST for invalid UUID', async () => {
      const response = await controller.getById('not-a-uuid');

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(400);
      expect((response as any).error).toBe('BAD_REQUEST');
    });

    it('returns NOT_FOUND when university does not exist', async () => {
      mockService.getById.mockResolvedValueOnce(failure('NOT_FOUND'));

      const response = await controller.getById(validId);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(404);
      expect((response as any).error).toBe('NOT_FOUND');
    });

    it('returns error when service returns failure', async () => {
      mockService.getById.mockResolvedValueOnce(failure('INTERNAL_SERVER'));

      const response = await controller.getById(validId);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(500);
      expect((response as any).error).toBe('INTERNAL_SERVER');
    });
  });

  describe('update', () => {
    const validId = '550e8400-e29b-41d4-a716-446655440000';

    it('returns success when university is updated', async () => {
      const updated = { id: validId, name: 'Updated Name', slug: 'test' };
      mockService.update.mockResolvedValueOnce(success(updated));

      const response = await controller.update(mockCtx, validId, { name: 'Updated Name' });

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
      expect((response as any).data).toEqual(updated);
    });

    it('returns BAD_REQUEST for invalid UUID', async () => {
      const response = await controller.update(mockCtx, 'not-a-uuid', { name: 'Updated' });

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(400);
      expect((response as any).error).toBe('BAD_REQUEST');
    });

    it('returns UNPROCESSABLE_ENTITY for invalid body', async () => {
      const response = await controller.update(mockCtx, validId, { name: 'AB' });

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect((response as any).error).toBe('UNPROCESSABLE_ENTITY');
    });

    it('returns CONFLICT when slug already exists', async () => {
      mockService.update.mockResolvedValueOnce(failure('CONFLICT'));

      const response = await controller.update(mockCtx, validId, { slug: 'taken' });

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(409);
      expect((response as any).error).toBe('CONFLICT');
    });

    it('returns NOT_FOUND when university does not exist', async () => {
      mockService.update.mockResolvedValueOnce(failure('NOT_FOUND'));

      const response = await controller.update(mockCtx, validId, { name: 'New' });

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(404);
      expect((response as any).error).toBe('NOT_FOUND');
    });

    it('returns error when service returns failure', async () => {
      mockService.update.mockResolvedValueOnce(failure('INTERNAL_SERVER'));

      const response = await controller.update(mockCtx, validId, { name: 'New' });

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(500);
      expect((response as any).error).toBe('INTERNAL_SERVER');
    });
  });

  describe('update — branding feature gate (issue #108)', () => {
    const validId = '550e8400-e29b-41d4-a716-446655440000';

    it('gates the request when body carries logoUrl', async () => {
      mockService.update.mockResolvedValueOnce(success({ id: validId }));

      const response = await controller.update(mockCtx, validId, {
        logoUrl: 'https://cdn.example.com/logo.png',
      });

      expect(response.success).toBe(true);
      expect(mockRequireFeature).toHaveBeenCalledTimes(1);
      expect(mockRequireFeature).toHaveBeenCalledWith(mockCtx, 'branding');
    });

    it('gates the request when body carries brandColor', async () => {
      mockService.update.mockResolvedValueOnce(success({ id: validId }));

      const response = await controller.update(mockCtx, validId, { brandColor: '#FF6600' });

      expect(response.success).toBe(true);
      expect(mockRequireFeature).toHaveBeenCalledWith(mockCtx, 'branding');
    });

    it('does NOT gate a plain rename — non-branding updates stay unaffected', async () => {
      mockService.update.mockResolvedValueOnce(success({ id: validId, name: 'Renamed' }));

      const response = await controller.update(mockCtx, validId, { name: 'Renamed University' });

      expect(response.success).toBe(true);
      expect(mockRequireFeature).not.toHaveBeenCalled();
      expect(mockService.update).toHaveBeenCalledTimes(1);
    });

    it('rejects with FORBIDDEN before touching the service when the feature is off', async () => {
      mockRequireFeature.mockRejectedValueOnce(new AppError('FORBIDDEN'));

      await expect(controller.update(mockCtx, validId, { brandColor: '#FF6600' })).rejects.toThrow(
        'FORBIDDEN',
      );

      expect(mockService.update).not.toHaveBeenCalled();
    });

    it('still enforces input validation for branding payloads once entitled', async () => {
      const response = await controller.update(mockCtx, validId, {
        brandColor: 'not-a-hex-color',
      });

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect(mockRequireFeature).toHaveBeenCalledWith(mockCtx, 'branding');
      expect(mockService.update).not.toHaveBeenCalled();
    });

    it('does not gate when branding keys are absent but other fields are present', async () => {
      mockService.update.mockResolvedValueOnce(success({ id: validId }));

      await controller.update(mockCtx, validId, { name: 'Only a name', slug: 'only-a-slug' });

      expect(mockRequireFeature).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    const validId = '550e8400-e29b-41d4-a716-446655440000';

    it('returns success when university is deleted', async () => {
      mockService.delete.mockResolvedValueOnce(success(undefined));

      const response = await controller.delete(validId);

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
      expect((response as any).data).toEqual({ success: true });
    });

    it('returns BAD_REQUEST for invalid UUID', async () => {
      const response = await controller.delete('not-a-uuid');

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(400);
      expect((response as any).error).toBe('BAD_REQUEST');
    });

    it('returns NOT_FOUND when university does not exist', async () => {
      mockService.delete.mockResolvedValueOnce(failure('NOT_FOUND'));

      const response = await controller.delete(validId);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(404);
      expect((response as any).error).toBe('NOT_FOUND');
    });

    it('returns error when service returns failure', async () => {
      mockService.delete.mockResolvedValueOnce(failure('INTERNAL_SERVER'));

      const response = await controller.delete(validId);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(500);
      expect((response as any).error).toBe('INTERNAL_SERVER');
    });
  });
});
