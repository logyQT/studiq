/**
 * StudiQ load-test account seeder.
 *
 * Creates a pool of confirmed auth users directly through the Supabase Admin
 * API. The `handle_new_user` DB trigger then creates the matching `profiles`
 * row and stamps `app_metadata.account_type`, so seeded users behave exactly
 * like real signups (they can log in immediately, RLS applies, etc.).
 *
 * Usage:
 *   bun scripts/load-test/seed.ts --count 1000
 *   bun scripts/load-test/seed.ts --count 1000 --concurrency 25
 *   bun scripts/load-test/seed.ts --reset          # delete the whole pool
 *
 * Notes:
 *   - Idempotent: re-running with the same --count skips users that already exist.
 *   - Produces `.dev/load-test/accounts.json`, consumed by bots.ts.
 *   - The default mix is ~85% students / 10% educators / 5% managers.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  type AccountRecord,
  type AccountType,
  argBool,
  argNum,
  argStr,
  mapLimit,
  parseArgs,
  resolveConfig,
  sleep,
} from './config';

const FIRST_NAMES = [
  'Ada',
  'Alan',
  'Grace',
  'Linus',
  'Marie',
  'Niels',
  'Emmy',
  'Katherine',
  'Rosalind',
  'Turing',
  'Sofia',
  'Liam',
  'Noah',
  'Olivia',
  'Ethan',
  'Mia',
  'Lucas',
  'Emma',
  'Mateo',
  'Zoe',
  'Aisha',
  'Yuki',
  'Omar',
  'Priya',
  'Diego',
  'Lena',
  'Ivan',
  'Nadia',
  'Kofi',
  'Sara',
];

const LAST_NAMES = [
  'Nowak',
  'Kowalski',
  'Wisniewski',
  'Lewandowski',
  'Zielinski',
  'Szymanski',
  'Kaminski',
  'Kozlowski',
  'Smith',
  'Johnson',
  'Garcia',
  'Martinez',
  'Brown',
  'Davis',
  'Miller',
  'Wilson',
  'Ivanov',
  'Petrov',
  'Kim',
  'Chen',
  'Ali',
  'Hassan',
  'Silva',
  'Costa',
  'Dubois',
  'Muller',
];

interface SeedOptions {
  count: number;
  concurrency: number;
  studentRatio: number;
  educatorRatio: number;
  managerRatio: number;
}

function typeForIndex(index: number, opts: SeedOptions): AccountType {
  // Deterministic 20-slot cycle → exactly embodied ratios per block.
  const studentSlots = Math.round(opts.studentRatio * 20);
  const educatorSlots = Math.round(opts.educatorRatio * 20);
  const slot = (index - 1) % 20;
  if (slot < 20 - studentSlots - educatorSlots) return 'manager';
  if (slot < 20 - studentSlots) return 'educator';
  return 'student';
}

function buildAccounts(opts: SeedOptions, domain: string, password: string): AccountRecord[] {
  const accounts: AccountRecord[] = [];
  for (let i = 1; i <= opts.count; i++) {
    const accountType = typeForIndex(i, opts);
    const first = FIRST_NAMES[i % FIRST_NAMES.length];
    const last = LAST_NAMES[(i * 7) % LAST_NAMES.length];
    accounts.push({
      index: i,
      email: `lt-${String(i).padStart(4, '0')}@${domain}`,
      password,
      accountType,
      name: `${first} ${last}`,
    });
  }
  return accounts;
}

interface CreateOutcome {
  email: string;
  result: 'created' | 'exists' | 'error';
  status: number;
  detail?: string;
}

async function createUser(
  supabaseUrl: string,
  serviceRoleKey: string,
  account: AccountRecord,
): Promise<CreateOutcome> {
  const url = `${supabaseUrl}/auth/v1/admin/users`;
  const maxAttempts = 5;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: account.email,
        password: account.password,
        // Local GoTrue has enable_confirmations=true — confirm so bots can log in.
        email_confirm: true,
        // The DB trigger reads account_type from user_metadata (or app_metadata)
        // and creates the profiles row + stamps app_metadata.account_type.
        user_metadata: { name: account.name, account_type: account.accountType },
      }),
    });

    if (res.ok) return { email: account.email, result: 'created', status: res.status };

    const text = await res.text();
    // Already registered (GoTrue returns 422 / 409 with a message).
    if (res.status === 422 || res.status === 409 || /already/i.test(text)) {
      return { email: account.email, result: 'exists', status: res.status };
    }
    // Rate limited — honour Retry-After, then back off exponentially.
    if (res.status === 429 && attempt < maxAttempts) {
      const retryAfter = Number(res.headers.get('retry-after'));
      await sleep(
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * attempt,
      );
      continue;
    }
    // Transient server error — retry once with backoff.
    if (res.status >= 500 && attempt < maxAttempts) {
      await sleep(500 * attempt);
      continue;
    }
    return {
      email: account.email,
      result: 'error',
      status: res.status,
      detail: text.slice(0, 160),
    };
  }

  return { email: account.email, result: 'error', status: 0, detail: 'retry budget exhausted' };
}

async function resetPool(
  supabaseUrl: string,
  serviceRoleKey: string,
  domain: string,
): Promise<number> {
  let deleted = 0;
  const perPage = 1000;

  for (let page = 1; page <= 100; page++) {
    const res = await fetch(`${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=${perPage}`, {
      headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
    });
    if (!res.ok) {
      console.error(
        `  reset: list users failed (${res.status}): ${(await res.text()).slice(0, 160)}`,
      );
      break;
    }
    const payload = (await res.json()) as { users?: { id: string; email?: string }[] };
    const users = payload.users ?? [];
    if (users.length === 0) break;

    const matches = users.filter((user) => user.email?.endsWith(`@${domain}`));
    await mapLimit(matches, 10, async (user) => {
      const del = await fetch(`${supabaseUrl}/auth/v1/admin/users/${user.id}`, {
        method: 'DELETE',
        headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
      });
      if (del.ok) deleted++;
    });

    if (users.length < perPage) break;
  }

  return deleted;
}

function printSummary(accounts: AccountRecord[], outcomes: CreateOutcome[]): void {
  const totals: Record<AccountType, number> = { student: 0, educator: 0, manager: 0 };
  for (const account of accounts) totals[account.accountType]++;

  const created = outcomes.filter((o) => o.result === 'created').length;
  const exists = outcomes.filter((o) => o.result === 'exists').length;
  const errors = outcomes.filter((o) => o.result === 'error');

  console.log('\n  Account pool');
  console.log(`    students : ${totals.student}`);
  console.log(`    educators: ${totals.educator}`);
  console.log(`    managers : ${totals.manager}`);
  console.log(`    total    : ${accounts.length}`);
  console.log('\n  Provisioning');
  console.log(`    created  : ${created}`);
  console.log(`    existed  : ${exists}`);
  console.log(`    errors   : ${errors.length}`);
  for (const error of errors.slice(0, 5)) {
    console.log(`      ! ${error.email} → ${error.status} ${error.detail ?? ''}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  const config = resolveConfig({
    password: argStr(args, 'password', resolveConfig().password),
    emailDomain: argStr(args, 'domain', resolveConfig().emailDomain),
    supabaseUrl: argStr(args, 'supabase-url', resolveConfig().supabaseUrl),
    appUrl: argStr(args, 'app-url', resolveConfig().appUrl),
  });

  if (argBool(args, 'help')) {
    console.log(`StudiQ load-test seeder

  --count <n>          number of accounts (default 1000)
  --concurrency <n>    parallel admin requests (default 20)
  --students <0-1>     student ratio (default 0.85)
  --educators <0-1>    educator ratio (default 0.10)
  --managers <0-1>     manager ratio (default 0.05)
  --password <pw>      shared password (default Password123!)
  --domain <domain>    email domain (default loadtest.studiq.local)
  --supabase-url <url> Supabase API URL (default ${config.supabaseUrl})
  --reset              delete every account in the pool, then exit
  --dry-run            print the plan without creating anything
  --help               show this help`);
    return;
  }

  const opts: SeedOptions = {
    count: Math.max(1, argNum(args, 'count', 1000)),
    concurrency: Math.max(1, argNum(args, 'concurrency', 20)),
    studentRatio: argNum(args, 'students', 0.85),
    educatorRatio: argNum(args, 'educators', 0.1),
    managerRatio: argNum(args, 'managers', 0.05),
  };

  if (argBool(args, 'reset')) {
    console.log(`Resetting load-test pool (domain: @${config.emailDomain}) …`);
    const deleted = await resetPool(config.supabaseUrl, config.serviceRoleKey, config.emailDomain);
    console.log(`Deleted ${deleted} account(s).`);
    return;
  }

  const accounts = buildAccounts(opts, config.emailDomain, config.password);

  if (argBool(args, 'dry-run')) {
    printSummary(accounts, []);
    console.log('\n  dry-run: no users created.');
    return;
  }

  console.log(
    `Seeding ${accounts.length} accounts via ${config.supabaseUrl} (concurrency ${opts.concurrency}) …`,
  );
  let done = 0;
  const outcomes = await mapLimit(accounts, opts.concurrency, async (account) => {
    const outcome = await createUser(config.supabaseUrl, config.serviceRoleKey, account);
    done++;
    if (done % 100 === 0 || done === accounts.length) {
      process.stdout.write(`\r  ${done}/${accounts.length} processed…`);
    }
    return outcome;
  });
  process.stdout.write('\n');

  await mkdir(dirname(config.accountsFile), { recursive: true });
  await writeFile(
    config.accountsFile,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        supabaseUrl: config.supabaseUrl,
        appUrl: config.appUrl,
        password: config.password,
        domain: config.emailDomain,
        accounts,
      },
      null,
      2,
    ),
  );

  printSummary(accounts, outcomes);
  console.log(`\n  Pool written to ${config.accountsFile}`);
  console.log(`  Next: bun scripts/load-test/bots.ts --users 50 --duration 300\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
