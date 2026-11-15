'use client';

import { Separator, SidebarInset, SidebarProvider, SidebarTrigger } from '@studiq/ui';
import type React from 'react';
import { AppSidebar } from '@/components/app-sidebar';
import { AppSearch } from '@/components/layout/app-search';
import { DashboardBreadcrumbs } from '@/components/layout/DashboardBreadcrumbs';
import { GlobalShortcuts, ShortcutsButton } from '@/components/layout/global-shortcuts';
import { NotificationBell } from '@/components/layout/notification-bell';
import { BreadcrumbProvider } from '@/components/providers/BreadcrumbProvider';
import { cn } from '@/lib/utils';

export function DashboardLayout({
  children,
  fullWidth = false,
}: {
  children: React.ReactNode;
  fullWidth?: boolean;
}) {
  return (
    <BreadcrumbProvider>
      <SidebarProvider style={{ maxHeight: '100dvh' }}>
        <AppSidebar />
        <SidebarInset className="bg-paper-grain">
          <header className="print:hidden flex h-14 shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
            <div className="flex items-center gap-2 px-4">
              <SidebarTrigger className="-ml-1" />
              <Separator orientation="vertical" className="mr-2 h-4" />
              <DashboardBreadcrumbs />
            </div>
            <div className="ml-auto flex items-center gap-1 px-4">
              <ShortcutsButton />
              <NotificationBell />
            </div>
          </header>
          <div className="flex flex-1 flex-col min-h-0">
            {/*
              `relative` makes this scrollport the containing block for
              absolutely positioned page content. Without it the nearest one is
              the 100dvh inset, so a stray box (Radix renders the switch's bubble
              input as an absolute sibling) becomes document scroll and the paper
              surface ends on a seam.
            */}
            <main
              className={cn(
                'relative flex-1 min-h-0 overflow-y-auto scrollbar-gutter-stable',
                fullWidth ? 'flex flex-col' : 'p-content',
              )}
            >
              {children}
            </main>
          </div>
        </SidebarInset>
        <AppSearch />
        <GlobalShortcuts />
      </SidebarProvider>
    </BreadcrumbProvider>
  );
}
