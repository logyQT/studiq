/**
 * Guard for R5 (ADR-0015 §7): no `allowedAccountTypes` on an org-resource API
 * route. Phase 2 (slices 2b-1…2b-8) removed every persona gate from the API
 * surface except four declared exceptions, each with a named owner:
 *
 * - `organization/route.ts` POST — org creation (R5's first exception; the
 *   persona check may become an `org.create` permission later).
 * - `teacher/classrooms/route.ts` POST — classroom creation (R5's second
 *   exception; the classroom is an org + an Admin membership, not a permission
 *   yet).
 * - `ai/chat/route.ts` POST — the `ai.chat` surface, deferred to phase 5
 *   (`requireEntitlement`).
 * - `ai/usage/route.ts` GET — the counter the chat route reports into; same
 *   phase-5 audience.
 *
 * This is a source scan, not a behavioural test: it fails before the database
 * is needed, and it fails in both directions — a **new** gate anywhere in the
 * API surface is reported, and a declared exception whose file or gate
 * disappears (a stale allowlist entry) is reported too. The server package is
 * scanned as well: controllers and services authorize from `ctx` permissions,
 * never from the account type, so a real `allowedAccountTypes` usage there is
 * a route-authority mechanism sneaking in below the route layer. A mention in
 * a comment or a string has no `: [` call shape and is not flagged.
 */

import fs from 'node:fs';
import path from 'node:path';
import { AccountType } from '@studiq/authz';
import { describe, expect, it } from 'vitest';

const API_V1_ROOT = path.join(process.cwd(), 'apps/web/src/app/(backend)/api/v1');
const SERVER_PACKAGE_ROOTS = [
  path.join(process.cwd(), 'packages/server/src/controllers'),
  path.join(process.cwd(), 'packages/server/src/services'),
];

/** `allowedAccountTypes: [AccountType.…]` — the call shape of a real gate. */
const GATE_PATTERN = /allowedAccountTypes\s*:\s*\[([^\]]*)\]/g;

type Gate = { file: string; line: number; types: string[] };

type DeclaredException = { file: string; types: string[]; reason: string };

/**
 * The complete allowlist. Adding an entry here is a phase decision: it must
 * name the phase that owns replacing the persona gate with a permission.
 */
const DECLARED_EXCEPTIONS: DeclaredException[] = [
  {
    file: 'apps/web/src/app/(backend)/api/v1/organization/route.ts',
    types: [AccountType.EDUCATOR, AccountType.MANAGER],
    reason: 'R5 exception: org creation (POST /api/v1/organization)',
  },
  {
    file: 'apps/web/src/app/(backend)/api/v1/teacher/classrooms/route.ts',
    types: [AccountType.EDUCATOR, AccountType.MANAGER],
    reason: 'R5 exception: classroom creation (POST /api/v1/teacher/classrooms)',
  },
  {
    file: 'apps/web/src/app/(backend)/api/v1/ai/chat/route.ts',
    types: [AccountType.STUDENT, AccountType.EDUCATOR],
    reason: 'phase 5: the ai.chat surface waits for requireEntitlement',
  },
  {
    file: 'apps/web/src/app/(backend)/api/v1/ai/usage/route.ts',
    types: [AccountType.STUDENT, AccountType.EDUCATOR],
    reason: 'phase 5: same audience as the ai/chat route it reports on',
  },
];

const REMEDY =
  'authorize with withAuth() + a permission from the catalog (can/check on ctx), ' +
  'or add a declared exception in DECLARED_EXCEPTIONS with a phase owner (R5, ADR-0015 §7)';

function relative(file: string): string {
  return path.relative(process.cwd(), file).split(path.sep).join('/');
}

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      files.push(...sourceFiles(target));
      continue;
    }
    if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) files.push(target);
  }
  return files;
}

function routeFiles(): string[] {
  return sourceFiles(API_V1_ROOT).filter((file) => path.basename(file) === 'route.ts');
}

/** Every `allowedAccountTypes: […]` occurrence in one source, with file and line. */
function gatesInSource(file: string, source: string): Gate[] {
  const gates: Gate[] = [];
  for (const match of source.matchAll(GATE_PATTERN)) {
    const names = [...(match[1] ?? '').matchAll(/AccountType\.(\w+)/g)].map((m) => m[1] ?? '');
    const types = names.map((name) => (AccountType as Record<string, string>)[name] ?? name);
    const line = source.slice(0, match.index).split('\n').length;
    gates.push({ file, line, types: types.toSorted() });
  }
  return gates;
}

function personaGates(): Gate[] {
  return routeFiles().flatMap((file) =>
    gatesInSource(relative(file), fs.readFileSync(file, 'utf8')),
  );
}

/**
 * Real `allowedAccountTypes: […]` usages in the server package. `GATE_PATTERN`
 * requires the `: [` call shape, so a mention in a comment or a string (no
 * call shape) is not a gate.
 */
function serverPackageGates(): Gate[] {
  return SERVER_PACKAGE_ROOTS.flatMap((root) =>
    sourceFiles(root).flatMap((file) =>
      gatesInSource(relative(file), fs.readFileSync(file, 'utf8')),
    ),
  );
}

function sameTypes(a: string[], b: string[]): boolean {
  return a.toSorted().join(',') === b.toSorted().join(',');
}

function formatGate(gate: Gate): string {
  return `${gate.file}:${gate.line} allows [${gate.types.join(', ')}]`;
}

describe('persona gates on the API surface (R5)', () => {
  it('walks the route files, including the four declared exceptions', () => {
    const routes = routeFiles().map(relative);
    expect(routes.length).toBeGreaterThan(50);
    for (const exception of DECLARED_EXCEPTIONS) {
      expect(routes).toContain(exception.file);
    }
  });

  it('carries exactly the four declared exceptions — no fifth gate, none removed', () => {
    const gates = personaGates();
    const declaredByFile = new Map(DECLARED_EXCEPTIONS.map((e) => [e.file, e]));

    const unexpected = gates
      .filter((gate) => {
        const declared = declaredByFile.get(gate.file);
        return !declared || !sameTypes(declared.types, gate.types);
      })
      .map((gate) => `${formatGate(gate)} — ${REMEDY}`);

    const missing = DECLARED_EXCEPTIONS.filter(
      (exception) => !gates.some((gate) => gate.file === exception.file),
    ).map(
      (exception) =>
        `${exception.file} is declared (${exception.reason}) but carries no allowedAccountTypes — remove or re-point the declaration`,
    );

    expect({ unexpected, missing }).toEqual({ unexpected: [], missing: [] });
  });

  it('every declared exception file still exists and still carries its declared gate', () => {
    const gates = personaGates();
    const problems = DECLARED_EXCEPTIONS.flatMap((exception) => {
      if (!fs.existsSync(path.join(process.cwd(), exception.file))) {
        return [`${exception.file} is declared (${exception.reason}) but the file does not exist`];
      }
      const found = gates.filter((gate) => gate.file === exception.file);
      if (found.length === 0) {
        return [
          `${exception.file} is declared (${exception.reason}) but no longer carries allowedAccountTypes — a stale allowlist entry`,
        ];
      }
      if (!sameTypes(found[0]?.types ?? [], exception.types)) {
        return [
          `${exception.file} declares [${exception.types.join(', ')}] (${exception.reason}) but the route allows [${(found[0]?.types ?? []).join(', ')}] — update the declaration with the reason`,
        ];
      }
      return [];
    });

    expect(problems, REMEDY).toEqual([]);
  });

  it('finds no route-authority persona gate in controllers or services', () => {
    const real = serverPackageGates();
    expect(
      real.map(
        (gate) =>
          `${formatGate(gate)} — controllers/services authorize from ctx permissions, not the account type; ${REMEDY}`,
      ),
      'a real allowedAccountTypes usage below the route layer decides authority without a declared exception',
    ).toEqual([]);
  });
});

describe('gatesInSource()', () => {
  it('parses the account types of a real gate', () => {
    const gates = gatesInSource(
      'x/route.ts',
      'withAuth(req, h, { allowedAccountTypes: [AccountType.STUDENT, AccountType.EDUCATOR] })',
    );
    expect(gates).toEqual([{ file: 'x/route.ts', line: 1, types: ['educator', 'student'] }]);
  });

  it('reports the line of a gate on a later line', () => {
    const source = 'line1\nline2\n  { allowedAccountTypes: [AccountType.MANAGER] },\n';
    expect(gatesInSource('x/route.ts', source)[0]?.line).toBe(3);
  });

  it('ignores a mention in a comment or a string — no call shape, no gate', () => {
    const source = [
      '// allowedAccountTypes is banned on org routes',
      "const note = 'allowedAccountTypes stays only on the four declared exceptions';",
      'export async function GET(req: NextRequest) { return withAuth(req, h); }',
    ].join('\n');
    expect(gatesInSource('x/route.ts', source)).toEqual([]);
  });

  it('reports a fifth gate a synthetic route would add', () => {
    const source = 'withAuth(req, h, { allowedAccountTypes: [AccountType.STUDENT] })';
    const gates = gatesInSource('apps/web/src/app/(backend)/api/v1/decks/route.ts', source);
    expect(gates.map(formatGate)).toEqual([
      'apps/web/src/app/(backend)/api/v1/decks/route.ts:1 allows [student]',
    ]);
  });
});
