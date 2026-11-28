import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * #1567: a student who can read a teacher's group-shared topic saw Edit and Delete on the card,
 * while the API refused both with 403. The deck card hides the same items behind the caller's
 * scoped permission (#961); the topic card now does too.
 *
 * This is a source check, not a render test: the unit environment has no DOM, and the QA corpus
 * drives the served card as a student (`EDU-TOPIC-*`). Removing a gate or a permission argument
 * here turns this red; the API stays the boundary either way.
 */
const CARD = path.join(process.cwd(), 'apps/web/src/components/flashcards/cards/topic-card.tsx');
const SCREEN = path.join(
  process.cwd(),
  'apps/web/src/components/flashcards/screens/topic-management-screen.tsx',
);
const MODEL = path.join(process.cwd(), 'packages/server/src/models/topic.model.ts');

describe('topic card hides the actions the API refuses (#1567)', () => {
  const card = readFileSync(CARD, 'utf8');
  const screen = readFileSync(SCREEN, 'utf8');

  it('renders Edit and Delete only behind their permission, in both menus', () => {
    expect(card.match(/\{canUpdate && \(/g) ?? []).toHaveLength(2);
    expect(card.match(/\{canDelete && \(/g) ?? []).toHaveLength(2);
  });

  it('binds each permission to the action it gates, against the topic row', () => {
    // Paired on purpose: a swap of `topic.update`/`topic.delete` between the two actions
    // must fail, not just a missing argument.
    expect(screen).toMatch(
      /canUpdate=\{permission\('topic\.update', \{[^}]*createdBy: topic\.created_by,[^}]*orgId: topic\.organization_id \?\? undefined,/,
    );
    expect(screen).toMatch(
      /canDelete=\{permission\('topic\.delete', \{[^}]*createdBy: topic\.created_by,[^}]*orgId: topic\.organization_id \?\? undefined,/,
    );
  });

  it('carries the topic organization on the payload the gate reads', () => {
    expect(readFileSync(MODEL, 'utf8')).toContain('organization_id?: string | null;');
  });
});
