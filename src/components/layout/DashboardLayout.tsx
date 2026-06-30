'use client';

import { usePathname } from 'next/navigation';
import React from 'react';
import { AppSidebar } from '@/components/app-sidebar';
import { AppSearch } from '@/components/layout/app-search';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Separator } from '@/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';

export function DashboardLayout({
  children,
  fullWidth = false,
}: {
  children: React.ReactNode;
  fullWidth?: boolean;
}) {
  const pathname = usePathname();

  const segments = pathname.split('/').filter(Boolean);

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <Breadcrumb>
              <BreadcrumbList>
                {segments.map((segment, index) => {
                  const href = `/${segments.slice(0, index + 1).join('/')}`;
                  const isLast = index === segments.length - 1;
                  return (
                    <React.Fragment key={segment}>
                      {index > 0 && <BreadcrumbSeparator className="hidden md:block" />}
                      <BreadcrumbItem
                        className={index < segments.length - 1 ? 'hidden md:block' : ''}
                      >
                        {isLast ? (
                          <BreadcrumbPage className="capitalize">{segment}</BreadcrumbPage>
                        ) : (
                          <BreadcrumbLink href={href} className="capitalize">
                            {segment}
                          </BreadcrumbLink>
                        )}
                      </BreadcrumbItem>
                    </React.Fragment>
                  );
                })}
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>
        <div className="flex flex-1 flex-col min-h-0">
          <main
            className={cn(
              'flex-1 min-h-0 overflow-y-auto scrollbar-gutter-stable',
              fullWidth ? 'flex flex-col' : 'p-content',
            )}
          >
            {children}
          </main>
        </div>
      </SidebarInset>
      <AppSearch />
    </SidebarProvider>
  );
}
