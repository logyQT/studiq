import { describe, it, expect, vi, beforeEach } from 'vitest';
import { universityController } from './university.controller';
import { universityService } from '@/server/services';
import { AppError } from '@/lib/errors';

vi.mock('@/server/services', () => ({
  universityService: {
    create: vi.fn(),
  },
}));

const mockService = vi.mocked(universityService);

describe('UniversityController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('returns success when university is created', async () => {
      const university = { id: 'uni-1', name: 'Test University', slug: 'test' };
      mockService.create.mockResolvedValueOnce(university);

      const response = await universityController.create({ name: 'Test University', slug: 'test' });

      expect(response).toEqual({
        success: true,
        statusCode: 201,
        data: university,
      });
    });

    it('returns UNPROCESSABLE_ENTITY for invalid input', async () => {
      const response = await universityController.create({ name: 'AB', slug: 'bad slug!' });

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect(response.error).toBe('UNPROCESSABLE_ENTITY');
    });

    it('returns CONFLICT when slug already exists', async () => {
      mockService.create.mockRejectedValueOnce(new AppError('CONFLICT'));

      const response = await universityController.create({ name: 'Test', slug: 'taken' });

      expect(response).toEqual({
        success: false,
        statusCode: 409,
        error: 'CONFLICT',
      });
    });
  });
});
