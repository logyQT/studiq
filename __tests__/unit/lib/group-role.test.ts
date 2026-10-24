import { describe, expect, it } from 'vitest';
import {
  type AddableOrgMember,
  defaultGroupRole,
  ensureMemberRoles,
  type GroupMemberRole,
  toGroupMemberOptions,
} from '@/lib/group-role';

const members: AddableOrgMember[] = [
  {
    id: 't2',
    email: 'teacher2@dev.local',
    fullName: 'Tomasz Teacher',
    orgRoleName: 'teacher',
  },
  {
    id: 's1',
    email: 'student1@dev.local',
    fullName: null,
    orgRoleName: 'member',
  },
];

describe('defaultGroupRole', () => {
  it('prefills org teachers as group teachers', () => {
    expect(defaultGroupRole('teacher')).toBe('teacher');
  });

  it('prefills org members as plain group members', () => {
    expect(defaultGroupRole('member')).toBe('member');
  });

  it('keeps org admins and custom org roles as plain members', () => {
    expect(defaultGroupRole('admin')).toBe('member');
    expect(defaultGroupRole('head of department')).toBe('member');
  });

  it('falls back to member when the org role is missing', () => {
    expect(defaultGroupRole(null)).toBe('member');
    expect(defaultGroupRole(undefined)).toBe('member');
    expect(defaultGroupRole('')).toBe('member');
  });

  it('is case-sensitive, matching the seeded org role name', () => {
    expect(defaultGroupRole('Teacher')).toBe('member');
  });
});

describe('toGroupMemberOptions', () => {
  it('keeps the org role on every option', () => {
    expect(toGroupMemberOptions(members)).toEqual([
      {
        label: 'Tomasz Teacher (teacher2@dev.local)',
        value: 't2',
        orgRoleName: 'teacher',
      },
      {
        label: 'student1@dev.local',
        value: 's1',
        orgRoleName: 'member',
      },
    ]);
  });

  it('drops nothing but the fields the select does not need', () => {
    const [teacherOption] = toGroupMemberOptions(members);
    // Regression guard: dropping `orgRoleName` here made every teacher a member.
    expect(teacherOption.orgRoleName).toBe('teacher');
    expect(teacherOption.value).toBe('t2');
  });
});

describe('ensureMemberRoles', () => {
  const options = toGroupMemberOptions(members);

  it('defaults a newly selected org teacher to teacher and an org member to member', () => {
    expect(ensureMemberRoles({}, ['t2', 's1'], options)).toEqual({
      t2: 'teacher',
      s1: 'member',
    });
  });

  it('never overwrites roles that are already known', () => {
    const existing: Record<string, GroupMemberRole> = { t2: 'teacher', s1: 'member' };
    expect(ensureMemberRoles(existing, ['s1'], options)).toEqual({
      t2: 'teacher',
      s1: 'member',
    });

    // The manager explicitly demoted the teacher — the org role must not win.
    const demoted: Record<string, GroupMemberRole> = { t2: 'member' };
    expect(ensureMemberRoles(demoted, ['t2'], options)).toEqual({ t2: 'member' });
  });

  it('keeps a persisted teacher when the option is missing or says member', () => {
    const existing: Record<string, GroupMemberRole> = { o1t1: 'teacher' };
    expect(ensureMemberRoles(existing, ['o1t1'], options)).toEqual({ o1t1: 'teacher' });
    expect(ensureMemberRoles(existing, ['o1t1'], [])).toEqual({ o1t1: 'teacher' });
    expect(
      ensureMemberRoles(existing, ['o1t1'], [{ value: 'o1t1', orgRoleName: 'member' }]),
    ).toEqual({ o1t1: 'teacher' });
  });

  it('falls back to member for ids that are no longer in the org', () => {
    expect(ensureMemberRoles({}, ['gone'], options)).toEqual({ gone: 'member' });
  });

  it('does not mutate the input map', () => {
    const existing: Record<string, GroupMemberRole> = { s1: 'member' };
    const next = ensureMemberRoles(existing, ['t2'], options);

    expect(existing).toEqual({ s1: 'member' });
    expect(next).not.toBe(existing);
    expect(next).toEqual({ s1: 'member', t2: 'teacher' });
  });
});
