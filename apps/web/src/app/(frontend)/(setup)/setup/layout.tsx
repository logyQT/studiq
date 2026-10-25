import { SetupHeader } from '@/app/(frontend)/(setup)/setup/setup-header';

export default function SetupLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SetupHeader />
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-5xl min-h-[400px]">{children}</div>
      </main>
    </div>
  );
}
