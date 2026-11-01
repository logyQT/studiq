import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NOTIFICATION_TYPES } from '@studiq/server/models/notification.model';
import { describe, expect, it } from 'vitest';
import {
  notificationArea,
  notificationHref,
  notificationParams,
  unreadBadge,
} from '@/lib/notifications';

// #664: what the bell shows for each kind of notification, and where a click goes.

const ID = '3e0a1b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b';

describe('notificationArea', () => {
  it.each([
    ['/app/study/learn', 'app'],
    ['/edu', 'edu'],
    ['/manage/members', 'manage'],
    ['/login', null],
    [null, null],
    [undefined, null],
  ])('%s -> %s', (path, area) => {
    expect(notificationArea(path as string | null | undefined)).toBe(area);
  });
});

describe('notificationHref', () => {
  it('sends a new assignment to the student assignment page', () => {
    expect(
      notificationHref(
        { type: 'assignment_published', payload: { assignmentId: ID, title: 'T' } },
        'app',
      ),
    ).toBe(`/app/assignments/${ID}`);
  });

  it('sends a graded assignment to its review', () => {
    expect(
      notificationHref(
        { type: 'assignment_graded', payload: { assignmentId: ID, title: 'T' } },
        'app',
      ),
    ).toBe(`/app/assignments/${ID}/review`);
  });

  it.each(['app', 'edu', 'manage'] as const)(
    'sends a report message to the reports of the %s area',
    (area) => {
      expect(notificationHref({ type: 'report_message', payload: { reportId: ID } }, area)).toBe(
        `/${area}/reports/${ID}`,
      );
    },
  );

  it('sends an accepted invitation to the members, for a manager only', () => {
    expect(notificationHref({ type: 'invitation_accepted', payload: {} }, 'manage')).toBe(
      '/manage/members',
    );
    expect(notificationHref({ type: 'invitation_accepted', payload: {} }, 'edu')).toBeNull();
    expect(notificationHref({ type: 'invitation_accepted', payload: {} }, null)).toBeNull();
  });

  it('has nowhere to go without a known area for a report', () => {
    expect(
      notificationHref({ type: 'report_message', payload: { reportId: ID } }, null),
    ).toBeNull();
  });

  it.each([
    ['not a uuid', 'abc'],
    ['a path', '../../admin'],
    ['empty', ''],
    ['a number', 42],
    ['missing', undefined],
  ])('never builds a path from an id that is %s', (_name, bad) => {
    for (const type of ['assignment_published', 'assignment_graded'] as const) {
      expect(notificationHref({ type, payload: { assignmentId: bad } }, 'app')).toBeNull();
    }
    expect(
      notificationHref({ type: 'report_message', payload: { reportId: bad } }, 'edu'),
    ).toBeNull();
  });
});

describe('notificationParams', () => {
  it('reads the title of an assignment notification', () => {
    expect(
      notificationParams({ type: 'assignment_published', payload: { title: ' Kartkówka ' } }),
    ).toEqual({
      title: 'Kartkówka',
    });
    expect(notificationParams({ type: 'assignment_graded', payload: { title: 'T' } })).toEqual({
      title: 'T',
    });
  });

  it('reads the name of a report sender or a new member', () => {
    expect(notificationParams({ type: 'report_message', payload: { senderName: 'Ola' } })).toEqual({
      name: 'Ola',
    });
    expect(
      notificationParams({ type: 'invitation_accepted', payload: { memberName: 'Jan' } }),
    ).toEqual({
      name: 'Jan',
    });
  });

  it.each([null, '', '   ', 5, {}])(
    'turns %j into null so the message falls back to a neutral word',
    (bad) => {
      expect(
        notificationParams({ type: 'assignment_published', payload: { title: bad } }).title,
      ).toBeNull();
      expect(
        notificationParams({ type: 'report_message', payload: { senderName: bad } }).name,
      ).toBeNull();
    },
  );
});

describe('unreadBadge', () => {
  it.each([
    [0, ''],
    [-3, ''],
    [1, '1'],
    [9, '9'],
    [10, '9+'],
    [250, '9+'],
  ])('%d -> %j', (count, text) => {
    expect(unreadBadge(count)).toBe(text);
  });
});

describe('messages', () => {
  const messages = (locale: string) =>
    JSON.parse(
      readFileSync(join(process.cwd(), `apps/web/src/i18n/messages/${locale}.json`), 'utf8'),
    );

  it.each(['pl', 'en'])('%s: every kind of notification has a message', (locale) => {
    const labels = messages(locale).Notifications as Record<string, string>;
    for (const type of NOTIFICATION_TYPES) {
      expect(labels[`type_${type}`], `${locale}: type_${type}`).toBeTruthy();
    }
    for (const key of [
      'title',
      'button',
      'button_unread',
      'mark_all_read',
      'empty',
      'unread',
      'untitled',
      'someone',
    ]) {
      expect(labels[key], `${locale}: ${key}`).toBeTruthy();
    }
  });
});
