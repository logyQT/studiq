import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import {
  forgotPasswordSchema,
  LoginSchema,
  NameSchema,
  passwordSchema,
  RegisterSchema,
  updatePasswordSchema,
} from '@studiq/server/models/auth.model';
import { describe, expect, it } from 'vitest';

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
    const result = passwordSchema.safeParse(`${'A'.repeat(129)}1`);
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
      accountType: 'student',
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

  it('reports an empty email as required, not invalid (#299)', () => {
    const result = RegisterSchema.safeParse({
      name: 'John Doe',
      email: '',
      password: 'SecurePass1',
      accountType: 'student',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const emailIssues = result.error.issues.filter((i) => i.path.includes('email'));
      expect(emailIssues.map((i) => i.message)).toEqual([ValidationErrorCode.EMAIL_REQUIRED]);
    }
  });

  it('accepts optional inviteToken', () => {
    const result = RegisterSchema.safeParse({
      name: 'John Doe',
      email: 'john@example.com',
      password: 'SecurePass1',
      accountType: 'educator',
      inviteToken: 'some-token',
    });
    expect(result.success).toBe(true);
  });

  it('works without inviteToken (plain registration)', () => {
    const result = RegisterSchema.safeParse({
      name: 'John Doe',
      email: 'john@example.com',
      password: 'SecurePass1',
      accountType: 'student',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.inviteToken).toBeUndefined();
  });

  it('rejects a non-string inviteToken', () => {
    const result = RegisterSchema.safeParse({
      name: 'John Doe',
      email: 'john@example.com',
      password: 'SecurePass1',
      accountType: 'student',
      inviteToken: 42,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.INVALID_INPUT);
    }
  });

  it('rejects an empty or oversized inviteToken', () => {
    const base = {
      name: 'John Doe',
      email: 'john@example.com',
      password: 'SecurePass1',
      accountType: 'student',
    };

    expect(RegisterSchema.safeParse({ ...base, inviteToken: '' }).success).toBe(false);
    expect(RegisterSchema.safeParse({ ...base, inviteToken: 'a'.repeat(129) }).success).toBe(false);
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

  it('reports an empty email as required, not invalid (#299)', () => {
    const result = LoginSchema.safeParse({ email: '', password: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const emailIssues = result.error.issues.filter((i) => i.path.includes('email'));
      expect(emailIssues.map((i) => i.message)).toEqual([ValidationErrorCode.EMAIL_REQUIRED]);
    }
  });

  it('still reports a malformed non-empty email as invalid', () => {
    const result = LoginSchema.safeParse({ email: 'not-an-email', password: 'pass' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const emailIssues = result.error.issues.filter((i) => i.path.includes('email'));
      expect(emailIssues.map((i) => i.message)).toEqual([ValidationErrorCode.EMAIL_INVALID]);
    }
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

  it('reports an empty email as required, not invalid (#299)', () => {
    const result = forgotPasswordSchema.safeParse({ email: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const emailIssues = result.error.issues.filter((i) => i.path.includes('email'));
      expect(emailIssues.map((i) => i.message)).toEqual([ValidationErrorCode.EMAIL_REQUIRED]);
    }
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

  it('accepts a short legacy currentPassword (no strength rules)', () => {
    const result = updatePasswordSchema.safeParse({
      currentPassword: 'pass',
      password: 'SecurePass1',
      confirmPassword: 'SecurePass1',
    });
    expect(result.success).toBe(true);
  });

  it('fails when currentPassword is empty', () => {
    const result = updatePasswordSchema.safeParse({
      currentPassword: '',
      password: 'SecurePass1',
      confirmPassword: 'SecurePass1',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const currentIssue = result.error.issues.find((i) => i.path.includes('currentPassword'));
      expect(currentIssue?.message).toBe(ValidationErrorCode.PASSWORD_REQUIRED);
    }
  });

  it('still accepts a payload without currentPassword (reset flow)', () => {
    const result = updatePasswordSchema.safeParse({
      password: 'SecurePass1',
      confirmPassword: 'SecurePass1',
    });
    expect(result.success).toBe(true);
  });
});
