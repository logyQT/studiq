import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

// Regression tests for issue #191: the `anon` role (public key shipped to every
// browser) could read AND write most public tables through PostgREST without a
// login. Only the public pricing data may be visible to an unauthenticated caller.

const PUBLIC_TABLES = ['plan_features', 'plan_limits', 'subscription_plans'];

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const anon = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

describe('anon role grants (#191)', () => {
  it('exposes only the public pricing tables in the anon OpenAPI schema', async () => {
    const res = await fetch(`${url}/rest/v1/`, { headers: { apikey: anonKey } });
    const spec = (await res.json()) as { paths: Record<string, unknown> };
    const tables = Object.keys(spec.paths)
      .filter((p) => p !== '/' && !p.startsWith('/rpc/'))
      .map((p) => p.slice(1))
      .sort();
    expect(tables).toEqual(PUBLIC_TABLES);
  });

  it.each(PUBLIC_TABLES)('anon can still read %s (public pricing page)', async (table) => {
    const { error } = await anon.from(table).select('*').limit(1);
    expect(error).toBeNull();
  });

  it.each([
    'question_banks',
    'quizzes',
    'teacher_assignments',
    'groups',
    'group_members',
    'org_roles',
    'org_role_permissions',
    'user_daily_activity',
    'feature_flags',
    'profiles',
    'invitations',
  ])('anon cannot read %s', async (table) => {
    const { data, error } = await anon.from(table).select('*').limit(1);
    expect(error?.code).toBe('42501');
    expect(data).toBeNull();
  });

  it('anon cannot insert into question_banks', async () => {
    const { error } = await anon.from('question_banks').insert({
      organization_id: '00000000-0000-4000-8000-00000000000e',
      created_by: '00000000-0000-4000-8001-000000000008',
      name: 'ANON-WRITE-TEST',
    });
    expect(error?.code).toBe('42501');
  });
});
