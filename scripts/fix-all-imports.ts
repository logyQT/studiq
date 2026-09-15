#!/usr/bin/env bun
/**
 * Fix ALL broken imports from both authz and UI migration.
 *
 * The migration scripts inserted `import { ... } from '@studiq/authz'` and
 * `import { ... } from '@studiq/ui'` inside multi-line import blocks.
 *
 * Fix: remove misplaced imports, collect symbols, re-add as proper imports.
 */

import { readFileSync, writeFileSync } from 'fs';
import { globSync } from 'glob';
import { relative } from 'path';

const ROOT = '/workspaces/studiq/.worktrees/feat/monorepo-scaffold';

const IMPORT_PACKAGES = new Set(['@studiq/authz', '@studiq/ui']);

const files = [
  ...globSync(`${ROOT}/src/**/*.{ts,tsx}`, {
    ignore: ['**/node_modules/**', '**/.next/**', '**/packages/**'],
  }),
  ...globSync(`${ROOT}/__tests__/**/*.{ts,tsx}`, { ignore: ['**/node_modules/**'] }),
];

let totalFixed = 0;

for (const filePath of files) {
  let content = readFileSync(filePath, 'utf-8');
  const original = content;

  const lines = content.split('\n');

  // Pass 1: Find misplaced package imports (inside multi-line imports)
  const misplacedByPkg = new Map<string, string[]>(); // pkg → symbols[]
  const linesToRemove = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Check if this line is a package import
    const pkgMatch = trimmed.match(
      /^import\s+(type\s+)?\{([^}]+)\}\s+from\s+('@studiq\/(?:authz|ui)');?$/,
    );
    if (!pkgMatch) continue;

    const pkg = pkgMatch[3];
    const isType = !!pkgMatch[1];
    const symbols = pkgMatch[2].trim();

    // Check if we're inside a multi-line import by looking backwards
    let insideMultiLine = false;
    for (let j = i - 1; j >= Math.max(0, i - 20); j--) {
      const prev = lines[j].trim();
      if (prev.includes('} from') || prev.match(/^import\s/)) {
        break; // Found a complete import or another import start
      }
      if (prev.match(/^import\s+(type\s+)?\{[^}]*$/) || prev.match(/,\s*$/)) {
        insideMultiLine = true;
        break;
      }
    }

    if (insideMultiLine) {
      linesToRemove.add(i);
      if (!misplacedByPkg.has(pkg)) misplacedByPkg.set(pkg, []);
      for (const s of symbols.split(',')) {
        const t = s.trim();
        if (t) misplacedByPkg.get(pkg)!.push(t);
      }
    }
  }

  if (misplacedByPkg.size === 0) continue;

  // Remove misplaced lines
  const newLines = lines.filter((_, i) => !linesToRemove.has(i));

  // Also remove any existing correct-position package imports (we'll re-add them)
  const existingPkgImports = new Map<string, string[]>();
  for (let i = 0; i < newLines.length; i++) {
    const trimmed = newLines[i].trim();
    const pkgMatch = trimmed.match(
      /^import\s+(type\s+)?\{([^}]+)\}\s+from\s+('@studiq\/(?:authz|ui)');?$/,
    );
    if (pkgMatch) {
      const pkg = pkgMatch[3];
      const symbols = pkgMatch[2].trim();
      if (!existingPkgImports.has(pkg)) existingPkgImports.set(pkg, []);
      for (const s of symbols.split(',')) {
        const t = s.trim();
        if (t) existingPkgImports.get(pkg)!.push(t);
      }
      newLines.splice(i, 1);
      i--;
    }
  }

  // Merge misplaced + existing symbols
  for (const [pkg, syms] of misplacedByPkg) {
    if (!existingPkgImports.has(pkg)) existingPkgImports.set(pkg, []);
    existingPkgImports.get(pkg)!.push(...syms);
  }

  // Deduplicate symbols per package
  for (const [pkg, syms] of existingPkgImports) {
    const deduped = [...new Set(syms)];
    existingPkgImports.set(pkg, deduped);
  }

  // Find insertion point (after last top-level import)
  let insertIdx = 0;
  let inMulti = false;
  for (let i = 0; i < newLines.length; i++) {
    const t = newLines[i].trim();
    if (inMulti) {
      if (t.includes('} from')) {
        inMulti = false;
        insertIdx = i + 1;
      }
    } else if (t.startsWith('import ')) {
      if (t.match(/^import\s+(type\s+)?\{/) && !t.includes('} from')) {
        inMulti = true;
      } else {
        insertIdx = i + 1;
      }
    }
  }

  // Build new import lines
  const newImports: string[] = [];
  for (const [pkg, syms] of existingPkgImports) {
    // Check if any symbol is not type-only
    newImports.push(`import { ${syms.join(', ')} } from '${pkg}';`);
  }

  // Insert
  for (let i = 0; i < newImports.length; i++) {
    newLines.splice(insertIdx + i, 0, newImports[i]);
  }

  content = newLines.join('\n').replace(/\n{3,}/g, '\n\n');

  if (content !== original) {
    writeFileSync(filePath, content);
    totalFixed++;
  }
}

console.log(`Fixed ${totalFixed} files`);

// Now run biome format to sort imports
