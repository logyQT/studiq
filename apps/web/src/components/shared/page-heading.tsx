/**
 * Page-level heading for the dashboard surfaces: the 3xl title and its muted
 * subtitle, in the one type scale every account page uses.
 */
export function PageHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
      <p className="text-muted-foreground mt-1">{subtitle}</p>
    </div>
  );
}
