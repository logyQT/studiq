import { Footer } from '@/components/layout/Footer';
import { Navbar } from '@/components/layout/Navbar';

interface MainLayoutProps {
  children: React.ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  return (
    <div className="relative flex min-h-screen flex-col bg-paper-grain">
      <Navbar />
      <main className="flex-1">
        {/* The grain stays full-width on the wrapper above; the gutter grows past
            the base inset so a notched phone in landscape (`viewportFit: 'cover'`)
            does not clip the content into the rounded corner. */}
        <div className="mx-auto max-w-7xl py-8 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:pl-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))] lg:pl-[max(2rem,env(safe-area-inset-left))] lg:pr-[max(2rem,env(safe-area-inset-right))]">
          {children}
        </div>
      </main>
      <Footer />
    </div>
  );
}
