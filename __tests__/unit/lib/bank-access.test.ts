import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bankAccess } from '@/lib/bank-access';
import { evaluateScope } from '@studiq/authz';

// #152: a student opening a bank shared with their group got the teacher's management UI
// ("Utwórz pytanie", row edit / delete) although the API answers 403 to every one of those.

describe('bankAccess', () => {
  it('offers nothing and shows no notice while the bank loads', () => {
    const a = bankAccess(false, false);
    expect(a.readOnly).toBe(false);
    expect(a.canCreateQuestion).toBe(false);
    expect(a.allowQuestionAction(true)).toBe(false);
  });

  it('is read-only for someone who cannot update the bank', () => {
    const a = bankAccess(true, false);
    expect(a.readOnly).toBe(true);
    expect(a.canCreateQuestion).toBe(false);
    expect(a.allowQuestionAction(true)).toBe(false);
  });

  it('lets someone who can update the bank act where the question permission allows', () => {
    const a = bankAccess(true, true);
    expect(a.readOnly).toBe(false);
    expect(a.canCreateQuestion).toBe(true);
    expect(a.allowQuestionAction(true)).toBe(true);
    expect(a.allowQuestionAction(false)).toBe(false);
  });
});

describe('bank detail wiring', () => {
  const screen = readFileSync(
    'apps/web/src/components/questions/screens/question-bank-detail-screen.tsx',
    'utf8',
  );
  const card = readFileSync(
    'apps/web/src/components/questions/cards/question-bank-card.tsx',
    'utf8',
  );

  it('only renders the create button for people who may edit the bank', () => {
    expect(screen).toMatch(/access\.canCreateQuestion && \(\s*<Button onClick=\{openCreate\}>/);
  });

  it('gates the row actions on the bank permission', () => {
    expect(screen).toMatch(/canUpdate=\{\(q\) =>\s*access\.allowQuestionAction/);
    expect(screen).toMatch(/canDelete=\{\(q\) =>\s*access\.allowQuestionAction/);
  });

  it('labels the card action of a bank that cannot be edited as a preview', () => {
    expect(card).toContain("t('view_bank')");
  });
});

describe('messages', () => {
  for (const locale of ['pl', 'en']) {
    it(`${locale} has the read-only strings`, () => {
      const json = JSON.parse(readFileSync(`apps/web/src/i18n/messages/${locale}.json`, 'utf8'));
      expect(json.QuestionBankDetail.read_only_notice).toBeTruthy();
      expect(json.QuestionBankDetail.no_questions_read_only).toBeTruthy();
      expect(json.QuestionBankManagement.view_bank).toBeTruthy();
    });
  }
});

describe('bank permission carries the bank organisation (#648 review)', () => {
  const sources = [
    'apps/web/src/components/questions/screens/question-bank-detail-screen.tsx',
    'apps/web/src/components/questions/screens/question-bank-management-screen.tsx',
  ].map((path) => readFileSync(path, 'utf8'));

  it.each(sources.map((s, i) => [i, s] as const))(
    'passes orgId to the question_bank.update check (file %i)',
    (_i, source) => {
      expect(source).toMatch(
        /permission\('question_bank\.update', \{[^}]*orgId: bank\.organization_id/s,
      );
    },
  );

  const resource = { createdBy: 'author', activeOrgId: 'org-1' };

  it('an organisation-scoped role matches only when the bank org is known', () => {
    expect(evaluateScope('organization', 'someone-else', { ...resource, orgId: 'org-1' })).toBe(
      true,
    );
    expect(evaluateScope('organization', 'someone-else', { ...resource, orgId: null })).toBe(false);
  });

  it('own scope is decided by authorship, the author keeps edit', () => {
    expect(evaluateScope('own', 'author', { ...resource, orgId: 'org-1' })).toBe(true);
    expect(evaluateScope('own', 'someone-else', { ...resource, orgId: 'org-1' })).toBe(false);
  });
});
