import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { FreeIncluded } from '@/app/(frontend)/(auth)/register/free-included';
import { RegisterForm } from '@/app/(frontend)/(auth)/register/register-form-client';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: 'RegisterPage' });
  const title = t('header');
  const description = t('sub_header');

  return {
    title,
    description,
    openGraph: { title, description },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default function RegisterPage() {
  return (
    /*
     * The page owns its chrome: it has no navbar or footer, and the panel is its
     * only saturated band. Below `lg` the two halves stack, panel first, so the
     * benefit list is scanned before the form asks for anything.
     */
    <main className="grid min-h-svh lg:grid-cols-2">
      <FreeIncluded />

      {/*
       * The shell's paper surface in both themes: `bg-paper-grain` carries its own
       * `.dark &` block, so one class paints the correct stack for each.
       */}
      <div className="flex flex-col p-content lg:p-12 bg-paper-grain">
        <div className="mx-auto my-auto w-full max-w-md">
          <RegisterForm />
        </div>
      </div>
    </main>
  );
}
