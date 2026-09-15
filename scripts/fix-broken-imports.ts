#!/usr/bin/env bun
/**
 * Fix broken imports from the authz migration.
 *
 * The previous script inserted `import type { X } from '@studiq/authz';`
 * inside multi-line import blocks. Fix:
 * 1. Remove all `import ... from '@studiq/authz'` lines from the file
 * 2. Collect the symbols
 * 3. Add a single clean import at the top-level imports section
 */

import { readFileSync, writeFileSync } from 'fs';
import { globSync } from 'glob';

const ROOT = '/workspaces/studiq/.worktrees/feat/monorepo-scaffold';

const files = globSync(`${ROOT}/src/**/*.{ts,tsx}`, {
  ignore: ['**/node_modules/**', '**/.next/**', '**/packages/**'],
});

let fixed = 0;

for (const filePath of files) {
  let content = readFileSync(filePath, 'utf-8');
  const original = content;

  // Step 1: Extract all authz import lines and their symbols
  const authzLineRegex = /^(import (?:type )?\{([^}]+)\}\s*from\s*'@studiq\/authz';?)$/gm;
  const collectedSymbols: { symbols: string; isType: boolean }[] = [];
  let match;

  while ((match = authzLineRegex.exec(content)) !== null) {
    const isType = match[1].includes('import type');
    collectedSymbols.push({ symbols: match[2].trim(), isType });
  }

  if (collectedSymbols.length === 0) continue;

  // Step 2: Remove all authz import lines from the file
  content = content.replace(/^import (?:type )?\{[^}]+\}\s*from\s*'@studiq\/authz';?\n?/gm, '');

  // Step 3: Merge symbols (prefer non-type if mixed)
  const allSymbols = collectedSymbols.map((s) => s.symbols).join(', ');
  const allTypeOnly = collectedSymbols.every((s) => s.isType);
  const newImport = allTypeOnly
    ? `import type { ${allSymbols} } from '@studiq/authz';\n`
    : `import { ${allSymbols} } from '@studiq/authz';\n`;

  // Step 4: Insert after the last top-level import
  const lines = content.split('\n');
  let lastImportLine = -1;
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('import ')) {
      // Check if it's a multi-line import
      if (trimmed.includes(' from ') && trimmed.endsWith(';')) {
        lastImportLine = i;
      } else if (trimmed.includes(' from ') && trimmed.endsWith('{')) {
        // Multi-line import start — find the end
        depth = 0;
        for (let j = i; j < lines.length; j++) {
          for (const ch of lines[j]) {
            if (ch === '{') depth++;
            if (ch === '}') depth--;
          }
          if (depth <= 0 && lines[j].includes('} from')) {
            lastImportLine = j;
            break;
          }
        }
      } else if (trimmed.match(/^import\s+(?:type\s+)?\{[^}]*$/)) {
        // Multi-line import without from on same line
        for (let j = i; j < lines.length; j++) {
          if (lines[j].includes('} from')) {
            lastImportLine = j;
            break;
          }
        }
      } else {
        lastImportLine = i;
      }
    }
  }

  if (lastImportLine >= 0) {
    lines.splice(lastImportLine + 1, 0, newImport.trimEnd());
  } else {
    lines.unshift(newImport.trimEnd());
  }

  content = lines.join('\n');

  // Clean up blank lines
  content = content.replace(/\n{3,}/g, '\n\n');

  if (content !== original) {
    writeFileSync(filePath, content);
    fixed++;
    console.log(`  ✓ Fixed ${filePath.replace(ROOT + '/', '')}`);
  }
}

console.log(`\nFixed ${fixed} files`);
