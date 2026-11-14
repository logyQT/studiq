interface SectionHeaderProps {
  /** Mono kicker above the title. Omit when the title carries the section alone. */
  eyebrow?: string;
  title: string;
  lede?: string;
  /**
   * Short claims under the title, one per line. Used where the section's
   * promise is a set of conditions rather than a sentence: a list keeps each
   * claim its own fact, where a run-on lede buries two of them.
   */
  points?: readonly string[];
}

export function SectionHeader({ eyebrow, title, lede, points }: SectionHeaderProps) {
  return (
    <header className="max-w-2xl">
      {eyebrow ? (
        <p className="font-mono text-xs uppercase tracking-[0.08em] text-primary">{eyebrow}</p>
      ) : null}
      <h2 className="mt-3 font-display text-h2 font-semibold text-balance">{title}</h2>
      {lede ? <p className="mt-4 text-lede text-muted-foreground text-pretty">{lede}</p> : null}
      {points?.length ? (
        <ul className="mt-4 flex flex-col gap-1.5">
          {points.map((point) => (
            <li
              key={point}
              className="flex items-start gap-2.5 text-sm leading-snug text-muted-foreground"
            >
              {/* A hairline, not a tick: the page marks structure with rules and dots. */}
              <span aria-hidden="true" className="mt-2 h-px w-3 shrink-0 bg-primary" />
              {point}
            </li>
          ))}
        </ul>
      ) : null}
    </header>
  );
}
