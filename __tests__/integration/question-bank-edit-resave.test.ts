import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { json } from '#test/helpers/json';
import {
  type BeforeResult,
  before,
  createTestUser,
  type TestUserFixture,
} from '#test/helpers/test-user';
import { cleanupOrganizationDeep, createServiceClient, mockUser } from '#test/integration/helpers';
import {
  createNextRequest,
  createNextRequestWithParams,
  requiredAt,
} from '#test/integration/test-utils';
import { PUT as updateBank } from '@/app/(backend)/api/v1/questions/banks/[id]/route';
import { POST as createBank } from '@/app/(backend)/api/v1/questions/banks/route';
import { contentFormPayload } from '@/lib/share-fields';

const suiteId = crypto.randomUUID().slice(0, 8);

/** Bank payload of `PUT /api/v1/questions/banks/:id` — the fields read below. */
interface BankBody {
  success: boolean;
  error?: string;
  data: { id: string; name: string; visibility: string; groupIds: string[] };
}

/**
 * #1557: a group-shared question bank edited by an org Admin who does not teach the group. The
 * dialog opened without the stored share fields, so the save sent `visibility: 'personal'` with no
 * `groupIds`. The bank answered 200: its `visibility` became personal and the questions cascaded,
 * while the `bank_groups` rows stayed. The group lost access with no warning. The body here comes
 * from the dialog's own payload builder, because the omission it performs is exactly what this file
 * pins.
 */
describe(`Question bank edit keeps the share set (#1557)`, () => {
  const service = createServiceClient();
  let teacher!: BeforeResult;
  let orgAdmin!: TestUserFixture;
  let orgId!: string;
  let groupA!: string;
  let groupB!: string;
  let bankId!: string;

  async function bankGroupIds(): Promise<string[]> {
    const { data } = await service.from('bank_groups').select('group_id').eq('bank_id', bankId);
    return (data ?? []).map((row) => row.group_id).toSorted();
  }

  async function putFor(user: TestUserFixture, body: Record<string, unknown>) {
    mockUser(user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/questions/banks/${bankId}`,
      { id: bankId },
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      { active_org_id: orgId },
    );
    const res = await updateBank(request, { params });
    return { res, body: await json<BankBody>(res) };
  }

  beforeAll(async () => {
    teacher = await before({
      role: 'educator',
      org: `bank-resave-org-${suiteId}`,
      groups: 2,
    });
    orgId = teacher.orgId!;
    groupA = requiredAt(teacher.groups, 1, 'seeded group A');
    groupB = requiredAt(teacher.groups, 2, 'seeded group B');

    for (const groupId of [groupA, groupB]) {
      const { error } = await service
        .from('group_members')
        .insert({ group_id: groupId, user_id: teacher.user.id, role: 'teacher' });
      if (error) throw new Error(`[setup] teacher group membership failed: ${error.message}`);
    }

    const { data: adminRole } = await service
      .from('org_roles')
      .select('id')
      .eq('organization_id', orgId)
      .eq('name', 'admin')
      .single();
    if (!adminRole) throw new Error('[setup] admin org role not found');

    // An org Admin who teaches no group: the caller the Edit dialog failed for.
    orgAdmin = await createTestUser({ role: 'educator' });
    const { error: memberError } = await service
      .from('org_members')
      .insert({ organization_id: orgId, user_id: orgAdmin.id, org_role_id: adminRole.id });
    if (memberError) throw new Error(`[setup] org membership failed: ${memberError.message}`);

    mockUser(teacher.user);
    const bankRes = await createBank(
      createNextRequest(
        'http://localhost/api/v1/questions/banks',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `bank-resave-${suiteId}`,
            description: 'original',
            visibility: 'group',
            groupIds: [groupA, groupB],
          }),
        },
        { active_org_id: orgId },
      ),
    );
    const bankBody = await json<BankBody>(bankRes);
    if (!bankRes.ok || !bankBody.success) {
      throw new Error(`[setup] bank creation failed: ${JSON.stringify(bankBody)}`);
    }
    bankId = bankBody.data.id;
  });

  afterAll(async () => {
    await service.from('question_banks').delete().eq('created_by', teacher.user.id);
    await cleanupOrganizationDeep(orgId);
  });

  it('gives the org Admin no group-teacher membership', async () => {
    const { data } = await service
      .from('group_members')
      .select('group_id')
      .eq('user_id', orgAdmin.id)
      .in('group_id', [groupA, groupB]);
    expect(data).toEqual([]);
  });

  it('keeps the share on a name-only edit from the org Admin, who does not teach the group', async () => {
    const name = `bank-resave-${suiteId}-renamed`;
    const payload = contentFormPayload(
      { visibility: 'group', groupIds: [groupA, groupB] },
      // The picker returns the same groups in another order: still unchanged.
      { name, description: 'edited', visibility: 'group', groupIds: [groupB, groupA] },
    );

    const { res, body } = await putFor(orgAdmin, payload);

    expect(res.status).toBe(200);
    expect(body.data.name).toBe(name);
    expect(body.data.groupIds.toSorted()).toEqual([groupA, groupB].toSorted());

    const { data: stored } = await service
      .from('question_banks')
      .select('name, description, visibility')
      .eq('id', bankId)
      .single();
    expect(stored).toEqual({ name, description: 'edited', visibility: 'group' });
    expect(await bankGroupIds()).toEqual([groupA, groupB].toSorted());
  });

  it('refuses a real share change from the org Admin', async () => {
    const payload = contentFormPayload(
      { visibility: 'group', groupIds: [groupA, groupB] },
      {
        name: `bank-resave-${suiteId}-renamed`,
        description: 'edited',
        visibility: 'group',
        groupIds: [groupA],
      },
    );

    const { res, body } = await putFor(orgAdmin, payload);

    expect(res.status).toBe(403);
    expect(body.error).toBe('FORBIDDEN');
    expect(await bankGroupIds()).toEqual([groupA, groupB].toSorted());
  });

  it('applies the same share change for the group teacher', async () => {
    const payload = contentFormPayload(
      { visibility: 'group', groupIds: [groupA, groupB] },
      {
        name: `bank-resave-${suiteId}-renamed`,
        description: 'edited',
        visibility: 'group',
        groupIds: [groupA],
      },
    );

    const { res, body } = await putFor(teacher.user, payload);

    expect(res.status).toBe(200);
    expect(body.data.groupIds).toEqual([groupA]);
    expect(await bankGroupIds()).toEqual([groupA]);
  });

  it('refuses the old personal-only body from the Admin, who does not teach the group', async () => {
    // The body the buggy dialog sent: no `groupIds`, so the service would touch no links.
    // #1562 makes that a share change: the groups it would drop must be taught.
    const { res, body } = await putFor(orgAdmin, {
      name: `bank-resave-${suiteId}-renamed`,
      description: 'edited',
      visibility: 'personal',
    });

    expect(res.status).toBe(403);
    expect(body.error).toBe('FORBIDDEN');

    const { data: stored } = await service
      .from('question_banks')
      .select('visibility')
      .eq('id', bankId)
      .single();
    expect(stored).toEqual({ visibility: 'group' });
    expect(await bankGroupIds()).toEqual([groupA]);
  });
});
