import { Footer } from '@/components/layout/Footer';
import { Navbar } from '@/components/layout/Navbar';

interface MarketingShellProps {
  children: React.ReactNode;
}

/*
 * Marketing sections own their own container and block padding, because a
 * full-bleed band has to escape a max-width wrapper to exist. MainLayout keeps
 * the constrained column for the prose pages (/status, /privacy, /terms).
 */
export function MarketingShell({ children }: MarketingShellProps) {
  return (
    <div className="relative flex min-h-screen flex-col">
      <Navbar />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
