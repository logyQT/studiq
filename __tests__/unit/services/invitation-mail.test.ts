import { AccountType, type RequestContext } from '@studiq/authz';
import { error as logError, log, warn } from '@studiq/server/lib/log';
import type { Mailer } from '@studiq/server/lib/mailer/mailer';
import {
  INVITE_MAIL_LIMIT_PER_HOUR,
  InvitationService,
} from '@studiq/server/services/invitation.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@studiq/server/services/limits.resolver', () => ({
  limitsResolver: {
    checkLimit: vi.fn().mockResolvedValue(undefined),
    checkOrgLimit: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('@studiq/server/lib/log', () => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() }));

// #604: e-mail is best effort on top of the copyable link. These tests pin the contract:
// the message carries the exact link the API returns, and nothing about delivery can
// change the row, the link or the response.

function qb(data: any, error: any = null) {
  const result = { data: data ?? null, error };
  const promise = Promise.resolve(result);
  const b: any = {};
  for (const m of ['select', 'insert', 'eq', 'in', 'order', 'limit']) b[m] = vi.fn(() => b);
  b.single = vi.fn().mockResolvedValue(result);
  b.maybeSingle = vi.fn().mockResolvedValue(result);
  b.then = promise.then.bind(promise);
  b.catch = promise.catch.bind(promise);
  b.finally = promise.finally.bind(promise);
  return b;
}

const SITE = 'https://studiq.test';
const TOKEN = '0123456789abcdef0123456789abcdef';

function ctxFor(org: string): RequestContext {
  return {
    userId: 'manager-1',
    accountType: AccountType.MANAGER,
    traceId: 'trace-1',
    url: '',
    method: 'POST',
    activeOrgId: org,
    orgRoleId: null,
    groupIds: [],
    permissionScopes: {},
  };
}

describe('InvitationService e-mail delivery', () => {
  let request: { from: ReturnType<typeof vi.fn> };
  let admin: { from: ReturnType<typeof vi.fn>; rpc: ReturnType<typeof vi.fn> };
  let sendInvitation: ReturnType<typeof vi.fn>;
  let mailer: Mailer;
  let getMailer: ReturnType<typeof vi.fn>;
  let service: InvitationService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', SITE);

    request = { from: vi.fn() };
    admin = {
      rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
      from: vi.fn((table: string) =>
        table === 'organizations'
          ? qb({ name: 'WSB Merito' })
          : qb(table === 'profiles' ? { full_name: 'Jan Kowalski' } : null),
      ),
    };
    sendInvitation = vi.fn().mockResolvedValue(undefined);
    mailer = { sendInvitation } as Mailer;
    getMailer = vi.fn(() => mailer);
    service = new InvitationService(
      async () => request as any,
      () => admin as any,
      getMailer,
    );
  });

  function singleInsert(org: string) {
    request.from
      .mockReturnValueOnce(qb({ organization_id: org }))
      .mockReturnValueOnce(qb({ id: 'member' }))
      .mockReturnValueOnce(qb({ id: 'inv-1', token: TOKEN }));
  }

  function bulkInsert(org: string, rows: Array<{ id: string; token: string; email: string }>) {
    request.from
      .mockReturnValueOnce(qb({ organization_id: org }))
      .mockReturnValueOnce(qb([{ id: 'member' }]))
      .mockReturnValueOnce(qb(rows));
  }

  it('mails the same link the API returns, in the requested language', async () => {
    singleInsert('org-a');

    const result = await service.createInvitation(ctxFor('org-a'), {
      email: 'ola@example.com',
      targetOrgRoleId: 'member',
      locale: 'en',
    });

    expect(result.success && result.data.inviteLink).toBe(`${SITE}/join?token=${TOKEN}`);
    expect(sendInvitation).toHaveBeenCalledOnce();
    const mail = sendInvitation.mock.calls[0][0];
    expect(mail).toMatchObject({
      to: 'ola@example.com',
      orgName: 'WSB Merito',
      inviterName: 'Jan Kowalski',
      joinUrl: `${SITE}/join?token=${TOKEN}`,
      locale: 'en',
    });
    expect(mail.expiresAt).toBeInstanceOf(Date);
  });

  it('defaults to Polish when no language is given', async () => {
    singleInsert('org-b');
    await service.createInvitation(ctxFor('org-b'), {
      email: 'ola@example.com',
      targetOrgRoleId: 'member',
    });
    expect(sendInvitation.mock.calls[0][0].locale).toBe('pl');
  });

  it('keeps the invitation and its link when the provider fails, and logs no address', async () => {
    singleInsert('org-c');
    sendInvitation.mockRejectedValue(
      Object.assign(new Error('550 Recipient rejected: ola@example.com'), { code: 'EENVELOPE' }),
    );

    const result = await service.createInvitation(ctxFor('org-c'), {
      email: 'ola@example.com',
      targetOrgRoleId: 'member',
    });

    expect(result.success && result.data.inviteLink).toBe(`${SITE}/join?token=${TOKEN}`);
    expect(logError).toHaveBeenCalledWith(
      'invitation.mail_failed',
      expect.objectContaining({
        traceId: 'trace-1',
        invitationId: 'inv-1',
        errorCode: 'EENVELOPE',
      }),
    );
    expect(JSON.stringify(vi.mocked(logError).mock.calls)).not.toContain('ola@example.com');
  });

  it('keeps the invitation when the mail configuration is broken', async () => {
    singleInsert('org-d');
    getMailer.mockImplementation(() => {
      throw new Error('Invalid mail configuration');
    });

    const result = await service.createInvitation(ctxFor('org-d'), {
      email: 'ola@example.com',
      targetOrgRoleId: 'member',
    });

    expect(result.success).toBe(true);
    expect(logError).toHaveBeenCalledWith(
      'invitation.mail_failed',
      expect.objectContaining({ organizationId: 'org-d' }),
    );
  });

  it('does nothing, and reads nothing extra, when no mailer is configured', async () => {
    singleInsert('org-e');
    getMailer.mockReturnValue(null);

    const result = await service.createInvitation(ctxFor('org-e'), {
      email: 'ola@example.com',
      targetOrgRoleId: 'member',
    });

    expect(result.success).toBe(true);
    expect(admin.from).not.toHaveBeenCalled();
    expect(sendInvitation).not.toHaveBeenCalled();
  });

  it('writes one audit line per sent message, without the address or the token', async () => {
    singleInsert('org-f');
    await service.createInvitation(ctxFor('org-f'), {
      email: 'ola@example.com',
      targetOrgRoleId: 'member',
    });

    expect(log).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith('invitation.mail_sent', {
      traceId: 'trace-1',
      organizationId: 'org-f',
      invitationId: 'inv-1',
    });
  });

  it('bulk: one message per row, each in its own language, and a failure does not fail the batch', async () => {
    bulkInsert('org-g', [
      { id: 'i1', token: 'a'.repeat(32), email: 'a@example.com' },
      { id: 'i2', token: 'b'.repeat(32), email: 'b@example.com' },
    ]);
    sendInvitation.mockImplementation(async (mail: { to: string }) => {
      if (mail.to === 'b@example.com') throw new Error('boom');
    });

    const result = await service.createInvitationsBulk(ctxFor('org-g'), [
      { email: 'a@example.com', targetOrgRoleId: 'member', locale: 'en' },
      { email: 'b@example.com', targetOrgRoleId: 'member' },
    ]);

    expect(result.success && result.data.map((r) => r.data.inviteLink)).toEqual([
      `${SITE}/join?token=${'a'.repeat(32)}`,
      `${SITE}/join?token=${'b'.repeat(32)}`,
    ]);
    expect(sendInvitation).toHaveBeenCalledTimes(2);
    expect(sendInvitation.mock.calls.map(([m]) => [m.to, m.locale, m.joinUrl])).toEqual([
      ['a@example.com', 'en', `${SITE}/join?token=${'a'.repeat(32)}`],
      ['b@example.com', 'pl', `${SITE}/join?token=${'b'.repeat(32)}`],
    ]);
    expect(log).toHaveBeenCalledWith(
      'invitation.mail_sent',
      expect.objectContaining({ invitationId: 'i1' }),
    );
    expect(logError).toHaveBeenCalledWith(
      'invitation.mail_failed',
      expect.objectContaining({ invitationId: 'i2' }),
    );
  });

  it('rate-limits messages per organization but still creates every invitation', async () => {
    const total = INVITE_MAIL_LIMIT_PER_HOUR + 5;
    const rows = Array.from({ length: total }, (_, i) => ({
      id: `i${i}`,
      token: String(i).padStart(32, '0'),
      email: `user${i}@example.com`,
    }));
    bulkInsert('org-h', rows);

    const result = await service.createInvitationsBulk(
      ctxFor('org-h'),
      rows.map((r) => ({ email: r.email, targetOrgRoleId: 'member' })),
    );

    expect(result.success && result.data).toHaveLength(total);
    expect(sendInvitation).toHaveBeenCalledTimes(INVITE_MAIL_LIMIT_PER_HOUR);
    expect(warn).toHaveBeenCalledWith(
      'invitation.mail_rate_limited',
      expect.objectContaining({ organizationId: 'org-h', skipped: 5 }),
    );
  });
});
