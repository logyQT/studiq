#!/usr/bin/env bun
/**
 * Migrate authz + UI imports to package imports.
 * Handles multi-line imports by fully reconstructing affected import statements.
 */

import { readFileSync, writeFileSync } from 'fs';
import { globSync } from 'glob';
import { relative } from 'path';

const ROOT = '/workspaces/studiq/.worktrees/feat/monorepo-scaffold';

// Modules to migrate and their target package
const MIGRATIONS: Record<string, string> = {
  '@/lib/permissions': '@studiq/authz',
  '@/types': '@studiq/authz',
  '@/lib/request-context': '@studiq/authz',
  '@/components/ui/accordion': '@studiq/ui',
  '@/components/ui/alert': '@studiq/ui',
  '@/components/ui/alert-dialog': '@studiq/ui',
  '@/components/ui/aspect-ratio': '@studiq/ui',
  '@/components/ui/avatar': '@studiq/ui',
  '@/components/ui/badge': '@studiq/ui',
  '@/components/ui/breadcrumb': '@studiq/ui',
  '@/components/ui/button': '@studiq/ui',
  '@/components/ui/calendar': '@studiq/ui',
  '@/components/ui/card': '@studiq/ui',
  '@/components/ui/chart': '@studiq/ui',
  '@/components/ui/checkbox': '@studiq/ui',
  '@/components/ui/collapsible': '@studiq/ui',
  '@/components/ui/command': '@studiq/ui',
  '@/components/ui/context-menu': '@studiq/ui',
  '@/components/ui/dialog': '@studiq/ui',
  '@/components/ui/drawer': '@studiq/ui',
  '@/components/ui/dropdown-menu': '@studiq/ui',
  '@/components/ui/empty': '@studiq/ui',
  '@/components/ui/field': '@studiq/ui',
  '@/components/ui/form': '@studiq/ui',
  '@/components/ui/hover-card': '@studiq/ui',
  '@/components/ui/input': '@studiq/ui',
  '@/components/ui/input-group': '@studiq/ui',
  '@/components/ui/input-otp': '@studiq/ui',
  '@/components/ui/kbd': '@studiq/ui',
  '@/components/ui/label': '@studiq/ui',
  '@/components/ui/menubar': '@studiq/ui',
  '@/components/ui/multi-select': '@studiq/ui',
  '@/components/ui/navigation-menu': '@studiq/ui',
  '@/components/ui/pagination': '@studiq/ui',
  '@/components/ui/popover': '@studiq/ui',
  '@/components/ui/progress': '@studiq/ui',
  '@/components/ui/radio-group': '@studiq/ui',
  '@/components/ui/resizable': '@studiq/ui',
  '@/components/ui/scroll-area': '@studiq/ui',
  '@/components/ui/select': '@studiq/ui',
  '@/components/ui/separator': '@studiq/ui',
  '@/components/ui/sheet': '@studiq/ui',
  '@/components/ui/skeleton': '@studiq/ui',
  '@/components/ui/slider': '@studiq/ui',
  '@/components/ui/sonner': '@studiq/ui',
  '@/components/ui/switch': '@studiq/ui',
  '@/components/ui/table': '@studiq/ui',
  '@/components/ui/tabs': '@studiq/ui',
  '@/components/ui/textarea': '@studiq/ui',
  '@/components/ui/toast': '@studiq/ui',
  '@/components/ui/toaster': '@studiq/ui',
  '@/components/ui/toggle': '@studiq/ui',
  '@/components/ui/toggle-group': '@studiq/ui',
  '@/components/ui/tooltip': '@studiq/ui',
};

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

  // Pass 1: Parse all imports and identify which ones to migrate
  // Each import: { startLine, endLine, module, symbols, isType }
  type ImportInfo = {
    start: number;
    end: number;
    module: string;
    symbols: string[];
    isType: boolean;
  };
  const imports: ImportInfo[] = [];
  const packageSymbols = new Map<string, string[]>(); // pkg → merged symbols

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Single-line import
    const singleMatch = line.match(/^import\s+(type\s+)?\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?$/);
    if (singleMatch) {
      const isType = !!singleMatch[1];
      const symbols = singleMatch[2]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const mod = singleMatch[3];
      if (MIGRATIONS[mod]) {
        imports.push({ start: i, end: i, module: mod, symbols, isType });
        const pkg = MIGRATIONS[mod];
        if (!packageSymbols.has(pkg)) packageSymbols.set(pkg, []);
        packageSymbols.get(pkg)!.push(...symbols);
      }
      continue;
    }

    // Multi-line import start
    const multiMatch = line.match(/^import\s+(type\s+)?\{([^}]*)$/);
    if (multiMatch && !line.includes('} from')) {
      const isType = !!multiMatch[1];
      let allSymbols = multiMatch[2]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      let endLine = i;
      let foundModule = '';

      for (let j = i + 1; j < lines.length; j++) {
        const closingMatch = lines[j].match(/^([^}]*)\}\s+from\s+['"]([^'"]+)['"];?$/);
        if (closingMatch) {
          allSymbols.push(
            ...closingMatch[1]
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean),
          );
          endLine = j;
          foundModule = closingMatch[2];
          break;
        }
        allSymbols.push(
          ...lines[j]
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        );
      }

      if (foundModule && MIGRATIONS[foundModule]) {
        imports.push({ start: i, end: endLine, module: foundModule, symbols: allSymbols, isType });
        const pkg = MIGRATIONS[foundModule];
        if (!packageSymbols.has(pkg)) packageSymbols.set(pkg, []);
        packageSymbols.get(pkg)!.push(...allSymbols);
      }
    }
  }

  if (imports.length === 0) continue;

  // Pass 2: Rebuild the file
  // For each import line range, either remove entirely or reconstruct without migrated symbols
  const newLines: string[] = [];
  let i = 0;

  while (i < lines.length) {
    // Check if this line starts an import we're processing
    const importInfo = imports.find((imp) => imp.start === i);
    if (importInfo) {
      // Get ALL imports that start at this line (should be just one)
      const remainingSymbols = importInfo.symbols.filter((s) => {
        // Keep symbols that are NOT from the migrated module
        // We need to check: is this symbol ONLY from the migrated module?
        // Since we know the module, all symbols in this import are from that module
        return false; // All symbols in this import are from the migrated module
      });

      if (remainingSymbols.length === 0) {
        // Remove the entire import (all symbols migrated)
        i = importInfo.end + 1;
        continue;
      } else {
        // Reconstruct import without migrated symbols
        // This shouldn't happen since we migrate ALL symbols from a module
        // But just in case, keep the import with remaining symbols
        const typeKeyword = importInfo.isType ? 'type ' : '';
        if (remainingSymbols.length <= 3) {
          newLines.push(
            `import ${typeKeyword}{ ${remainingSymbols.join(', ')} } from '${importInfo.module}';`,
          );
        } else {
          newLines.push(`import ${typeKeyword}{`);
          for (const s of remainingSymbols) {
            newLines.push(`  ${s},`);
          }
          newLines.push(`} from '${importInfo.module}';`);
        }
        i = importInfo.end + 1;
        continue;
      }
    }

    newLines.push(lines[i]);
    i++;
  }

  // Pass 3: Add package imports after the last top-level import
  const packageImports: string[] = [];
  for (const [pkg, symbols] of packageSymbols) {
    const deduped = [...new Set(symbols)];
    packageImports.push(`import { ${deduped.join(', ')} } from '${pkg}';`);
  }

  // Find insertion point
  let insertIdx = 0;
  let inMulti = false;
  for (let j = 0; j < newLines.length; j++) {
    const t = newLines[j].trim();
    if (inMulti) {
      if (t.includes('} from')) {
        inMulti = false;
        insertIdx = j + 1;
      }
    } else if (t.startsWith('import ')) {
      if (t.match(/^import\s+(type\s+)?\{/) && !t.includes('} from')) {
        inMulti = true;
      } else {
        insertIdx = j + 1;
      }
    }
  }

  for (const imp of packageImports) {
    newLines.splice(insertIdx, 0, imp);
    insertIdx++;
  }

  content = newLines.join('\n').replace(/\n{3,}/g, '\n\n');

  if (content !== original) {
    writeFileSync(filePath, content);
    totalChanged++;
  }
}

console.log(`Migrated ${totalChanged} files`);
