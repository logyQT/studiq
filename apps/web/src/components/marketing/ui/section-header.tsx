interface SectionHeaderProps {
  /** Mono kicker above the title. Omit when the title carries the section alone. */
  eyebrow?: string;
  title: string;
  lede?: string;
  /** Marketing defaults to left; one centered band per page is the ceiling. */
  align?: 'left' | 'center';
}

export function SectionHeader({ eyebrow, title, lede, align = 'left' }: SectionHeaderProps) {
  const centered = align === 'center';

  return (
    <header className={centered ? 'max-w-2xl text-center mx-auto' : 'max-w-2xl'}>
      {eyebrow ? (
        <p className="font-mono text-xs uppercase tracking-[0.08em] text-primary">{eyebrow}</p>
      ) : null}
      <h2 className="mt-3 font-display text-h2 font-semibold text-balance">{title}</h2>
      {lede ? <p className="mt-4 text-lede text-muted-foreground text-pretty">{lede}</p> : null}
    </header>
  );
}
