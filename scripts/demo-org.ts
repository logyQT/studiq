/**
 * Demo org flow — one command that builds a class-sized assessment fixture.
 *
 *   bun scripts/demo-org.ts --db-url postgresql://postgres:postgres@127.0.0.1:31767/postgres \
 *     --app-url http://localhost:3005 --students 30 --mcq 19 --open 1 --sample 5 --attempts 1
 *
 * Creates a fresh organisation (unique name per run), one teacher, N students,
 * one group, one bank, the requested item mix, publishes an assessment that
 * serves `--sample` of the pool for `--attempts` attempts, then has every
 * student answer with a configurable accuracy and prints the grading spread.
 *
 * It exists because demo/QA fixtures of this shape kept being rebuilt by hand:
 * the SQL side (auth users, org, roles, group) and the API side (bank, items,
 * assessment, submissions) are one flow, and a re-run must not collide with the
 * previous one.
 *
 * Accounts are written straight into `auth.users` (the same shape GoTrue writes,
 * exactly like `__tests__/helpers/tenant-seed.ts`) because the Admin API would
 * pay one request per account; the app itself is driven over HTTP so the rows
 * are produced by the real scoring path.
 *
 * `--db-url` / `--app-url` default to the environment (`SUPABASE_DB_URL`,
 * `APP_URL`). Nothing is deleted: each run owns a new organisation, so re-running
 * simply adds another class.
 */

import { SQL } from "bun";

interface Options {
  appUrl: string;
  dbUrl: string;
  students: number;
  mcq: number;
  open: number;
  tf: number;
  sample: number | null;
  attempts: number;
  accuracy: number;
  orgName: string;
  password: string;
  emailDomain: string;
  deadlineHours: number;
}

const HELP = `Demo org flow

  bun scripts/demo-org.ts [options]

  --db-url <url>        Postgres URL (default $SUPABASE_DB_URL)
  --app-url <url>       App origin (default $APP_URL)
  --students <n>        Students in the class (default 30)
  --mcq <n>             Choice items in the pool (default 19)
  --open <n>            Open-text items in the pool (default 1)
  --tf <n>              True/false items in the pool (default 0)
  --sample <n>          Items served per attempt (default 5; 0 = whole pool)
  --attempts <n>        maxAttempts (default 1)
  --accuracy <0..1>     Per-choice-item chance the simulated student is right (default 0.6)
  --org <name>          Organisation name prefix (default "Demo class")
  --password <pw>       Shared account password (default Password123!)
  --domain <domain>     Account e-mail domain (default demo.studiq.local)
  --deadline-hours <n>  Hours until the window closes (default 3)
  --help                This help

Every run creates a new organisation, so it is safe to repeat.`;

function parseArgs(argv: string[]): Options {
  const value = (name: string): string | undefined => {
    const inline = argv.find((arg) => arg.startsWith(`--${name}=`));
    if (inline) return inline.slice(name.length + 3);
    const index = argv.indexOf(`--${name}`);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const num = (name: string, fallback: number): number => {
    const raw = value(name);
    if (raw === undefined) return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed))
      throw new Error(`--${name} must be a number (got "${raw}")`);
    return parsed;
  };

  const dbUrl = value("db-url") ?? process.env.SUPABASE_DB_URL;
  const appUrl = value("app-url") ?? process.env.APP_URL;
  if (!dbUrl) throw new Error("missing --db-url (or SUPABASE_DB_URL)");
  if (!appUrl) throw new Error("missing --app-url (or APP_URL)");

  return {
    appUrl: appUrl.replace(/\/$/, ""),
    dbUrl,
    students: Math.max(1, num("students", 30)),
    mcq: Math.max(0, num("mcq", 19)),
    open: Math.max(0, num("open", 1)),
    tf: Math.max(0, num("tf", 0)),
    sample: num("sample", 5) === 0 ? null : Math.max(1, num("sample", 5)),
    attempts: Math.max(1, num("attempts", 1)),
    accuracy: Math.min(1, Math.max(0, num("accuracy", 0.6))),
    orgName: value("org") ?? "Demo class",
    password: value("password") ?? "Password123!",
    emailDomain: value("domain") ?? "demo.studiq.local",
    deadlineHours: Math.max(1, num("deadline-hours", 3)),
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** One cookie jar per account; every response's Set-Cookie is merged in. */
class Session {
  private cookies = new Map<string, string>();

  constructor(private readonly base: string) {}

  async request(
    path: string,
    init: RequestInit = {},
  ): Promise<{ rateLimited: boolean; data?: unknown }> {
    const cookie = [...this.cookies.values()].join("; ");
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { cookie } : {}),
        ...(init.headers ?? {}),
      },
    });
    for (const raw of res.headers.getSetCookie()) {
      const pair = raw.split(";")[0] ?? "";
      const name = pair.split("=")[0] ?? "";
      if (name) this.cookies.set(name, pair);
    }
    const text = await res.text();
    if (res.status === 429) return { rateLimited: true };
    if (!res.ok) {
      throw new Error(
        `${init.method ?? "GET"} ${path} -> ${res.status} ${text.slice(0, 400)}`,
      );
    }
    return {
      rateLimited: false,
      data: (JSON.parse(text) as { data?: unknown }).data,
    };
  }
}

async function login(
  base: string,
  email: string,
  password: string,
): Promise<Session> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const session = new Session(base);
    const result = await session.request("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    if (!result.rateLimited) return session;
    // Supabase allows 30 sign-ins per 5 minutes per IP; back off and retry.
    await sleep(15_000 * (attempt + 1));
  }
  throw new Error(`login ${email}: still rate-limited after retries`);
}

async function call<T>(
  session: Session,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const result = await session.request(path, init);
  if (result.rateLimited) throw new Error(`${path}: unexpected rate limit`);
  return result.data as T;
}

interface ItemSpec {
  type: "mcq" | "true_false" | "open";
  content: string;
  explanation?: string;
  modelAnswer?: string;
  answers: Array<{ content: string; isCorrect: boolean; orderIndex: number }>;
  /** Content of the correct option (choice items), used to bias the simulated answers. */
  correct?: string;
}

const UNITS: Array<[string, string]> = [
  ["Jaka jest jednostka siły w układzie SI?", "niuton"],
  ["Jaka jest jednostka energii?", "dżul"],
  ["Jaka jest jednostka mocy?", "wat"],
  ["Jaka jest jednostka ciśnienia?", "paskal"],
  ["Jaka jest jednostka ładunku elektrycznego?", "kulomb"],
  ["Jaka jest jednostka napięcia?", "wolt"],
  ["Jaka jest jednostka natężenia prądu?", "amper"],
  ["Jaka jest jednostka oporu?", "om"],
  ["Jaka jest jednostka częstotliwości?", "herc"],
  ["Jaka jest jednostka pracy?", "dżul pracy"],
  ["W jakiej jednostce mierzymy prędkość?", "metr na sekundę"],
  ["W jakiej jednostce mierzymy masę?", "kilogram"],
  ["W jakiej jednostce mierzymy czas?", "sekunda"],
  ["W jakiej jednostce mierzymy objętość?", "metr sześcienny"],
  ["W jakiej jednostce mierzymy temperaturę?", "stopień Celsjusza"],
  ["Która wielkość opisuje ilość materii?", "masa"],
  ["Która wielkość opisuje zmianę prędkości w czasie?", "przyspieszenie"],
  ["Która wielkość opisuje nacisk na jednostkę powierzchni?", "ciśnienie"],
  ["Która wielkość opisuje energię przekazywaną w czasie?", "moc"],
  ["Która wielkość opisuje opór materiału?", "opór elektryczny"],
];

const DISTRACTORS = [
  "wartość przybliżona, ale błędna",
  "jednostka nie pasuje do wielkości",
  "wielkość pokrewna, ale inna",
];

function explanationFor(answer: string, topic: string): string {
  return `${topic} Właściwa odpowiedź to ${answer}. Najczęstszy błąd to pomylenie jej z wielkością pokrewną, dlatego warto zapamiętać definicję, a nie tylko nazwę.`;
}

function buildItems(options: Options): ItemSpec[] {
  const items: ItemSpec[] = [];
  const total = options.mcq + options.open + options.tf;

  for (let index = 0; index < options.mcq; index += 1) {
    const [topic, answer] = UNITS[index % UNITS.length]!;
    const content =
      index < UNITS.length ? topic : `${topic} (wariant ${index + 1})`;
    const answers = [answer, ...DISTRACTORS].map((value, position) => ({
      content: `${value} [${index + 1}.${position + 1}]`,
      isCorrect: position === 0,
      orderIndex: position,
    }));
    items.push({
      type: "mcq",
      content: content.slice(0, 255),
      explanation: explanationFor(answer, topic),
      answers,
      correct: answers[0]!.content,
    });
  }

  for (let index = 0; index < options.tf; index += 1) {
    const isTrue = index % 2 === 0;
    items.push({
      type: "true_false",
      content: `Zdanie ${index + 1}: ${isTrue ? "siła jest wielkością wektorową." : "masa zależy od wysokości nad Ziemią."}`,
      explanation: explanationFor(
        isTrue ? "prawda" : "fałsz",
        "To zdanie sprawdza definicję wielkości fizycznej.",
      ),
      answers: [
        { content: "Prawda", isCorrect: isTrue, orderIndex: 0 },
        { content: "Fałsz", isCorrect: !isTrue, orderIndex: 1 },
      ],
      correct: isTrue ? "Prawda" : "Fałsz",
    });
  }

  for (let index = 0; index < options.open; index += 1) {
    items.push({
      type: "open",
      content: `Opisz jednym zdaniem, dlaczego ${index % 2 === 0 ? "pasy bezpieczeństwa zmniejszają skutki zderzenia" : "metalowy przedmiot wydaje się zimniejszy od drewnianego"}.`,
      modelAnswer:
        "Odpowiedź powinna wskazać mechanizm: wydłużenie czasu zatrzymania zmniejsza siłę działającą na ciało, a dobra przewodność cieplna metalu zwiększa odbiór ciepła z palca. Wystarczy jedna z tych zależności wraz z uzasadnieniem.",
      answers: [],
    });
  }

  if (items.length !== total) throw new Error("item count mismatch");
  return items;
}

const OPEN_ANSWERS = [
  "Dłuższy czas zatrzymania oznacza mniejszą siłę, bo zmiana pędu jest ta sama.",
  "Metal szybciej odbiera ciepło z palca, więc odczuwamy chłód.",
  "Nie wiem, ale chyba chodzi o energię.",
  "Pasy zwiększają czas zderzenia, więc siła jest mniejsza.",
];

async function main() {
  if (process.argv.includes("--help")) {
    console.log(HELP);
    return;
  }
  const options = parseArgs(process.argv.slice(2));

  const sql = new SQL(options.dbUrl);
  const runId = crypto.randomUUID().slice(0, 8);
  const org = { id: crypto.randomUUID(), name: `${options.orgName} ${runId}` };
  const group = { id: crypto.randomUUID(), name: "8A" };
  const teacher = {
    id: crypto.randomUUID(),
    email: `teacher.${runId}@${options.emailDomain}`,
    type: "educator",
    name: "Demo teacher",
  };
  const students = Array.from({ length: options.students }, (_, index) => ({
    id: crypto.randomUUID(),
    email: `student.${String(index + 1).padStart(2, "0")}.${runId}@${options.emailDomain}`,
    type: "student",
    name: `Student ${String(index + 1).padStart(2, "0")}`,
  }));
  const accounts = [teacher, ...students];

  const hash = (
    await sql`SELECT crypt(${options.password}, gen_salt('bf', 10)) AS hash`
  )[0]!.hash;

  await sql`INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change_token_new, email_change
    )
    SELECT '00000000-0000-0000-0000-000000000000', r.id, 'authenticated', 'authenticated',
           r.email, ${hash}, now(), now(), now(),
           jsonb_build_object('account_type', r.account_type),
           jsonb_build_object('name', r.name, 'email_verified', true, 'account_type', r.account_type),
           '', '', '', ''
    FROM unnest(${accounts.map((a) => a.id)}::uuid[], ${accounts.map((a) => a.email)}::text[],
                ${accounts.map((a) => a.type)}::text[], ${accounts.map((a) => a.name)}::text[])
      AS r(id, email, account_type, name)`;

  await sql`INSERT INTO auth.identities (
      provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    )
    SELECT u.id::text, u.id,
           jsonb_build_object('sub', u.id::text, 'email', u.email,
                              'email_verified', true, 'phone_verified', false),
           'email', now(), now(), now()
    FROM auth.users u WHERE u.id = ANY(${accounts.map((a) => a.id)}::uuid[])`;

  await sql`INSERT INTO public.organizations (id, name) VALUES (${org.id}, ${org.name})`;

  const roles =
    await sql`SELECT id, name FROM public.org_roles WHERE organization_id = ${org.id}`;
  const roleId = (name: string): string => {
    const row = roles.find((role: { name: string }) => role.name === name);
    if (!row)
      throw new Error(`organization trigger did not create the ${name} role`);
    return row.id as string;
  };

  await sql`INSERT INTO public.org_members (organization_id, user_id, org_role_id, joined_at)
    SELECT ${org.id}, r.id, r.role_id, now()
    FROM unnest(${accounts.map((a) => a.id)}::uuid[],
                ${[roleId("teacher"), ...students.map(() => roleId("member"))]}::uuid[]) AS r(id, role_id)`;

  await sql`INSERT INTO public.groups (id, organization_id, name, created_by)
    VALUES (${group.id}, ${org.id}, ${group.name}, ${teacher.id})`;

  await sql`INSERT INTO public.group_members (group_id, user_id, role)
    SELECT ${group.id}, r.id, r.role
    FROM unnest(${accounts.map((a) => a.id)}::uuid[],
                ${["teacher", ...students.map(() => "member")]}::text[]) AS r(id, role)`;

  await sql.close();

  // ---- app side -----------------------------------------------------------
  const teacherSession = await login(
    options.appUrl,
    teacher.email,
    options.password,
  );
  await call(teacherSession, "/api/v1/me/orgs/switch", {
    method: "POST",
    body: JSON.stringify({ orgId: org.id }),
  });

  const bank = await call<{ id: string }>(
    teacherSession,
    "/api/v1/questions/banks",
    {
      method: "POST",
      body: JSON.stringify({
        name: `${options.orgName} — bank ${runId}`,
        description: "Wygenerowany bank do testu rozkładu ocen.",
        visibility: "group",
        groupIds: [group.id],
      }),
    },
  );

  const items = buildItems(options);
  const correctByContent = new Map<string, string>();
  const questionIds: string[] = [];
  for (const item of items) {
    if (item.correct) correctByContent.set(item.content, item.correct);
    const created = await call<{ id: string }>(
      teacherSession,
      "/api/v1/questions",
      {
        method: "POST",
        body: JSON.stringify({
          bankId: bank.id,
          type: item.type,
          content: item.content,
          ...(item.explanation ? { explanation: item.explanation } : {}),
          ...(item.modelAnswer ? { modelAnswer: item.modelAnswer } : {}),
          answers: item.answers,
        }),
      },
    );
    questionIds.push(created.id);
  }

  const assignment = await call<{ id: string }>(
    teacherSession,
    "/api/v1/teacher/assignments",
    {
      method: "POST",
      body: JSON.stringify({
        title: `${options.orgName} — kartkówka (${options.sample ?? "cała pula"} z ${items.length}) ${runId}`,
        description: `Pula ${items.length}, próba ${options.sample ?? "cała pula"}, prób ${options.attempts}.`,
        showResults: true,
        maxAttempts: options.attempts,
        shuffleQuestions: true,
        shuffleAnswers: true,
      }),
    },
  );

  await call(
    teacherSession,
    `/api/v1/teacher/assignments/${assignment.id}/questions`,
    {
      method: "POST",
      body: JSON.stringify({ questionIds }),
    },
  );
  await call(
    teacherSession,
    `/api/v1/teacher/assignments/${assignment.id}/targets`,
    {
      method: "PUT",
      body: JSON.stringify({ groupIds: [group.id] }),
    },
  );
  if (options.sample !== null && options.sample < items.length) {
    await call(teacherSession, `/api/v1/teacher/assignments/${assignment.id}`, {
      method: "PUT",
      body: JSON.stringify({ attemptItemCount: options.sample }),
    });
  }
  await call(
    teacherSession,
    `/api/v1/teacher/assignments/${assignment.id}/publish`,
    {
      method: "POST",
      body: JSON.stringify({
        deadline: new Date(
          Date.now() + options.deadlineHours * 60 * 60 * 1000,
        ).toISOString(),
        acknowledgeExposure: true,
      }),
    },
  );

  // ---- simulated cohort ---------------------------------------------------
  const scores: number[] = [];
  const servedTypes = new Map<string, number>();
  for (const student of students) {
    const session = await login(
      options.appUrl,
      student.email,
      options.password,
    );
    const started = await call<{
      id: string;
      questions: Array<{
        id: string;
        content: string;
        type: string;
        question_answers: Array<{ id: string; content: string }>;
      }>;
    }>(session, `/api/v1/assignments/${assignment.id}/start`, {
      method: "POST",
      body: "{}",
    });

    const answers = started.questions.map((question) => {
      if (question.type === "open") {
        const text =
          OPEN_ANSWERS[Math.floor(Math.random() * OPEN_ANSWERS.length)]!;
        return { questionId: question.id, textAnswer: text };
      }
      const correct = correctByContent.get(question.content);
      const pickCorrect = Math.random() < options.accuracy;
      const option = pickCorrect
        ? question.question_answers.find(
            (candidate) => candidate.content === correct,
          )
        : question.question_answers.find(
            (candidate) => candidate.content !== correct,
          );
      return { questionId: question.id, selectedAnswerId: option!.id };
    });

    for (const question of started.questions) {
      servedTypes.set(question.type, (servedTypes.get(question.type) ?? 0) + 1);
    }

    const submitted = await call<{ score: number | null }>(
      session,
      `/api/v1/quiz/${started.id}`,
      {
        method: "POST",
        body: JSON.stringify({ attemptId: started.id, answers }),
      },
    );
    scores.push(submitted.score ?? 0);
  }

  const histogram = scores.reduce<Record<number, number>>((acc, score) => {
    acc[score] = (acc[score] ?? 0) + 1;
    return acc;
  }, {});

  console.log(
    JSON.stringify(
      {
        org: { id: org.id, name: org.name },
        group: { id: group.id, name: group.name },
        teacher: { email: teacher.email, password: options.password },
        students: {
          count: students.length,
          first: students[0]?.email,
          password: options.password,
        },
        bank: bank.id,
        assignment: assignment.id,
        pool: {
          total: items.length,
          mcq: options.mcq,
          open: options.open,
          tf: options.tf,
        },
        sample: options.sample,
        attempts: options.attempts,
        servedTypeCounts: Object.fromEntries(servedTypes),
        submissions: scores.length,
        average: Number(
          (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2),
        ),
        min: Math.min(...scores),
        max: Math.max(...scores),
        histogram,
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
