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
  isTypingTarget,
  NAV_SHORTCUTS,
  type NavShortcut,
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

/** A modal or menu is open: the page behind it must not react to letters. */
function overlayOpen(): boolean {
  return !!document.querySelector(
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"]',
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

  const nav = area ? NAV_SHORTCUTS[area] : NO_SHORTCUTS;
  // One matcher per area: moving to another area forgets a half-typed sequence.
  const matcher = useMemo(() => createSequenceMatcher(nav), [nav]);

  const navDisabled = sequencesDisabled(pathname);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(document.activeElement)) return;

      if (e.key === '?') {
        if (overlayOpen() && !open) return;
        e.preventDefault();
        setOpen((value) => !value);
        return;
      }

      if (open || overlayOpen() || navDisabled || !area) return;
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
            <Row keys={['Ctrl', 'K']} label={t('search')} then="+" />
            <Row keys={['/']} label={t('search_slash')} />
            <Row keys={['Esc']} label={t('close')} />
          </Group>

          {area && (
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
            <Row keys={['1', '2', '3', '4']} label={t('study_rate')} then="/" />
            <Row keys={['P']} label={t('study_audio')} />
            <Row keys={['Alt', 'K']} label={t('study_panel')} then="+" />
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
