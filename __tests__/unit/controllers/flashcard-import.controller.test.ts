import { AccountType, type RequestContext } from '@studiq/authz';
import { FlashcardImportController } from '@studiq/server/controllers/flashcard-import.controller';
import { FlashcardImportService } from '@studiq/server/services/flashcard-import.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function createMockService() {
  // The mocked methods never touch the database, so the client factory only
  // has to satisfy the constructor's type.
  return Object.assign(new FlashcardImportService(() => Promise.reject(new Error('unused'))), {
    importCsv: vi.fn(),
  });
}

let mockService: ReturnType<typeof createMockService>;
let controller: FlashcardImportController;

const mockCtx: RequestContext = {
  traceId: 'test-trace',
  userId: 'test-user-id',
  accountType: AccountType.STUDENT,
  orgRoleId: null,
  activeOrgId: null,
  url: 'http://localhost',
  method: 'POST',
  groupIds: [],
  permissionScopes: {},
};

const required = (row: number, field: string) => ({ row, field, error: 'VALIDATION_REQUIRED' });

describe('FlashcardImportController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockService = createMockService();
    controller = new FlashcardImportController(mockService);
  });

  describe('importCsv', () => {
    it('imports CSV successfully', async () => {
      mockService.importCsv.mockResolvedValueOnce({ success: true, data: { imported: 5 } });

      const response = await controller.importCsv(
        { cards: [{ front: 'Hello', back: 'Cześć' }] },
        mockCtx,
      );

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
    });

    it('imports the good rows and reports the others by their own number (#888)', async () => {
      mockService.importCsv.mockResolvedValueOnce({ success: true, data: { imported: 2 } });

      const response = await controller.importCsv(
        {
          deckId: '00000000-0000-4000-8000-000000000001',
          cards: [
            { front: '  indented\n    code  ', back: 'kept' },
            { front: '', back: 'only a back' },
            { front: '', back: '' },
            { front: '   ', back: '\t' },
            { front: 'only a front' },
            { front: 'ą €', back: '<b>&</b>' },
          ],
        },
        mockCtx,
      );

      // Valid content reaches the service exactly as written, spaces included.
      expect(mockService.importCsv).toHaveBeenCalledWith(
        {
          deckId: '00000000-0000-4000-8000-000000000001',
          cards: [
            { front: '  indented\n    code  ', back: 'kept' },
            { front: 'ą €', back: '<b>&</b>' },
          ],
        },
        mockCtx,
      );
      expect(response).toMatchObject({
        success: true,
        data: {
          total: 6,
          imported: 2,
          errors: [
            required(2, 'front'),
            required(3, 'front'),
            required(3, 'back'),
            required(4, 'front'),
            required(4, 'back'),
            { row: 5, field: 'back', error: 'VALIDATION_INVALID_INPUT' },
          ],
        },
      });
    });

    it.each([
      [500, true],
      [501, false],
    ])('accepts a request of %i rows: %s (#888)', async (count, accepted) => {
      mockService.importCsv.mockResolvedValueOnce({ success: true, data: { imported: count } });
      const cards = Array.from({ length: count }, () => ({ front: 'a', back: 'b' }));

      const response = await controller.importCsv({ cards }, mockCtx);

      expect(response.success).toBe(accepted);
      expect(mockService.importCsv).toHaveBeenCalledTimes(accepted ? 1 : 0);
    });

    it('refuses the whole request when a row is not an object', async () => {
      const response = await controller.importCsv({ cards: ['front,back'] }, mockCtx);

      expect(response.statusCode).toBe(422);
      expect(mockService.importCsv).not.toHaveBeenCalled();
    });

    it('returns 422 on invalid body', async () => {
      const response = await controller.importCsv({ cards: [] }, mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });

    it('returns error on service failure', async () => {
      mockService.importCsv.mockResolvedValueOnce({
        success: false,
        error: 'UNPROCESSABLE_ENTITY',
      });

      const response = await controller.importCsv(
        { cards: [{ front: 'Hello', back: 'Cześć' }] },
        mockCtx,
      );

      expect(response.success).toBe(false);
    });
  });
});
