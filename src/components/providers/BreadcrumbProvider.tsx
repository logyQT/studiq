'use client';

import { createContext, useContext, useState, useCallback, useEffect } from 'react';

export interface BreadcrumbDynamicSegment {
  label: string;
  href: string;
}

interface BreadcrumbContextType {
  dynamicSegments: BreadcrumbDynamicSegment[];
  setDynamicSegments: (segments: BreadcrumbDynamicSegment[]) => void;
}

const BreadcrumbContext = createContext<BreadcrumbContextType>({
  dynamicSegments: [],
  setDynamicSegments: () => {},
});

export function BreadcrumbProvider({ children }: { children: React.ReactNode }) {
  const [dynamicSegments, setDynamicSegments] = useState<BreadcrumbDynamicSegment[]>([]);

  const set = useCallback((segments: BreadcrumbDynamicSegment[]) => {
    setDynamicSegments(segments);
  }, []);

  return (
    <BreadcrumbContext.Provider value={{ dynamicSegments, setDynamicSegments: set }}>
      {children}
    </BreadcrumbContext.Provider>
  );
}

export function useBreadcrumbContext() {
  return useContext(BreadcrumbContext);
}

export function BreadcrumbUpdater({ label, href }: { label: string; href: string }) {
  const { setDynamicSegments } = useBreadcrumbContext();

  useEffect(() => {
    setDynamicSegments(label ? [{ label, href }] : []);
    return () => setDynamicSegments([]);
  }, [label, href, setDynamicSegments]);

  return null;
}
