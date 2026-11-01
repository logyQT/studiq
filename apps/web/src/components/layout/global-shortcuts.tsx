'use client';

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@studiq/ui';
import { Keyboard } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  createSequenceMatcher,
  isApplePlatform,
  isIgnorableKeyEvent,
  isTypingTarget,
  modifierLabels,
  NAV_SHORTCUTS,
  type NavShortcut,
  overlayOpen,
  sequencesDisabled,
  shortcutArea,
} from '@/lib/shortcuts';

const NO_SHORTCUTS: NavShortcut[] = [];

/** Event the header button fires, so the dialog has one owner. */
const OPEN_EVENT = 'studiq:open-shortcuts';

function Keycap({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-6 select-none items-center justify-center rounded border bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground shadow-[0_1px_0_0_rgba(0,0,0,0.2)]">
      {children}
    </kbd>
  );
}

function Row({ keys, label, then }: { keys: string[]; label: string; then?: string }) {
  return (
    <li className="flex items-center justify-between gap-4 py-1.5">
      <span className="text-sm">{label}</span>
      <span className="flex shrink-0 items-center gap-1">
        {keys.map((key, i) => (
          <Fragment key={key}>
            {i > 0 && <span className="text-xs text-muted-foreground">{then}</span>}
            <Keycap>{key}</Keycap>
          </Fragment>
        ))}
      </span>
    </li>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <ul className="divide-y">{children}</ul>
    </section>
  );
}

/**
 * Keyboard shortcuts of the dashboards (#665): `?` opens the help dialog, `g` then a letter goes
 * to a page of the current area. Nothing fires while typing, with a modifier held, behind an open
 * dialog or menu, or inside a study session (which has its own keys).
 */
export function GlobalShortcuts() {
  const t = useTranslations('Shortcuts');
  const router = useRouter();
  const pathname = usePathname();
  const area = shortcutArea(pathname);
  const [open, setOpen] = useState(false);
  const [apple, setApple] = useState(false);
  const mod = modifierLabels(apple);

  const nav = area ? NAV_SHORTCUTS[area] : NO_SHORTCUTS;
  // One matcher per area: moving to another area forgets a half-typed sequence.
  const matcher = useMemo(() => createSequenceMatcher(nav), [nav]);

  const navDisabled = sequencesDisabled(pathname);

  useEffect(() => {
    setApple(isApplePlatform(navigator));
  }, []);

  // A half-typed `g` must not survive a route change, the dialog opening or closing, or the tab
  // losing the focus: the next letter would then navigate from under the user.
  useEffect(() => {
    matcher.reset();
  }, [matcher, pathname, open]);

  // The mouse swallows the keys a guard would see: `g`, click a menu open and closed, then `d`
  // still lands inside the timeout while no keydown ever reached the overlay check. Any pointer
  // press means the user moved on, so the pending prefix is dropped there too.
  useEffect(() => {
    const reset = () => matcher.reset();
    const onVisibility = () => {
      if (document.hidden) matcher.reset();
    };
    window.addEventListener('blur', reset);
    window.addEventListener('pointerdown', reset);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('blur', reset);
      window.removeEventListener('pointerdown', reset);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [matcher]);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Something closer to the focus (the flashcard's own flip handler, an input, a menu) already
      // handled this key: it is not a shortcut.
      if (e.defaultPrevented) return;
      // A long press also cancels a pending prefix: holding `g` must not leave a half-typed
      // sequence armed. Typing, chords and IME composition cancel it too.
      if (e.repeat) {
        matcher.reset();
        return;
      }
      if (isIgnorableKeyEvent(e) || isTypingTarget(document.activeElement)) {
        matcher.reset();
        return;
      }

      if (e.key === '?') {
        // Another layer owns the key: drop any pending prefix instead of leaving it armed.
        if (overlayOpen() && !open) {
          matcher.reset();
          return;
        }
        e.preventDefault();
        setOpen((value) => !value);
        return;
      }

      if (open || overlayOpen() || navDisabled || !area) {
        matcher.reset();
        return;
      }
      const href = matcher.press(e.key);
      if (href) {
        e.preventDefault();
        router.push(href);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [area, matcher, navDisabled, open, router]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <Group title={t('group_general')}>
            <Row keys={['?']} label={t('help')} />
            <Row keys={[mod.ctrl, 'K']} label={t('search')} then="+" />
            <Row keys={['/']} label={t('search_slash')} />
            <Row keys={['Esc']} label={t('close')} />
          </Group>

          {/* Hidden where sequences do nothing by design (the study session), so the dialog never
              advertises a shortcut the handler refuses to run. */}
          {area && !navDisabled && (
            <Group title={t('group_nav')}>
              {nav.map((shortcut) => (
                <Row
                  key={shortcut.sequence}
                  keys={shortcut.sequence.split(' ').map((k) => k.toUpperCase())}
                  label={t(`nav.${shortcut.labelKey}`)}
                  then={t('then')}
                />
              ))}
            </Group>
          )}

          <Group title={t('group_study')}>
            <Row keys={['Space']} label={t('study_flip')} />
            <Row keys={['1–4']} label={t('study_rate')} />
            <Row keys={['P']} label={t('study_audio')} />
            <Row keys={[mod.alt, 'K']} label={t('study_panel')} then="+" />
          </Group>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Header button that opens the shortcuts dialog (the `?` key does the same). */
export function ShortcutsButton() {
  const t = useTranslations('Shortcuts');
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8"
      title={t('button_title')}
      aria-label={t('button_title')}
      aria-keyshortcuts="?"
      onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))}
    >
      <Keyboard className="size-4" aria-hidden="true" />
    </Button>
  );
}
