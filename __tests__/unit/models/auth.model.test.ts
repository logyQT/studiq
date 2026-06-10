import { describe, it, expect } from 'vitest';
import {
  RegisterSchema,
  LoginSchema,
  forgotPasswordSchema,
  updatePasswordSchema,
  NameSchema,
  passwordSchema,
} from '@/server/models/auth.model';
import { ValidationErrorCode } from '@/lib/validation-errors';

describe('NameSchema', () => {
  it('passes with valid name', () => {
    const result = NameSchema.safeParse('John Doe');
    expect(result.success).toBe(true);
  });

  it('fails with empty string', () => {
    const result = NameSchema.safeParse('');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.NAME_REQUIRED);
    }
  });

  it('fails with single character', () => {
    const result = NameSchema.safeParse('A');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.NAME_TOO_SHORT);
    }
  });

  it('fails with invalid characters (numbers)', () => {
    const result = NameSchema.safeParse('John123');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.NAME_INVALID_FORMAT);
    }
  });
});

describe('passwordSchema', () => {
  it('passes with valid password', () => {
    const result = passwordSchema.safeParse('SecurePass1');
    expect(result.success).toBe(true);
  });

  it('fails when too short', () => {
    const result = passwordSchema.safeParse('Ab1');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.PASSWORD_TOO_SHORT);
    }
  });

  it('fails when missing uppercase', () => {
    const result = passwordSchema.safeParse('securepass1');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.PASSWORD_MISSING_UPPERCASE);
    }
  });

  it('fails when missing number', () => {
    const result = passwordSchema.safeParse('SecurePass');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.PASSWORD_MISSING_NUMBER);
    }
  });

  it('fails when too long', () => {
    const result = passwordSchema.safeParse('A'.repeat(129) + '1');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.PASSWORD_TOO_LONG);
    }
  });
});

describe('RegisterSchema', () => {
  it('passes with valid input', () => {
    const result = RegisterSchema.safeParse({
      name: 'John Doe',
      email: 'john@example.com',
      password: 'SecurePass1',
    });
    expect(result.success).toBe(true);
  });

  it('fails with invalid email', () => {
    const result = RegisterSchema.safeParse({
      name: 'John Doe',
      email: 'not-an-email',
      password: 'SecurePass1',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const emailIssue = result.error.issues.find((i) => i.path.includes('email'));
      expect(emailIssue?.message).toBe(ValidationErrorCode.EMAIL_INVALID);
    }
  });

  it('accepts optional inviteToken', () => {
    const result = RegisterSchema.safeParse({
      name: 'John Doe',
      email: 'john@example.com',
      password: 'SecurePass1',
      inviteToken: 'some-token',
    });
    expect(result.success).toBe(true);
  });
});

describe('LoginSchema', () => {
  it('passes with valid input', () => {
    const result = LoginSchema.safeParse({
      email: 'john@example.com',
      password: 'SecurePass1',
    });
    expect(result.success).toBe(true);
  });

  it('fails when email is missing', () => {
    const result = LoginSchema.safeParse({ password: 'SecurePass1' });
    expect(result.success).toBe(false);
  });
});

describe('forgotPasswordSchema', () => {
  it('passes with valid email', () => {
    const result = forgotPasswordSchema.safeParse({ email: 'john@example.com' });
    expect(result.success).toBe(true);
  });

  it('fails with invalid email', () => {
    const result = forgotPasswordSchema.safeParse({ email: 'bad' });
    expect(result.success).toBe(false);
  });
});

describe('updatePasswordSchema', () => {
  it('passes when passwords match', () => {
    const result = updatePasswordSchema.safeParse({
      password: 'SecurePass1',
      confirmPassword: 'SecurePass1',
    });
    expect(result.success).toBe(true);
  });

  it('fails when passwords do not match', () => {
    const result = updatePasswordSchema.safeParse({
      password: 'SecurePass1',
      confirmPassword: 'DifferentPass1',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const confirmIssue = result.error.issues.find((i) => i.path.includes('confirmPassword'));
      expect(confirmIssue?.message).toBe(ValidationErrorCode.PASSWORDS_DO_NOT_MATCH);
    }
  });

  it('fails when confirmPassword is empty', () => {
    const result = updatePasswordSchema.safeParse({
      password: 'SecurePass1',
      confirmPassword: '',
    });
    expect(result.success).toBe(false);
  });
});
