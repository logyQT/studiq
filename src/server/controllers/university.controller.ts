import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { CreateUniversitySchema } from '@/server/models';
import { universityService } from '@/server/services';
import { AppErrorCode, handleApiError } from '@/lib/errors';

export class UniversityController {
  async create(req: NextRequest): Promise<NextResponse> {
    try {
      const body = (await req.json()) as unknown;

      const parsedData = CreateUniversitySchema.parse(body);

      const result = await universityService.create(parsedData);

      return NextResponse.json(result, { status: 201 });
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          {
            success: false,
            error: AppErrorCode.VALIDATION_FAILED,
            details: error.issues,
          },
          { status: 400 },
        );
      }

      return handleApiError(error, AppErrorCode.INTERNAL_SERVER);
    }
  }
}

export const universityController = new UniversityController();
