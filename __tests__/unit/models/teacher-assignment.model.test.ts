import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import {
  AddQuestionsSchema,
  CreateTeacherAssignmentSchema,
  GradeAnswerSchema,
  PublishAssignmentSchema,
  RandomizeSchema,
  RemoveQuestionSchema,
  SetTargetsSchema,
  UpdateTeacherAssignmentSchema,
} from '@studiq/server/models/teacher-assignment.model';
import { describe, expect, it } from 'vitest';

describe('CreateTeacherAssignmentSchema', () => {
  const minimal = {
    title: 'Chapter 5 Quiz',
  };

  const full = {
    title: 'Chapter 5 Quiz',
    description: 'Test your knowledge of chapter 5',
    deadline: '2026-07-20T00:00:00.000Z',
    timeLimitMin: 30,
    shuffleQuestions: true,
    shuffleAnswers: false,
    showResults: true,
    maxAttempts: 3,
    passingScore: 60,
  };

  it('passes with minimal input', () => {
    const result = CreateTeacherAssignmentSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe('Chapter 5 Quiz');
      expect(result.data.shuffleQuestions).toBe(true);
      expect(result.data.shuffleAnswers).toBe(true);
      expect(result.data.showResults).toBe(false);
      expect(result.data.maxAttempts).toBe(1);
    }
  });

  it('passes with full input', () => {
    const result = CreateTeacherAssignmentSchema.safeParse(full);
    expect(result.success).toBe(true);
  });

  it('fails when title is empty', () => {
    const result = CreateTeacherAssignmentSchema.safeParse({ title: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.REQUIRED);
    }
  });

  it('fails when title exceeds 200 chars', () => {
    const result = CreateTeacherAssignmentSchema.safeParse({ title: 'x'.repeat(201) });
    expect(result.success).toBe(false);
  });

  it('fails when timeLimitMin is negative', () => {
    const result = CreateTeacherAssignmentSchema.safeParse({
      title: 'Test',
      timeLimitMin: -1,
    });
    expect(result.success).toBe(false);
  });

  it('fails when timeLimitMin exceeds 300', () => {
    const result = CreateTeacherAssignmentSchema.safeParse({
      title: 'Test',
      timeLimitMin: 301,
    });
    expect(result.success).toBe(false);
  });

  it('fails when maxAttempts exceeds 10', () => {
    const result = CreateTeacherAssignmentSchema.safeParse({
      title: 'Test',
      maxAttempts: 11,
    });
    expect(result.success).toBe(false);
  });

  it('fails when passingScore exceeds 100', () => {
    const result = CreateTeacherAssignmentSchema.safeParse({
      title: 'Test',
      passingScore: 101,
    });
    expect(result.success).toBe(false);
  });

  it('fails when deadline is not a datetime string', () => {
    const result = CreateTeacherAssignmentSchema.safeParse({
      title: 'Test',
      deadline: 'not-a-date',
    });
    expect(result.success).toBe(false);
  });
});

describe('UpdateTeacherAssignmentSchema', () => {
  it('passes with partial input', () => {
    const result = UpdateTeacherAssignmentSchema.safeParse({ title: 'Updated title' });
    expect(result.success).toBe(true);
  });

  it('passes with empty object', () => {
    const result = UpdateTeacherAssignmentSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('fails when title is empty string', () => {
    const result = UpdateTeacherAssignmentSchema.safeParse({ title: '' });
    expect(result.success).toBe(false);
  });
});

describe('AddQuestionsSchema', () => {
  it('passes with valid question IDs', () => {
    const result = AddQuestionsSchema.safeParse({
      questionIds: ['550e8400-e29b-41d4-a716-446655440000'],
    });
    expect(result.success).toBe(true);
  });

  it('fails with empty array', () => {
    const result = AddQuestionsSchema.safeParse({ questionIds: [] });
    expect(result.success).toBe(false);
  });

  it('fails with non-uuid strings', () => {
    const result = AddQuestionsSchema.safeParse({ questionIds: ['not-a-uuid'] });
    expect(result.success).toBe(false);
  });

  it('fails when questionIds is missing', () => {
    const result = AddQuestionsSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('RemoveQuestionSchema', () => {
  it('passes with valid question ID', () => {
    const result = RemoveQuestionSchema.safeParse({
      questionId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
  });

  it('fails with non-uuid', () => {
    const result = RemoveQuestionSchema.safeParse({ questionId: 'bad' });
    expect(result.success).toBe(false);
  });
});

describe('RandomizeSchema', () => {
  it('passes with valid input', () => {
    const result = RandomizeSchema.safeParse({
      source: 'bank',
      sourceId: '550e8400-e29b-41d4-a716-446655440000',
      count: 10,
    });
    expect(result.success).toBe(true);
  });

  it('passes with optional types filter', () => {
    const result = RandomizeSchema.safeParse({
      source: 'all',
      count: 5,
      types: ['mcq', 'open'],
    });
    expect(result.success).toBe(true);
  });

  it('fails with invalid source', () => {
    const result = RandomizeSchema.safeParse({ source: 'invalid', count: 5 });
    expect(result.success).toBe(false);
  });

  it('fails when count is missing', () => {
    const result = RandomizeSchema.safeParse({ source: 'topic' });
    expect(result.success).toBe(false);
  });

  it('fails when count exceeds 50', () => {
    const result = RandomizeSchema.safeParse({ source: 'all', count: 51 });
    expect(result.success).toBe(false);
  });

  it('fails when sourceId is not a uuid', () => {
    const result = RandomizeSchema.safeParse({
      source: 'bank',
      sourceId: 'bad-uuid',
      count: 5,
    });
    expect(result.success).toBe(false);
  });
});

describe('SetTargetsSchema', () => {
  it('passes with groupIds', () => {
    const result = SetTargetsSchema.safeParse({
      groupIds: ['550e8400-e29b-41d4-a716-446655440000'],
    });
    expect(result.success).toBe(true);
  });

  it('passes with studentIds', () => {
    const result = SetTargetsSchema.safeParse({
      studentIds: ['550e8400-e29b-41d4-a716-446655440000'],
    });
    expect(result.success).toBe(true);
  });

  it('passes with empty object (clear targets)', () => {
    const result = SetTargetsSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe('GradeAnswerSchema', () => {
  it('passes with valid input', () => {
    const result = GradeAnswerSchema.safeParse({
      questionId: '550e8400-e29b-41d4-a716-446655440000',
      points: 5,
    });
    expect(result.success).toBe(true);
  });

  it('passes with optional feedback', () => {
    const result = GradeAnswerSchema.safeParse({
      questionId: '550e8400-e29b-41d4-a716-446655440000',
      points: 3,
      feedback: 'Good effort',
    });
    expect(result.success).toBe(true);
  });

  it('fails with negative points', () => {
    const result = GradeAnswerSchema.safeParse({
      questionId: '550e8400-e29b-41d4-a716-446655440000',
      points: -1,
    });
    expect(result.success).toBe(false);
  });

  it('fails when questionId is missing', () => {
    const result = GradeAnswerSchema.safeParse({ points: 5 });
    expect(result.success).toBe(false);
  });

  it('fails when points is missing', () => {
    const result = GradeAnswerSchema.safeParse({
      questionId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(false);
  });

  it('fails with non-integer points', () => {
    const result = GradeAnswerSchema.safeParse({
      questionId: '550e8400-e29b-41d4-a716-446655440000',
      points: 1.5,
    });
    expect(result.success).toBe(false);
  });
});

describe('PublishAssignmentSchema', () => {
  it('passes with deadline', () => {
    const result = PublishAssignmentSchema.safeParse({
      deadline: '2026-07-20T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('passes without deadline', () => {
    const result = PublishAssignmentSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('fails with invalid datetime', () => {
    const result = PublishAssignmentSchema.safeParse({ deadline: 'bad' });
    expect(result.success).toBe(false);
  });
});
