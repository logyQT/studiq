import { describe, it, expect, vi, beforeEach } from 'vitest';
import { subjectService } from '@/server/services/subject.service';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

describe('SubjectService', () => {
  const userId = 'test-user-id';
  let mock: ReturnType<typeof mockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
  });

  describe('create', () => {
    it('inserts subject and returns it', async () => {
      const mockSubject = { id: 'sub-1', name: 'Math 101' };
      mock.from.mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: mockSubject, error: null }),
          }),
        }),
      });

      const result = await subjectService.create({ name: 'Math 101' }, userId);

      expect(result).toEqual(mockSubject);
      expect(mock.from).toHaveBeenCalledWith('subjects');
    });

    it('throws INTERNAL_SERVER when insert fails', async () => {
      mock.from.mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
          }),
        }),
      });

      await expect(subjectService.create({ name: 'Math 101' }, userId)).rejects.toThrow(
        'ERROR_INTERNAL_SERVER',
      );
    });
  });

  describe('list', () => {
    it('returns all subjects when no filter', async () => {
      const subjects = [{ id: 'sub-1', name: 'Math 101' }];
      mock.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: subjects, error: null }),
        }),
      });

      const result = await subjectService.list();

      expect(result).toEqual(subjects);
    });

    it('filters by universityId when provided', async () => {
      const subjects = [{ id: 'sub-1', name: 'Math 101' }];
      const eqResult = { data: subjects, error: null };
      const eqFn = vi.fn().mockResolvedValue(eqResult);
      const orderResult = { data: subjects, error: null, eq: eqFn };
      orderResult.eq = eqFn;
      mock.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue(orderResult),
        }),
      });

      const result = await subjectService.list('uni-123');

      expect(result).toEqual(subjects);
    });
  });

  describe('getById', () => {
    it('returns subject when found', async () => {
      const subject = { id: 'sub-1', name: 'Math 101' };
      mock.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: subject, error: null }),
          }),
        }),
      });

      const result = await subjectService.getById('sub-1');

      expect(result).toEqual(subject);
    });

    it('throws NOT_FOUND when subject does not exist', async () => {
      mock.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      });

      await expect(subjectService.getById('nonexistent')).rejects.toThrow('ERROR_NOT_FOUND');
    });
  });

  describe('update', () => {
    it('updates subject and returns it', async () => {
      const updated = { id: 'sub-1', name: 'Updated' };
      mock.from.mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: updated, error: null }),
              }),
            }),
          }),
        }),
      });

      const result = await subjectService.update('sub-1', { name: 'Updated' }, userId);

      expect(result).toEqual(updated);
    });

    it('throws FORBIDDEN when subject not owned by user', async () => {
      mock.from.mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }),
        }),
      });

      await expect(subjectService.update('sub-1', { name: 'Updated' }, userId)).rejects.toThrow(
        'ERROR_FORBIDDEN',
      );
    });
  });

  describe('delete', () => {
    it('deletes subject successfully', async () => {
      mock.from.mockReturnValue({
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { id: 'sub-1' }, error: null }),
              }),
            }),
          }),
        }),
      });

      await expect(subjectService.delete('sub-1', userId)).resolves.toBeUndefined();
    });
  });
});
