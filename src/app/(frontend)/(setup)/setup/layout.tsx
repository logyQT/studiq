export default function SetupLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-5xl min-h-[400px]">{children}</div>
    </div>
  );
}
