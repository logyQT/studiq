import Link from 'next/link';
import { useTranslations } from 'next-intl';

export default function NotFound() {
  const t = useTranslations('NotFoundPage');

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] p-6 text-center bg-background text-foreground">
      <div className="space-y-6">
        <h1 className="text-9xl font-black text-muted/30 select-none">404</h1>

        <div className="space-y-2">
          <h2 className="text-3xl font-bold tracking-tight">{t('title')}</h2>
          <p className="text-muted-foreground max-w-[400px] mx-auto">{t('description')}</p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center items-center pt-4">
          <Link
            href="/"
            className="px-8 py-3 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-all font-medium shadow-sm"
          >
            {t('back_home')}
          </Link>
          <Link
            href="/api/v1/health"
            className="px-8 py-3 bg-secondary text-secondary-foreground rounded-lg hover:bg-accent transition-colors font-medium border border-border"
          >
            {t('system_status')}
          </Link>
        </div>
      </div>

      <div className="absolute inset-0 -z-10 h-full w-full bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px] [mask-image:radial-gradient(ellipse_50%_50%_at_50%_50%,#000_70%,transparent_100%)] opacity-20 dark:opacity-10" />
    </div>
  );
}
