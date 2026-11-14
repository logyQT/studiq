'use client';

import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/*
 * The flip card is a focusable group, not a button: its markdown faces keep their own links, and a
 * button/switch role would make those descendants presentational. That is why a non-interactive
 * element carries `tabIndex` and the key/mouse handlers below.
 */
/* eslint-disable jsx-a11y/no-noninteractive-tabindex, jsx-a11y/no-noninteractive-element-interactions -- see above. */

const FLIP_SECONDS = 0.32; // DESIGN §Motion: 320ms ceiling
const FLIP_EASE = [0.2, 0, 0, 1] as const; // DESIGN §Motion: the one house curve
const FACE_FADE_SECONDS = 0.06;
/*
 * The house curve front-loads: it covers half the rotation in the first 20% of the duration, so
 * the card is edge-on at ~64ms. The outgoing face is gone by 60ms and the incoming one starts at
 * 70ms, so the swap happens while the card presents no area to the viewer — no mirrored face is
 * ever on screen, whatever `backface-visibility` does.
 */
const OUTGOING_FACE = { duration: FACE_FADE_SECONDS, ease: 'linear' } as const;
const INCOMING_FACE = { duration: FACE_FADE_SECONDS, delay: 0.07, ease: 'linear' } as const;
const INSTANT = { duration: 0 } as const;

interface FlashcardFlipProps {
  isFlipped: boolean;
  front: ReactNode;
  back: ReactNode;
  className?: string;
  onClick?: () => void;
  /**
   * Accessible name for the focusable card. The wrapper is a `group`, not a button: the faces
   * render markdown, and the button role would turn any link inside them presentational.
   */
  ariaLabel?: string;
}

export function FlashcardFlip({
  isFlipped,
  front,
  back,
  className,
  onClick,
  ariaLabel,
}: FlashcardFlipProps) {
  // Keyboard parity with `onClick`, for the card itself only: a focused link inside a face keeps
  // Enter for its own activation. The event is consumed so the page-level Space handlers (the
  // study session flips on Space) cannot flip the card a second time.
  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.target !== e.currentTarget) return;
    if (e.key !== 'Enter' && e.key !== ' ' && e.code !== 'Space') return;
    // Holding the key must not flip the card over and over; consume the repeats so the page-level
    // Space handler cannot flip it either.
    if (e.repeat) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    onClick?.();
  }

  /*
   * The preference is client-only, so it is applied after mount: the server render (and therefore
   * hydration) always takes the animated path, and React then sees a real prop change to patch.
   * Reading it on the first client render would leave the server's inline style in place.
   */
  const prefersReduceMotion = useReducedMotion() === true;
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // DESIGN §Motion: reduced motion drops the rotation and makes the face swap instant.
  const reduceMotion = mounted && prefersReduceMotion;
  const flip = reduceMotion ? { duration: 0 } : { duration: FLIP_SECONDS, ease: FLIP_EASE };
  const outgoing = reduceMotion ? INSTANT : OUTGOING_FACE;
  const incoming = reduceMotion ? INSTANT : INCOMING_FACE;
  /*
   * The back face's pre-rotation is a CSS variable so the reduced-motion switch can flatten it
   * without rewriting the face's own `transform`: motion owns that property, and a changed string
   * is not re-applied after mount. With no container rotation the face must stay upright.
   */
  const cardStyle = {
    perspective: 1200,
    '--flip-back-rotation': reduceMotion ? '0deg' : '180deg',
  } as CSSProperties;

  return (
    <fieldset
      aria-label={ariaLabel}
      aria-keyshortcuts="Enter Space"
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={cn(
        'relative w-full h-88 cursor-pointer rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className,
      )}
      style={cardStyle}
      onClick={onClick}
    >
      <motion.div
        className="relative w-full h-full"
        animate={{ rotateY: isFlipped && !reduceMotion ? 180 : 0 }}
        transition={flip}
        style={{ transformStyle: 'preserve-3d' }}
      >
        {/*
         * Each face is hidden by its own opacity, never by `backface-visibility`: WebKit paints a
         * face's `z-index`ed descendants (the markdown wrapper, the watermark) even while the face
         * itself points away, so both faces show at rest. The fade is timed around the edge-on
         * instant instead — the front is fully transparent before the card reaches 90°, the back
         * only appears after it — so a mirrored face can never be on screen in any engine.
         *
         * `initial` is the target, not a default: the next deck card mounts with the answer face
         * already at opacity 0. Without it motion would animate that face down from the browser's
         * default opacity 1 and show the incoming card's answer during its mount.
         */}
        <motion.div
          className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl border bg-card shadow-md overflow-hidden"
          initial={{ opacity: isFlipped ? 0 : 1 }}
          animate={{ opacity: isFlipped ? 0 : 1 }}
          transition={isFlipped ? outgoing : incoming}
        >
          {front}
        </motion.div>

        {/* Back face — faces the viewer once the card is flipped (flattened under reduced motion) */}
        <motion.div
          className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl border bg-card shadow-md overflow-hidden"
          initial={{ opacity: isFlipped ? 1 : 0 }}
          animate={{ opacity: isFlipped ? 1 : 0 }}
          transition={isFlipped ? incoming : outgoing}
          style={{ transform: 'rotateY(var(--flip-back-rotation, 180deg))' }}
        >
          {back}
        </motion.div>
      </motion.div>
    </fieldset>
  );
}
