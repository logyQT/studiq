#!/usr/bin/env bun
/**
 * Migrate authz-related imports from @/ paths to @studiq/authz package.
 * Handles multi-line imports correctly.
 */

import { readFileSync, writeFileSync } from 'fs';
import { globSync } from 'glob';
import { relative } from 'path';

const ROOT = '/workspaces/studiq/.worktrees/feat/monorepo-scaffold';

const TARGET_MODULES = new Set(['@/lib/permissions', '@/types', '@/lib/request-context']);

const FEATURE_EXPORTS = new Set([
  'FEATURES',
  'FeatureKey',
  'isFeatureKey',
  'rolloutBucket',
  'FeatureResolution',
  'ADMIN_ONLY_FEATURES',
]);

const files = [
  ...globSync(`${ROOT}/src/**/*.{ts,tsx}`, {
    ignore: ['**/node_modules/**', '**/.next/**', '**/packages/**'],
  }),
  ...globSync(`${ROOT}/__tests__/**/*.{ts,tsx}`, { ignore: ['**/node_modules/**'] }),
];

let totalChanged = 0;

for (const filePath of files) {
  let content = readFileSync(filePath, 'utf-8');
  const original = content;

  const lines = content.split('\n');
  const importsToRemove: Set<number> = new Set();
  const authzSymbols: string[] = [];
  let hasNonType = false;

  // Parse imports line by line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Single-line import
    const singleMatch = line.match(/^import\s+(type\s+)?\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?$/);
    if (singleMatch) {
      const isType = !!singleMatch[1];
      const symbols = singleMatch[2].trim();
      const mod = singleMatch[3];
      const isTarget =
        TARGET_MODULES.has(mod) ||
        (mod === '@/server/services/feature.resolver' &&
          symbols.split(',').some((s) => FEATURE_EXPORTS.has(s.trim())));
      if (isTarget) {
        importsToRemove.add(i);
        for (const s of symbols.split(',')) {
          const t = s.trim();
          if (t) authzSymbols.push(t);
        }
        if (!isType) hasNonType = true;
      }
      continue;
    }

    // Multi-line import start: `import type {` or `import {` (no `} from` on same line)
    const multiMatch = line.match(/^import\s+(type\s+)?\{([^}]*)$/);
    if (multiMatch && !line.includes('} from')) {
      const isType = !!multiMatch[1];
      let symbols = multiMatch[2].trim();
      let endLine = i;

      for (let j = i + 1; j < lines.length; j++) {
        const closingMatch = lines[j].match(/^([^}]*)\}\s+from\s+['"]([^'"]+)['"];?$/);
        if (closingMatch) {
          symbols += ', ' + closingMatch[1].trim();
          endLine = j;
          const mod = closingMatch[2];
          const isTarget =
            TARGET_MODULES.has(mod) ||
            (mod === '@/server/services/feature.resolver' &&
              symbols.split(',').some((s) => FEATURE_EXPORTS.has(s.trim())));
          if (isTarget) {
            for (let k = i; k <= endLine; k++) importsToRemove.add(k);
            for (const s of symbols.split(',')) {
              const t = s.trim();
              if (t) authzSymbols.push(t);
            }
            if (!isType) hasNonType = true;
          }
          break;
        }
        symbols += ', ' + lines[j].trim();
      }
    }
  }

  if (authzSymbols.length === 0) continue;

  // Remove old import lines
  const newLines = lines.filter((_, i) => !importsToRemove.has(i));

  // Build new import
  const newImport = hasNonType
    ? `import { ${authzSymbols.join(', ')} } from '@studiq/authz';`
    : `import type { ${authzSymbols.join(', ')} } from '@studiq/authz';`;

  // Find the LAST top-level import line index (not inside multi-line)
  let lastImportEnd = -1;
  let inMultiLine = false;
  for (let i = 0; i < newLines.length; i++) {
    const t = newLines[i].trim();
    if (inMultiLine) {
      if (t.includes('} from')) {
        inMultiLine = false;
        lastImportEnd = i;
      }
    } else if (t.startsWith('import ')) {
      if (t.includes(' from ') && (t.endsWith(';') || t.endsWith("'") || t.endsWith('"'))) {
        lastImportEnd = i;
      } else if (t.match(/^import\s+(type\s+)?\{/) && !t.includes('} from')) {
        inMultiLine = true;
      } else {
        lastImportEnd = i;
      }
    }
  }

  newLines.splice(lastImportEnd + 1, 0, newImport);
  content = newLines.join('\n').replace(/\n{3,}/g, '\n\n');

  if (content !== original) {
    writeFileSync(filePath, content);
    totalChanged++;
    console.log(`  ✓ ${relative(ROOT, filePath)}`);
  }
}

console.log(`\nDone: ${totalChanged} files migrated to @studiq/authz`);
