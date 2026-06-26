import { AppRealtimeProvider } from '@/components/providers/AppRealtimeProvider';

export default function FlashcardsLayout({ children }: { children: React.ReactNode }) {
  return <AppRealtimeProvider>{children}</AppRealtimeProvider>;
}
