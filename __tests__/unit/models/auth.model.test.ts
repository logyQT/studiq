import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import {
  forgotPasswordSchema,
  LoginSchema,
  NameSchema,
  passwordSchema,
  RegisterSchema,
  updatePasswordSchema,
  UpdateProfileSchema,
} from '@studiq/server/models/auth.model';
import { describe, expect, it } from 'vitest';

describe('NameSchema', () => {
  it('passes with valid name', () => {
    const result = NameSchema.safeParse('John Doe');
    expect(result.success).toBe(true);
  });

  // #302 / AUT-04: a hyphen (double-barrelled surname) and both apostrophe forms
  // are legitimate name characters and must not be rejected as invalid format.
  it('accepts hyphenated and apostrophised names (#302)', () => {
    for (const name of ['Anna-Maria Nowak', "Jan O'Brien", 'O’Brien', 'Łukasz Żółć']) {
      expect(NameSchema.parse(name), name).toBe(name);
    }
  });

  it('trims a padded hyphenated name without losing the hyphen (#302)', () => {
    expect(NameSchema.parse('  Anna-Maria Nowak  ')).toBe('Anna-Maria Nowak');
  });

  // The widened charset must not readmit the characters rejected before #302.
  it('still rejects other punctuation in a name (#302)', () => {
    for (const name of ['Jan_Doe', 'Jan@Doe', 'Jan123']) {
      const result = NameSchema.safeParse(name);
      expect(result.success, name).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe(ValidationErrorCode.NAME_INVALID_FORMAT);
      }
    }
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

  // #303 / AUT-04: whitespace is not content, so a blank-looking name must be
  // reported as required, not accepted because it happens to be 2+ characters.
  it('rejects a whitespace-only name', () => {
    const result = NameSchema.safeParse('   ');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.NAME_REQUIRED);
    }
  });

  it('rejects a tab/newline-only name', () => {
    for (const value of ['\t\t', '\n\n', ' \t \n ']) {
      const result = NameSchema.safeParse(value);
      expect(result.success, JSON.stringify(value)).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe(ValidationErrorCode.NAME_REQUIRED);
      }
    }
  });

  it('trims a padded name', () => {
    expect(NameSchema.parse('  Jan Kowalski  ')).toBe('Jan Kowalski');
  });

  it('rejects a name that is too short after trimming', () => {
    const result = NameSchema.safeParse(' A ');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.NAME_TOO_SHORT);
    }
  });

  // Whitespace is only a separator between letter groups: a single space, never
  // the tabs/newlines the previous `\s` class accepted.
  it('rejects internal whitespace other than a single space', () => {
    for (const value of ['Jan  Kowalski', 'Jan\tKowalski', 'Jan\nKowalski']) {
      const result = NameSchema.safeParse(value);
      expect(result.success, JSON.stringify(value)).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe(ValidationErrorCode.NAME_INVALID_FORMAT);
      }
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

  it('rejects a whitespace-only name and trims a padded one (#303)', () => {
    const base = {
      email: 'john@example.com',
      password: 'SecurePass1',
      accountType: 'student' as const,
    };

    const blank = RegisterSchema.safeParse({ ...base, name: '  ' });
    expect(blank.success).toBe(false);
    if (!blank.success) {
      const issue = blank.error.issues.find((i) => i.path.includes('name'));
      expect(issue?.message).toBe(ValidationErrorCode.NAME_REQUIRED);
    }

    expect(RegisterSchema.parse({ ...base, name: '  Jan Kowalski  ' }).name).toBe('Jan Kowalski');
  });

  // The register form (and `/join`) use this schema as their `zodResolver`, so
  // accepting these names here means the client sends the request instead of
  // showing the format error (#302 / AUT-04).
  it('accepts hyphenated and apostrophised names (#302)', () => {
    const base = {
      email: 'john@example.com',
      password: 'SecurePass1',
      accountType: 'student' as const,
    };

    for (const name of ['Anna-Maria Nowak', "Jan O'Brien", 'O’Brien']) {
      expect(RegisterSchema.parse({ ...base, name }).name, name).toBe(name);
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

// `PUT /api/v1/auth/profile` shares `NameSchema`, so a direct API call gets the
// same trim + blank rejection as the register form (#303).
describe('UpdateProfileSchema', () => {
  it('rejects a whitespace-only name', () => {
    const result = UpdateProfileSchema.safeParse({ name: '  ' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.NAME_REQUIRED);
    }
  });

  it('trims a padded name', () => {
    expect(UpdateProfileSchema.parse({ name: '  Jan  ' })).toEqual({ name: 'Jan' });
  });

  it('accepts a hyphenated name when re-saving the profile (#302)', () => {
    expect(UpdateProfileSchema.parse({ name: 'Anna-Maria Nowak' })).toEqual({
      name: 'Anna-Maria Nowak',
    });
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
