/**
 * Marketing screenshot capture — the landing page's product imagery.
 *
 * Produces `apps/web/public/marketing/{locale}/{shot}.png` plus `shots.json`
 * from the running app and the demo tenants, so the imagery can be regenerated
 * whenever the UI changes instead of drifting into a stale, hand-curated set.
 *
 *   bun run shots:capture                      # every locale, every shot
 *   bun run shots:capture --locale pl          # one locale
 *   bun run shots:capture --only practice-session,quiz-builder
 *   bun run shots:capture --check              # verify the committed assets
 *
 * Why this is not part of `next build` or CI: it needs a running web server and
 * the seeded demo tenants, so it belongs to a deliberate release step. `--check`
 * is the cheap gate for anything automatic — it never starts a browser and
 * never writes a file.
 *
 * `--check` fails when an asset is missing, when `shots.json` disagrees with
 * the files on disk, or when an asset is older than the last change to the
 * marketing components, the demo seed SQL or this script. Staleness is mtime
 * based (no git calls), so a rebuild of the UI is what makes it red.
 *
 * Preconditions are checked before any browser opens: the app must answer on
 * :3001 and both demo tenants must exist with content. A failure prints the
 * exact command that fixes it — capturing a login screen or an empty state is
 * the failure mode this exists to prevent.
 *
 * Capture spec: 1440×900 at deviceScaleFactor 2 (16:10, retina), light theme,
 * `NEXT_LOCALE` matching the locale, the app content only, carets and
 * scrollbars hidden. Every image is verified after it is written (dimensions,
 * > 40 KB, real pixel variance); a bad shot fails the run and is deleted.
 */
import { resolveDbUrl } from './seed/cli';
import { chromium, type Browser, type Locator, type Page } from '@playwright/test';
import { SQL } from 'bun';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

const ROOT = join(import.meta.dir, '..');
const APP_URL = process.env.APP_URL ?? 'http://localhost:3001';
const OUT_DIR = join(ROOT, 'apps/web/public/marketing');
const SHOTS_FILE = join(OUT_DIR, 'shots.json');

const MIN_BYTES = 40 * 1024;
const WIDTH = 1440;
const HEIGHT = 900;
const SCALE = 2;

/** Files whose change makes the committed imagery stale. */
const WATCHED = [
  join(ROOT, 'apps/web/src/components/marketing'),
  join(ROOT, 'supabase/seeds/demo/demo-en.sql'),
  join(ROOT, 'supabase/seeds/demo/demo-pl.sql'),
  join(ROOT, 'scripts/marketing-shots.ts'),
];

type Persona = 'student' | 'educator' | 'manager';

interface LocaleSpec {
  locale: 'en' | 'pl';
  appLocale: string;
  student: string;
  educator: string;
  manager: string;
  quizAttempt: string;
  bank: string;
  goodButton: string;
}

const LOCALES: LocaleSpec[] = [
  {
    locale: 'en',
    appLocale: 'en-GB',
    student: 'alice.jones@example.edu',
    educator: 'emily.carter@example.edu',
    manager: 'michael.brown@example.edu',
    quizAttempt: 'd0000000-0000-4000-800b-000000000001',
    bank: 'd0000000-0000-4000-8020-000000000001',
    goodButton: 'Good',
  },
  {
    locale: 'pl',
    appLocale: 'pl-PL',
    student: 'zofia.nowak@example.edu',
    educator: 'anna.kowalska@example.edu',
    manager: 'marek.wisniewski@example.edu',
    quizAttempt: 'e0000000-0000-4000-800b-000000000001',
    bank: 'e0000000-0000-4000-8020-000000000001',
    goodButton: 'Dobrze',
  },
];

interface ShotSpec {
  name: string;
  persona: Persona;
  path: (locale: LocaleSpec) => string;
  /** Element that proves real, populated content is on screen. */
  anchor: (page: Page) => Locator;
  /** Extra interaction before the shutter (a real product flow, never a mock). */
  act?: (page: Page, locale: LocaleSpec) => Promise<void>;
  shows: Record<'en' | 'pl', string>;
  /**
   * Detail variant: a 4:3 region around `anchor`, offset by `dx`/`dy`, at
   * roughly 720 CSS px wide. At the 440 px the landing page renders it, UI text
   * lands near 10 px — readable, where the full window would be ~3 px.
   */
  detail?: {
    anchor: (page: Page) => Locator;
    dx: number;
    dy: number;
    width: number;
    height: number;
    shows: Record<'en' | 'pl', string>;
  };
}

const SHOTS: ShotSpec[] = [
  {
    name: 'practice-session',
    persona: 'student',
    path: () => '/app/study/session/review?studyMode=endless',
    anchor: (page) => page.locator('fieldset').first(),
    act: async (page, locale) => {
      // Reveal the answer and rate one card, so the shot shows a session in
      // progress rather than its first, still unrated step.
      await page.locator('fieldset').first().click();
      await page.waitForTimeout(900);
      await page.getByRole('button', { name: locale.goodButton }).first().click();
      await page.locator('fieldset').first().waitFor({ state: 'visible' });
      await page.waitForTimeout(1800);
    },
    shows: {
      en: 'A spaced-repetition review session: Alice Jones rates a pharmacology card she has just recalled.',
      pl: 'Sesja powtórek: Zofia Nowak ocenia fiszkę z farmakologii, którą właśnie przypomniała sobie.',
    },
    detail: {
      anchor: (page) => page.locator('fieldset').first(),
      dx: -28,
      dy: -12,
      width: 800,
      height: 600,
      shows: {
        en: 'The card face with the reveal prompt and the four recall ratings.',
        pl: 'Fiszka z prośbą o odkrycie odpowiedzi i czterema ocenami powtórki.',
      },
    },
  },
  {
    name: 'quiz-taking',
    persona: 'student',
    path: (locale) => `/app/study/session/quiz/${locale.quizAttempt}`,
    anchor: (page) => page.locator('[role="radio"]').first(),
    act: async (page) => {
      await page.locator('[role="radio"]').first().click();
      await page.waitForTimeout(1400); // draft autosave debounce
    },
    shows: {
      en: 'A practice quiz in progress: one multiple-choice question answered, seven still ahead.',
      pl: 'Kartkówka w trakcie rozwiązywania: jedno pytanie zamknięte odpowiedziane, siedem przed studentką.',
    },
    detail: {
      anchor: (page) => page.locator('[role="radiogroup"]').first(),
      dx: -50,
      dy: -108,
      width: 820,
      height: 520,
      shows: {
        en: 'One quiz question with its four answer options and the next control.',
        pl: 'Jedno pytanie testowe z czterema odpowiedziami i przyciskiem przejścia dalej.',
      },
    },
  },
  {
    name: 'student-stats',
    persona: 'student',
    path: () => '/app/stats/activity',
    anchor: (page) => page.locator('svg').first(),
    act: async (page) => {
      await page.waitForTimeout(1500); // charts animate in
    },
    shows: {
      en: "The student's activity dashboard: a week of reviews, a retention breakdown and the weakest decks.",
      pl: 'Panel aktywności studentki: tydzień powtórek, rozkład stanów kart i najsłabsze talie.',
    },
    detail: {
      anchor: (page) => page.locator('h1').first(),
      dx: 0,
      dy: 62,
      width: 800,
      height: 600,
      shows: {
        en: 'Review counts for the week, the correct share and the daily activity chart.',
        pl: 'Liczba powtórek w tygodniu, odsetek poprawnych i wykres aktywności dziennej.',
      },
    },
  },
  {
    name: 'quiz-builder',
    persona: 'educator',
    path: (locale) => `/edu/questions/${locale.bank}`,
    anchor: (page) => page.locator('table tbody tr').first(),
    shows: {
      en: 'The educator question bank: exam items with type, topic and answer counts, ready to be assembled into a quiz.',
      pl: 'Bank pytań nauczyciela: pozycje egzaminacyjne z typem, tematem i liczbą odpowiedzi, gotowe do złożenia w test.',
    },
    detail: {
      anchor: (page) => page.locator('table').first(),
      dx: -14,
      dy: -12,
      width: 780,
      height: 520,
      shows: {
        en: 'Question rows with their type badges and topic labels.',
        pl: 'Pozycje pytań z oznaczeniami typu i tematami.',
      },
    },
  },
  {
    name: 'manage-seats',
    persona: 'manager',
    path: () => '/manage/seats',
    anchor: (page) => page.locator('table tbody tr').first(),
    shows: {
      en: 'Seat pools for the university: how many licences each plan holds, who holds them and what is left.',
      pl: 'Pule miejsc uczelni: ile licencji obejmuje każdy plan, kto je zajmuje i ile zostało.',
    },
    detail: {
      anchor: (page) => page.locator('table').first(),
      dx: -14,
      dy: -112,
      width: 880,
      height: 560,
      shows: {
        en: 'Seat usage per plan, with the assigned licences and the first holders.',
        pl: 'Wykorzystanie miejsc w podziale na plany, z przydziałami i pierwszymi osobami.',
      },
    },
  },
  {
    name: 'manage-members',
    persona: 'manager',
    path: () => '/manage/members',
    anchor: (page) => page.locator('table tbody tr').nth(7),
    shows: {
      en: 'The member roster: eleven people with their roles, groups and join dates.',
      pl: 'Lista członków: jedenaście osób z rolami, grupami i datami dołączenia.',
    },
    detail: {
      anchor: (page) => page.locator('table').first(),
      dx: -14,
      dy: -14,
      width: 800,
      height: 600,
      shows: {
        en: 'Member rows with names, roles, groups and join dates.',
        pl: 'Wiersze członków z imieniem, rolą, grupami i datą dołączenia.',
      },
    },
  },
];

const HIDE_CHROME = `
  *, *::before, *::after {
    caret-color: transparent !important;
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
  }
  ::-webkit-scrollbar { display: none !important; }
`;

const USAGE = 'usage: bun run shots:capture [--locale en|pl] [--only shot,shot] [--check]';

/* ------------------------------------------------------------------- args */

interface Options {
  locales: LocaleSpec[];
  shots: ShotSpec[];
  check: boolean;
}

function parseArgs(argv: string[]): Options {
  let locales = LOCALES;
  let shots = SHOTS;
  let check = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--check') {
      check = true;
      continue;
    }
    if (arg === '--locale' || arg === '--only') {
      const value = argv[index + 1];
      if (!value) usageError(`${arg} needs a value`);
      index += 1;
      if (arg === '--locale') {
        const match = LOCALES.filter((l) => l.locale === value);
        if (match.length === 0) usageError(`unknown locale "${value}" (en, pl)`);
        locales = match;
      } else {
        const names = value
          .split(',')
          .map((name) => name.trim())
          .filter(Boolean);
        const unknown = names.filter((name) => !SHOTS.some((s) => s.name === name));
        if (unknown.length > 0) {
          usageError(
            `unknown shot(s): ${unknown.join(', ')} (${SHOTS.map((s) => s.name).join(', ')})`,
          );
        }
        shots = SHOTS.filter((s) => names.includes(s.name));
      }
      continue;
    }
    usageError(`unknown argument "${arg}"`);
  }

  return { locales, shots, check };
}

function usageError(message: string): never {
  console.error(`${message}\n${USAGE}`);
  process.exit(2);
}

/* ----------------------------------------------------------- preconditions */

async function assertAppUp(): Promise<void> {
  const url = `${APP_URL}/api/v1/health`;
  let status = 0;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    status = res.status;
  } catch {
    status = 0;
  }
  if (status !== 200) {
    console.error(
      `shots: the app is not answering on ${APP_URL} (GET /api/v1/health → ${status || 'no response'}).\n` +
        'Start it first:  bun run env:ensure --profile web',
    );
    process.exit(1);
  }
}

async function assertTenantsSeeded(): Promise<void> {
  const dbUrl = await resolveDbUrl(ROOT);
  if (!dbUrl) {
    console.error(
      'shots: cannot reach the database. Start the stack:  bun run env:ensure --profile web',
    );
    process.exit(1);
  }
  const sql = new SQL(dbUrl, { max: 1 });
  try {
    const rows = (await sql`
      SELECT o.name,
             (SELECT count(*) FROM public.flashcard_decks d WHERE d.organization_id = o.id)::int AS decks,
             (SELECT count(*) FROM public.questions q WHERE q.organization_id = o.id)::int AS questions,
             (SELECT count(*) FROM public.org_members m WHERE m.organization_id = o.id)::int AS members
      FROM public.organizations o
      WHERE o.name IN ('Northfield University', 'Uniwersytet Medyczny w Krakowie')
    `) as { name: string; decks: number; questions: number; members: number }[];
    const missing = ['Northfield University', 'Uniwersytet Medyczny w Krakowie'].filter(
      (name) => !rows.some((row) => row.name === name),
    );
    const empty = rows.filter((row) => row.decks === 0 || row.questions === 0 || row.members === 0);
    if (missing.length > 0 || empty.length > 0) {
      const detail =
        missing.length > 0
          ? `missing: ${missing.join(', ')}`
          : `empty: ${empty.map((r) => r.name).join(', ')}`;
      console.error(
        `shots: demo tenants are not seeded (${detail}).\nSeed them first:  bun scripts/demo-seed.ts`,
      );
      process.exit(1);
    }
  } finally {
    await sql.close();
  }
}

/* -------------------------------------------------------------- png checks */

interface PngStats {
  width: number;
  height: number;
  bytes: number;
  deviation: number;
  colors: number;
}

/** Dimensions, size and a luminance deviation, decoded with node:zlib only. */
function pngStats(file: string): PngStats {
  const buf = readFileSync(file);
  let pos = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  while (pos + 8 <= buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9] ?? 0;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') break;
    pos += 12 + length;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (channels === 0) throw new Error(`${file}: unexpected PNG colour type ${colorType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)] ?? 0;
    const rowStart = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? (pixels[dst + x - channels] ?? 0) : 0;
      const b = y > 0 ? (pixels[dst - stride + x] ?? 0) : 0;
      const c = y > 0 && x >= channels ? (pixels[dst - stride + x - channels] ?? 0) : 0;
      let value = (raw[rowStart + x] ?? 0) as number;
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      pixels[dst + x] = value & 0xff;
    }
  }

  let count = 0;
  let sum = 0;
  let sumSq = 0;
  const colors = new Set<string>();
  for (let y = 0; y < height; y += 7) {
    for (let x = 0; x < width; x += 7) {
      const i = y * stride + x * channels;
      const r = pixels[i] ?? 0;
      const g = pixels[i + 1] ?? 0;
      const b = pixels[i + 2] ?? 0;
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sum += luma;
      sumSq += luma * luma;
      count += 1;
      colors.add(`${r >> 4},${g >> 4},${b >> 4}`);
    }
  }
  const mean = sum / count;
  return {
    width,
    height,
    bytes: buf.length,
    deviation: Math.sqrt(Math.max(sumSq / count - mean * mean, 0)),
    colors: colors.size,
  };
}

function assertImage(
  path: string,
  expectedWidth = WIDTH * SCALE,
  expectedHeight = HEIGHT * SCALE,
): void {
  const stats = pngStats(path);
  const problems: string[] = [];
  if (stats.width !== expectedWidth || stats.height !== expectedHeight) {
    problems.push(`${stats.width}×${stats.height}, expected ${expectedWidth}×${expectedHeight}`);
  }
  if (stats.bytes < MIN_BYTES)
    problems.push(`${Math.round(stats.bytes / 1024)} KB, expected > 40 KB`);
  if (stats.deviation < 8) problems.push('looks blank');
  if (stats.colors < 12) problems.push('too few colours for a populated screen');
  if (problems.length > 0) throw new Error(`${path}: ${problems.join('; ')}`);
}

/* ----------------------------------------------------------------- capture */

async function newSession(browser: Browser, locale: LocaleSpec, email: string) {
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: SCALE,
    locale: locale.appLocale,
    colorScheme: 'light',
  });
  await context.addCookies([{ name: 'NEXT_LOCALE', value: locale.locale, url: APP_URL }]);
  await context.addInitScript(() => localStorage.setItem('theme', 'light'));
  const page = await context.newPage();
  // Drive the real form: the capture exercises the same path a user does.
  await page.goto(`${APP_URL}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('#email', email);
  await page.fill('#password', 'Seed4Test!');
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 });
  await page.addStyleTag({ content: HIDE_CHROME });
  return { page, close: () => context.close() };
}

async function captureLocale(
  browser: Browser,
  locale: LocaleSpec,
  shots: ShotSpec[],
): Promise<void> {
  const byPersona = new Map<Persona, ShotSpec[]>();
  for (const shot of shots)
    byPersona.set(shot.persona, [...(byPersona.get(shot.persona) ?? []), shot]);

  for (const [persona, list] of byPersona) {
    const email = locale[persona];
    const { page, close } = await newSession(browser, locale, email);
    try {
      for (const shot of list) {
        await page.goto(`${APP_URL}${shot.path(locale)}`, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => undefined);
        await shot.anchor(page).waitFor({ state: 'visible', timeout: 15_000 });
        await page.waitForTimeout(1200);
        await shot.act?.(page, locale);

        const dir = join(OUT_DIR, locale.locale);
        mkdirSync(dir, { recursive: true });
        const file = join(dir, `${shot.name}.png`);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(250);
        await page.screenshot({ path: file, animations: 'disabled' });

        try {
          assertImage(file);
        } catch (error) {
          rmSync(file, { force: true });
          throw error;
        }
        console.log(`captured ${locale.locale}/${shot.name}`);

        if (shot.detail) {
          const detailFile = join(dir, `${shot.name}-detail.png`);
          const box = await shot.detail.anchor(page).boundingBox();
          if (!box) throw new Error(`${locale.locale}/${shot.name}: detail anchor has no box`);
          const width = shot.detail.width;
          const height = shot.detail.height;
          const x = Math.max(0, Math.min(box.x + shot.detail.dx, WIDTH - width));
          const y = Math.max(0, Math.min(box.y + shot.detail.dy, HEIGHT - height));
          await page.screenshot({
            path: detailFile,
            clip: { x, y, width, height },
            animations: 'disabled',
          });
          try {
            assertImage(detailFile, width * SCALE, height * SCALE);
          } catch (error) {
            rmSync(detailFile, { force: true });
            throw error;
          }
          console.log(`captured ${locale.locale}/${shot.name}-detail`);
        }
      }
    } finally {
      await close();
    }
  }
}

/* -------------------------------------------------------------- shots.json */

interface ManifestEntry {
  locale: string;
  file: string;
  width: number;
  height: number;
  shows: string;
  variant?: 'detail';
}

/** Every asset the manifest describes: the wide window and its detail crop. */
function expectedAssets(
  locales: LocaleSpec[],
  shots: ShotSpec[],
): {
  locale: string;
  file: string;
  shows: string;
  variant?: 'detail';
}[] {
  const assets = [];
  for (const locale of locales) {
    for (const shot of shots) {
      assets.push({
        locale: locale.locale,
        file: `${locale.locale}/${shot.name}.png`,
        shows: shot.shows[locale.locale],
      });
      if (shot.detail) {
        assets.push({
          locale: locale.locale,
          file: `${locale.locale}/${shot.name}-detail.png`,
          shows: shot.detail.shows[locale.locale],
          variant: 'detail' as const,
        });
      }
    }
  }
  return assets;
}

function writeManifest(locales: LocaleSpec[], shots: ShotSpec[]): void {
  const entries: ManifestEntry[] = expectedAssets(locales, shots).map((asset) => {
    const stats = pngStats(join(OUT_DIR, asset.file));
    return {
      locale: asset.locale,
      file: asset.file,
      width: stats.width,
      height: stats.height,
      shows: asset.shows,
      ...(asset.variant ? { variant: asset.variant } : {}),
    };
  });
  writeFileSync(SHOTS_FILE, `${JSON.stringify(entries, null, 2)}\n`);
  console.log(`wrote ${SHOTS_FILE} (${entries.length} entries)`);
}

/* ------------------------------------------------------------------- check */

function newestMtime(path: string): number {
  if (!existsSync(path)) return 0;
  const stats = statSync(path);
  if (!stats.isDirectory()) return stats.mtimeMs;
  let newest = stats.mtimeMs;
  for (const entry of readdirSync(path)) newest = Math.max(newest, newestMtime(join(path, entry)));
  return newest;
}

function runCheck(): void {
  if (!existsSync(SHOTS_FILE)) {
    console.error(`shots --check: ${SHOTS_FILE} is missing. Run: bun run shots:capture`);
    process.exit(1);
  }

  const manifest = JSON.parse(readFileSync(SHOTS_FILE, 'utf8')) as ManifestEntry[];
  const problems: string[] = [];
  const sourceMtime = Math.max(...WATCHED.map(newestMtime));

  for (const asset of expectedAssets(LOCALES, SHOTS)) {
    {
      const relative = asset.file;
      const file = join(OUT_DIR, relative);
      const entry = manifest.find((item) => item.file === relative);
      if (!existsSync(file)) {
        problems.push(`${relative}: missing`);
        continue;
      }
      if (!entry) {
        problems.push(`${relative}: absent from shots.json`);
        continue;
      }
      if (entry.locale !== asset.locale || !entry.shows) {
        problems.push(`${relative}: shots.json entry is incomplete`);
      }
      if (asset.variant === 'detail' && entry.variant !== 'detail') {
        problems.push(`${relative}: shots.json entry is missing variant "detail"`);
      }
      const stats = pngStats(file);
      if (entry.width !== stats.width || entry.height !== stats.height) {
        problems.push(
          `${relative}: shots.json says ${entry.width}×${entry.height}, file is ${stats.width}×${stats.height}`,
        );
      }
      if (stats.bytes < MIN_BYTES)
        problems.push(`${relative}: only ${Math.round(stats.bytes / 1024)} KB`);
      if (statSync(file).mtimeMs < sourceMtime) {
        problems.push(`${relative}: stale (older than the marketing components or the demo seed)`);
      }
    }
  }

  const expected = new Set(expectedAssets(LOCALES, SHOTS).map((asset) => asset.file));
  for (const entry of manifest) {
    if (!expected.has(entry.file)) problems.push(`shots.json: unexpected entry ${entry.file}`);
  }

  if (problems.length > 0) {
    console.error(`shots --check: ${problems.length} problem(s)`);
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error('Regenerate: bun run shots:capture');
    process.exit(1);
  }
  console.log(`shots --check: ${expected.size} assets are present and current`);
}

/* -------------------------------------------------------------------- main */

const options = parseArgs(process.argv.slice(2));

if (options.check) {
  runCheck();
  process.exit(0);
}

await assertAppUp();
await assertTenantsSeeded();

const browser = await chromium.launch();
try {
  for (const locale of options.locales) {
    await captureLocale(browser, locale, options.shots);
  }
} finally {
  await browser.close();
}

// The manifest describes every locale and shot, not just the ones captured now.
writeManifest(LOCALES, SHOTS);
