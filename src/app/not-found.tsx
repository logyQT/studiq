import Link from "next/link";

/**
 * NOT FOUND PAGE (404)
 * * This component is automatically rendered by Next.js when:
 * 1. A user navigates to a non-existent route.
 * 2. The notFound() function is called in a Server Component.
 */
export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] p-6 text-center bg-background text-foreground">
      <div className="space-y-6">
        {/* Large stylized 404 header using the destructive/primary color */}
        <h1 className="text-9xl font-black text-muted/30 select-none">404</h1>

        <div className="space-y-2">
          <h2 className="text-3xl font-bold tracking-tight">Page not found</h2>
          <p className="text-muted-foreground max-w-[400px] mx-auto">Sorry, we couldn’t find the page you’re looking for. It might have been moved or deleted.</p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center items-center pt-4">
          <Link href="/" className="px-8 py-3 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-all font-medium shadow-sm">
            Back to Home
          </Link>

          <Link href="/api/v1/health" className="px-8 py-3 bg-secondary text-secondary-foreground rounded-lg hover:bg-accent transition-colors font-medium border border-border">
            Check System Status
          </Link>
        </div>
      </div>

      {/* Decorative background element using your theme ring/border color */}
      <div className="absolute inset-0 -z-10 h-full w-full bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px] [mask-image:radial-gradient(ellipse_50%_50%_at_50%_50%,#000_70%,transparent_100%)] opacity-20 dark:opacity-10" />
    </div>
  );
}
