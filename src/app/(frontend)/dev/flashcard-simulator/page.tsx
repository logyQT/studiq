import { SimulatorClient } from './simulator-client';

export default function FlashcardSimulatorPage() {
  if (process.env.NODE_ENV !== 'development') {
    return <div className="p-8 text-center text-muted-foreground">Only available in development</div>;
  }
  return <SimulatorClient />;
}
