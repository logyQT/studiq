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

/**
 * Element shots render the component at ≥ 700 CSS px on a wide layout and are
 * captured at 3×, so the page can show them at 350–700 CSS px without the
 * browser inventing pixels. Anything narrower than that is the soft-image
 * failure this gate exists to catch.
 */
const ELEMENT_SCALE = 3;
const ELEMENT_VIEWPORT = { width: 1800, height: 1200 };
const MIN_ELEMENT_CSS_WIDTH = 700;
const MAX_DISPLAY_WIDTH = 720;
/** Fractions of the frame the ink must cover, and where a shot may sit. */
const MAX_EMPTY_MARGIN = 0.08;
const RENDITION_WIDTHS = [720, 1440] as const;

type Theme = 'light' | 'dark';
const THEMES: Theme[] = ['light', 'dark'];

/**
 * Files whose change can change the captured pixels: the app components the
 * shots render, the demo seed, and this script.
 *
 * The landing-page components are deliberately absent — they consume these
 * images, they do not produce them, and a concurrent edit to them must not turn
 * the gate red for imagery it cannot affect.
 */
const WATCHED = [
  join(ROOT, 'apps/web/src/components/study'),
  join(ROOT, 'apps/web/src/components/stats'),
  join(ROOT, 'apps/web/src/components/questions'),
  join(ROOT, 'apps/web/src/components/assignments'),
  join(ROOT, 'apps/web/src/components/layout'),
  join(ROOT, 'apps/web/src/components/providers'),
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
  /** Completed practice attempt, for the results/feedback screen. */
  reviewAttempt: string;
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
    reviewAttempt: '42c9aed6-a381-41cd-8c41-d07e253c0b3b',
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
    reviewAttempt: 'f5d53072-7a9e-4803-868b-799c70a209b5',
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

/**
 * Element shots: the PNG *is* the component, so the page composes real UI
 * instead of a window with the product buried in it. `zoom` enlarges the
 * component's CSS box before measuring, which is what keeps the text sharp at
 * the sizes the landing page uses.
 */
interface ElementShot {
  name: string;
  persona: Persona;
  path: (locale: LocaleSpec) => string;
  /** One or more locators; more than one is unioned into a single clip. */
  locators: (page: Page) => Locator[];
  /** CSS zoom applied before measuring; raises a narrow component to ≥700 px. */
  zoom?: number;
  act?: (page: Page, locale: LocaleSpec) => Promise<void>;
  shows: Record<'en' | 'pl', string>;
}

const ELEMENT_SHOTS: ElementShot[] = [
  {
    name: 'card-front',
    persona: 'student',
    path: () => '/app/study/session/review?studyMode=endless',
    locators: (page) => [
      page.locator('fieldset').first(),
      page.locator('main p.text-center').first(),
    ],
    zoom: 1.05,
    shows: {
      en: 'The study card with a pharmacology question and the prompt to reveal the answer.',
      pl: 'Fiszka z pytaniem z farmakologii i prośbą o odkrycie odpowiedzi.',
    },
  },
  {
    name: 'card-rating',
    persona: 'student',
    path: () => '/app/study/session/review?studyMode=endless',
    locators: (page) => [page.locator('main div.grid.grid-cols-2.gap-2').last()],
    zoom: 1.6,
    act: async (page) => {
      await page.locator('fieldset').first().click();
      await page.waitForTimeout(900);
    },
    shows: {
      en: 'The four recall ratings under a revealed card: again, hard, good, easy.',
      pl: 'Cztery oceny powtórki pod odkrytą fiszką: nie pamiętam, trudne, dobrze, łatwe.',
    },
  },
  {
    name: 'quiz-question',
    persona: 'student',
    path: (locale) => `/app/study/session/quiz/${locale.quizAttempt}`,
    locators: (page) => [page.locator('main div.mx-auto.flex.max-w-3xl')],
    act: async (page) => {
      await page.locator('[role="radio"]').first().click();
      await page.waitForTimeout(1200);
    },
    shows: {
      en: 'A quiz question with four options, one selected, and the progress indicator.',
      pl: 'Pytanie testowe z czterema odpowiedziami, jedną zaznaczoną i wskaźnikiem postępu.',
    },
  },
  {
    name: 'quiz-feedback',
    persona: 'student',
    path: (locale) => `/app/study/session/quiz/${locale.reviewAttempt}/review`,
    locators: (page) => [page.locator('main div.flex.flex-col.gap-4 > div').first()],
    shows: {
      en: 'An answered question in the results view: the correct option marked and the explanation below.',
      pl: 'Odpowiedziane pytanie w wynikach: zaznaczona poprawna odpowiedź i wyjaśnienie pod spodem.',
    },
  },
  {
    name: 'stats-kpis',
    persona: 'student',
    path: () => '/app/stats/activity',
    locators: (page) => {
      const row = page.locator('main .grid').first();
      return [0, 1, 2, 3].map((index) => row.locator('> *').nth(index));
    },
    shows: {
      en: 'The weekly review counters: reviews, correct answers, cards due today, reviews and leeches.',
      pl: 'Liczniki tygodnia: powtórki, poprawne odpowiedzi, karty na dziś, powtórki i karty oporne.',
    },
  },
  {
    name: 'stats-chart',
    persona: 'student',
    path: () => '/app/stats/activity',
    locators: (page) => [page.locator('main [data-slot="card"]').first()],
    shows: {
      en: 'The daily activity chart: a week of reviews with correct answers beside them.',
      pl: 'Wykres aktywności dziennej: tydzień powtórek z poprawnymi odpowiedziami obok.',
    },
  },
  {
    name: 'builder-row',
    persona: 'educator',
    path: (locale) => `/edu/questions/${locale.bank}`,
    locators: (page) => [page.locator('main table tbody tr').first()],
    zoom: 1.5,
    shows: {
      en: 'One question in the educator bank: the stem with its type badge, topic, answer count and actions.',
      pl: 'Jedno pytanie w banku nauczyciela: treść z oznaczeniem typu, tematem, liczbą odpowiedzi i akcjami.',
    },
  },
  {
    name: 'assignment-list',
    persona: 'student',
    path: () => '/app/assignments',
    locators: (page) => [page.locator('main section').first()],
    zoom: 1.05,
    shows: {
      en: "The student's pending assignments with question counts, due dates and attempt state.",
      pl: 'Oczekujące kartkówki studentki: liczba pytań, termin i stan podejścia.',
    },
  },
  {
    name: 'seats-table',
    persona: 'manager',
    path: () => '/manage/seats',
    locators: (page) => [page.locator('main [data-slot="card"]').first()],
    shows: {
      en: 'Seat pools for the university: plan, purchased, assigned and available licences.',
      pl: 'Pule miejsc uczelni: plan, wykupione, przydzielone i dostępne licencje.',
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

const USAGE =
  'usage: bun run shots:capture [--locale en|pl] [--theme light|dark] [--only shot,shot] [--check]';

/* ------------------------------------------------------------------- args */

interface Options {
  locales: LocaleSpec[];
  themes: Theme[];
  /** Full-window shots (flat folders) and element shots (per theme). */
  wide: ShotSpec[];
  element: ElementShot[];
  check: boolean;
}

const ALL_NAMES = [...SHOTS.map((shot) => shot.name), ...ELEMENT_SHOTS.map((shot) => shot.name)];

function parseArgs(argv: string[]): Options {
  let locales = LOCALES;
  let themes = THEMES;
  let wide = SHOTS;
  let element = ELEMENT_SHOTS;
  let check = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--check') {
      check = true;
      continue;
    }
    if (arg === '--locale' || arg === '--only' || arg === '--theme') {
      const value = argv[index + 1];
      if (!value) usageError(`${arg} needs a value`);
      index += 1;
      if (arg === '--locale') {
        const match = LOCALES.filter((l) => l.locale === value);
        if (match.length === 0) usageError(`unknown locale "${value}" (en, pl)`);
        locales = match;
      } else if (arg === '--theme') {
        if (value !== 'light' && value !== 'dark') {
          usageError(`unknown theme "${value}" (light, dark)`);
        }
        themes = [value];
      } else {
        const names = value
          .split(',')
          .map((name) => name.trim())
          .filter(Boolean);
        const unknown = names.filter((name) => !ALL_NAMES.includes(name));
        if (unknown.length > 0) {
          usageError(`unknown shot(s): ${unknown.join(', ')} (${ALL_NAMES.join(', ')})`);
        }
        wide = SHOTS.filter((s) => names.includes(s.name));
        element = ELEMENT_SHOTS.filter((s) => names.includes(s.name));
      }
      continue;
    }
    usageError(`unknown argument "${arg}"`);
  }

  return { locales, themes, wide, element, check };
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
  mean: number;
  /** Share of the frame inside the bounding box of non-background pixels. */
  coverage: number;
  /** Empty band on each edge, as a fraction of that dimension. */
  margins: { left: number; top: number; right: number; bottom: number };
}

/** Dimensions, size, luminance, and how much of the frame the ink covers. */
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

  // The plate colour is the corner of the frame, not the most common colour:
  // a control strip whose own surface is nearly the page colour would otherwise
  // count as background and make a tight element look like an empty plate.
  const corner = (px: number, py: number) => {
    const i = py * stride + px * channels;
    return { r: pixels[i] ?? 0, g: pixels[i + 1] ?? 0, b: pixels[i + 2] ?? 0 };
  };
  const corners = [
    corner(1, 1),
    corner(width - 2, 1),
    corner(1, height - 2),
    corner(width - 2, height - 2),
  ];
  const bg = {
    r: corners.reduce((sum, c) => sum + c.r, 0) / corners.length,
    g: corners.reduce((sum, c) => sum + c.g, 0) / corners.length,
    b: corners.reduce((sum, c) => sum + c.b, 0) / corners.length,
  };

  // One pass for luminance, colour spread and the ink bounding box.
  const STEP = 4;
  let count = 0;
  let sum = 0;
  let sumSq = 0;
  const colors = new Set<string>();
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += STEP) {
    for (let x = 0; x < width; x += STEP) {
      const i = y * stride + x * channels;
      const r = pixels[i] ?? 0;
      const g = pixels[i + 1] ?? 0;
      const b = pixels[i + 2] ?? 0;
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sum += luma;
      sumSq += luma * luma;
      count += 1;
      colors.add(`${r >> 4},${g >> 4},${b >> 4}`);
      const distance = Math.abs(r - bg.r) + Math.abs(g - bg.g) + Math.abs(b - bg.b);
      if (distance <= 3) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  const margins =
    maxX < 0
      ? { left: 1, top: 1, right: 1, bottom: 1 }
      : {
          left: minX / width,
          top: minY / height,
          right: (width - maxX) / width,
          bottom: (height - maxY) / height,
        };
  const coverage = maxX < 0 ? 0 : ((maxX - minX + STEP) * (maxY - minY + STEP)) / (width * height);

  const mean = sum / count;
  return {
    width,
    height,
    bytes: buf.length,
    deviation: Math.sqrt(Math.max(sumSq / count - mean * mean, 0)),
    colors: colors.size,
    mean,
    coverage,
    margins,
  };
}

interface ImageExpectation {
  width: number;
  height: number;
  /** Playwright rounds an element box to device pixels; allow a few px drift. */
  tolerance?: number;
  /** Largest tolerated empty band on any edge, as a fraction of that dimension. */
  maxMargin?: number;
}

function assertImage(path: string, expected: ImageExpectation): PngStats {
  const stats = pngStats(path);
  const problems: string[] = [];
  const drift = expected.tolerance ?? 0;
  if (
    Math.abs(stats.width - expected.width) > drift ||
    Math.abs(stats.height - expected.height) > drift
  ) {
    problems.push(`${stats.width}×${stats.height}, expected ${expected.width}×${expected.height}`);
  }
  if (stats.bytes < MIN_BYTES)
    problems.push(`${Math.round(stats.bytes / 1024)} KB, expected > 40 KB`);
  if (stats.deviation < 8) problems.push('looks blank');
  if (stats.colors < 12) problems.push('too few colours for a populated screen');
  const maxMargin = expected.maxMargin;
  if (maxMargin !== undefined) {
    const worst = Math.max(...Object.values(stats.margins));
    if (worst > maxMargin) {
      const edges = Object.entries(stats.margins)
        .filter(([, value]) => value > maxMargin)
        .map(([edge, value]) => `${edge} ${(value * 100).toFixed(0)}%`);
      problems.push(
        `empty margin too large (${edges.join(', ')}), expected ≤ ${(maxMargin * 100).toFixed(0)}%`,
      );
    }
  }
  if (problems.length > 0) throw new Error(`${path}: ${problems.join('; ')}`);
  return stats;
}

/* ------------------------------------------------------------- renditions */

/** ImageMagick is present in this environment; a missing binary fails the run. */
function assertConvertAvailable(): void {
  const probe = Bun.spawnSync(['convert', '-version']);
  if (probe.exitCode !== 0) {
    throw new Error('shots: ImageMagick `convert` is required for the WebP renditions');
  }
}

/** 720/1440 WebP next to the PNG. Never upscales: a narrow source skips a width. */
function writeRenditions(pngPath: string, pngWidth: number): string[] {
  const written: string[] = [];
  for (const target of RENDITION_WIDTHS) {
    if (pngWidth < target) continue;
    const out = pngPath.replace(/\.png$/, `-${target}.webp`);
    const result = Bun.spawnSync([
      'convert',
      pngPath,
      '-resize',
      `${target}x`,
      '-quality',
      '82',
      '-strip',
      out,
    ]);
    if (result.exitCode !== 0) {
      throw new Error(
        `shots: convert failed for ${out}: ${new TextDecoder().decode(result.stderr).trim()}`,
      );
    }
    written.push(out);
  }
  return written;
}

/* ----------------------------------------------------------------- capture */

async function newSession(
  browser: Browser,
  locale: LocaleSpec,
  email: string,
  theme: Theme = 'light',
  viewport = { width: WIDTH, height: HEIGHT },
  scale = SCALE,
) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: scale,
    locale: locale.appLocale,
    colorScheme: theme,
  });
  await context.addCookies([{ name: 'NEXT_LOCALE', value: locale.locale, url: APP_URL }]);
  // next-themes reads localStorage before first paint (attribute="class"), so the
  // app's own choice is what decides the theme — not just prefers-color-scheme.
  await context.addInitScript((value: string) => {
    localStorage.setItem('theme', value);
    localStorage.setItem('next-theme', value);
  }, theme);
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

/** The theme is the app's, so assert the class the app sets rather than a media query. */
async function assertTheme(page: Page, theme: Theme): Promise<void> {
  const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  if (isDark !== (theme === 'dark')) {
    throw new Error(`shots: ${theme} theme did not apply (html.dark=${String(isDark)})`);
  }
}

/** Shots grouped by the persona whose session captures them. */
function byPersona<T extends { persona: Persona }>(shots: T[]): Map<Persona, T[]> {
  const grouped = new Map<Persona, T[]>();
  for (const shot of shots) {
    grouped.set(shot.persona, [...(grouped.get(shot.persona) ?? []), shot]);
  }
  return grouped;
}

async function settleShot(page: Page, anchor?: Locator): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => undefined);
  if (anchor) await anchor.first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(1200);
}

async function captureWide(browser: Browser, locale: LocaleSpec, shots: ShotSpec[]): Promise<void> {
  for (const [persona, list] of byPersona(shots)) {
    const email = locale[persona];
    const { page, close } = await newSession(browser, locale, email);
    try {
      for (const shot of list) {
        await page.goto(`${APP_URL}${shot.path(locale)}`, { waitUntil: 'domcontentloaded' });
        await settleShot(page, shot.anchor(page));
        await shot.act?.(page, locale);

        const dir = join(OUT_DIR, locale.locale);
        mkdirSync(dir, { recursive: true });
        const file = join(dir, `${shot.name}.png`);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(250);
        await page.screenshot({ path: file, animations: 'disabled' });

        try {
          assertImage(file, { width: WIDTH * SCALE, height: HEIGHT * SCALE });
        } catch (error) {
          rmSync(file, { force: true });
          throw error;
        }
        writeRenditions(file, WIDTH * SCALE);
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
            assertImage(detailFile, { width: width * SCALE, height: height * SCALE });
          } catch (error) {
            rmSync(detailFile, { force: true });
            throw error;
          }
          writeRenditions(detailFile, width * SCALE);
          console.log(`captured ${locale.locale}/${shot.name}-detail`);
        }
      }
    } finally {
      await close();
    }
  }
}

/**
 * Element shots, per theme: the PNG is the component itself, rendered at
 * ≥ 700 CSS px by a wide viewport plus a CSS zoom, and captured at 3×.
 */
async function captureElements(
  browser: Browser,
  locale: LocaleSpec,
  theme: Theme,
  shots: ElementShot[],
): Promise<void> {
  for (const [persona, list] of byPersona(shots)) {
    const email = locale[persona];
    const { page, close } = await newSession(
      browser,
      locale,
      email,
      theme,
      ELEMENT_VIEWPORT,
      ELEMENT_SCALE,
    );
    try {
      for (const shot of list) {
        await page.goto(`${APP_URL}${shot.path(locale)}`, { waitUntil: 'domcontentloaded' });
        await settleShot(page, shot.locators(page)[0]);
        await assertTheme(page, theme);
        if (shot.zoom && shot.zoom !== 1) {
          await page.addStyleTag({ content: `html { zoom: ${shot.zoom} }` });
          await page.waitForTimeout(400);
        }
        await shot.act?.(page, locale);
        await assertTheme(page, theme);

        const targets = shot.locators(page);
        const boxes = [];
        for (const target of targets) {
          const targetBox = await target.boundingBox();
          if (!targetBox)
            throw new Error(`${locale.locale}/${theme}/${shot.name}: no bounding box`);
          boxes.push(targetBox);
        }
        const box = {
          x: Math.min(...boxes.map((b) => b.x)),
          y: Math.min(...boxes.map((b) => b.y)),
          width: Math.max(...boxes.map((b) => b.x + b.width)) - Math.min(...boxes.map((b) => b.x)),
          height:
            Math.max(...boxes.map((b) => b.y + b.height)) - Math.min(...boxes.map((b) => b.y)),
        };
        if (box.width < MIN_ELEMENT_CSS_WIDTH) {
          throw new Error(
            `${locale.locale}/${theme}/${shot.name}: element renders ${Math.round(box.width)} CSS px wide, ` +
              `needs ≥ ${MIN_ELEMENT_CSS_WIDTH} (raise --zoom or the viewport)`,
          );
        }

        const dir = join(OUT_DIR, locale.locale, theme);
        mkdirSync(dir, { recursive: true });
        const file = join(dir, `${shot.name}.png`);
        if (targets.length === 1) {
          await targets[0]!.screenshot({ path: file, animations: 'disabled' });
        } else {
          await page.screenshot({
            path: file,
            clip: { x: box.x, y: box.y, width: box.width, height: box.height },
            animations: 'disabled',
          });
        }

        const expected = {
          width: Math.round(box.width * ELEMENT_SCALE),
          height: Math.round(box.height * ELEMENT_SCALE),
          tolerance: 4,
          maxMargin: MAX_EMPTY_MARGIN,
        };
        let stats;
        try {
          stats = assertImage(file, expected);
        } catch (error) {
          rmSync(file, { force: true });
          throw error;
        }
        if (stats.width < MAX_DISPLAY_WIDTH * 2) {
          rmSync(file, { force: true });
          throw new Error(
            `${locale.locale}/${theme}/${shot.name}: ${stats.width} px source, ` +
              `needs ≥ ${MAX_DISPLAY_WIDTH * 2} for a ${MAX_DISPLAY_WIDTH} px slot`,
          );
        }
        writeRenditions(file, stats.width);
        console.log(
          `captured ${locale.locale}/${theme}/${shot.name} (${Math.round(box.width)} CSS px → ${stats.width}×${stats.height})`,
        );
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
  theme?: Theme;
  /** Derived WebP renditions written beside this PNG. */
  renditions?: string[];
}

interface ExpectedAsset {
  locale: string;
  file: string;
  shows: string;
  variant?: 'detail';
  theme?: Theme;
}

/** Every asset the manifest describes: wide windows, their details, element sets. */
function expectedAssets(locales: LocaleSpec[]): ExpectedAsset[] {
  const assets: ExpectedAsset[] = [];
  for (const locale of locales) {
    for (const shot of SHOTS) {
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
          variant: 'detail',
        });
      }
    }
    for (const theme of THEMES) {
      for (const shot of ELEMENT_SHOTS) {
        assets.push({
          locale: locale.locale,
          theme,
          file: `${locale.locale}/${theme}/${shot.name}.png`,
          shows: shot.shows[locale.locale],
        });
      }
    }
  }
  return assets;
}

function writeManifest(locales: LocaleSpec[]): void {
  // A filtered run (`--locale`, `--only`, `--theme`) writes a manifest for what
  // exists on disk; `--check` still expects the whole matrix and names the gaps.
  const entries: ManifestEntry[] = expectedAssets(locales)
    .filter((asset) => existsSync(join(OUT_DIR, asset.file)))
    .map((asset) => {
      const stats = pngStats(join(OUT_DIR, asset.file));
      const renditions = RENDITION_WIDTHS.filter((width) => stats.width >= width).map((width) =>
        asset.file.replace(/\.png$/, `-${width}.webp`),
      );
      return {
        locale: asset.locale,
        file: asset.file,
        width: stats.width,
        height: stats.height,
        shows: asset.shows,
        ...(asset.variant ? { variant: asset.variant } : {}),
        ...(asset.theme ? { theme: asset.theme } : {}),
        renditions,
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
  const manifestPath = SHOTS_FILE;
  const problems: string[] = [];

  if (!existsSync(manifestPath)) {
    console.error(`shots --check: ${manifestPath} is missing. Run: bun run shots:capture`);
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ManifestEntry[];
  const sourceMtime = Math.max(...WATCHED.map(newestMtime));
  const expected = expectedAssets(LOCALES);

  for (const asset of expected) {
    const file = join(OUT_DIR, asset.file);
    const entry = manifest.find((item) => item.file === asset.file);
    if (!existsSync(file)) {
      problems.push(`${asset.file}: missing`);
      continue;
    }
    if (!entry) {
      problems.push(`${asset.file}: absent from shots.json`);
      continue;
    }
    if (entry.locale !== asset.locale || !entry.shows) {
      problems.push(`${asset.file}: shots.json entry is incomplete`);
    }
    if (asset.variant === 'detail' && entry.variant !== 'detail') {
      problems.push(`${asset.file}: shots.json entry is missing variant "detail"`);
    }
    if (asset.theme && entry.theme !== asset.theme) {
      problems.push(`${asset.file}: shots.json entry is missing theme "${asset.theme}"`);
    }

    const stats = pngStats(file);
    if (entry.width !== stats.width || entry.height !== stats.height) {
      problems.push(
        `${asset.file}: shots.json says ${entry.width}×${entry.height}, file is ${stats.width}×${stats.height}`,
      );
    }
    if (stats.bytes < MIN_BYTES) {
      problems.push(`${asset.file}: only ${Math.round(stats.bytes / 1024)} KB`);
    }
    if (asset.theme) {
      const worst = Math.max(...Object.values(stats.margins));
      if (worst > MAX_EMPTY_MARGIN) {
        problems.push(`${asset.file}: ${(worst * 100).toFixed(0)}% empty margin on one edge`);
      }
    }
    if (statSync(file).mtimeMs < sourceMtime) {
      problems.push(`${asset.file}: stale (older than the components, seed or this script)`);
    }

    // Renditions: derived, so they must exist and never predate their source.
    const pngMtime = statSync(file).mtimeMs;
    for (const width of RENDITION_WIDTHS) {
      if (stats.width < width) continue;
      const webp = join(OUT_DIR, asset.file.replace(/\.png$/, `-${width}.webp`));
      const relative = asset.file.replace(/\.png$/, `-${width}.webp`);
      if (!existsSync(webp)) {
        problems.push(`${relative}: missing`);
        continue;
      }
      if (statSync(webp).size === 0) problems.push(`${relative}: empty`);
      if (statSync(webp).mtimeMs < pngMtime) problems.push(`${relative}: older than its PNG`);
    }
  }

  // The theme must actually change pixels: a byte-identical pair means the app
  // never switched, which is the silent failure this guards against.
  for (const locale of LOCALES) {
    for (const shot of ELEMENT_SHOTS) {
      const light = join(OUT_DIR, locale.locale, 'light', `${shot.name}.png`);
      const dark = join(OUT_DIR, locale.locale, 'dark', `${shot.name}.png`);
      if (!existsSync(light) || !existsSync(dark)) continue;
      if (readFileSync(light).equals(readFileSync(dark))) {
        problems.push(`${locale.locale}/dark/${shot.name}.png: identical to the light capture`);
      } else {
        const lightMean = pngStats(light).mean;
        const darkMean = pngStats(dark).mean;
        if (darkMean >= lightMean - 20) {
          problems.push(
            `${locale.locale}/dark/${shot.name}.png: not darker than light (${darkMean.toFixed(0)} vs ${lightMean.toFixed(0)})`,
          );
        }
      }
    }
  }

  const expectedFiles = new Set(expected.map((asset) => asset.file));
  for (const entry of manifest) {
    if (!expectedFiles.has(entry.file)) problems.push(`shots.json: unexpected entry ${entry.file}`);
  }

  if (problems.length > 0) {
    console.error(`shots --check: ${problems.length} problem(s)`);
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error('Regenerate: bun run shots:capture');
    process.exit(1);
  }
  console.log(`shots --check: ${expected.length} assets and their renditions are current`);
}

/* -------------------------------------------------------------------- main */

const options = parseArgs(process.argv.slice(2));

if (options.check) {
  runCheck();
  process.exit(0);
}

await assertAppUp();
await assertTenantsSeeded();
assertConvertAvailable();

const browser = await chromium.launch();
try {
  for (const locale of options.locales) {
    await captureWide(browser, locale, options.wide);
    for (const theme of options.themes) {
      await captureElements(browser, locale, theme, options.element);
    }
  }
} finally {
  await browser.close();
}

writeManifest(LOCALES);
