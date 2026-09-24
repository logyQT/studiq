'use client';

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@studiq/ui';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
export type NavItem = {
  titleKey: string;
  href: string;
  icon?: LucideIcon;
  children?: { titleKey: string; href: string }[];
  feature?: string;
  badge?: number;
};

export function NavMain({
  items,
  label,
  activeHref,
}: {
  items: NavItem[];
  label: string;
  activeHref: string | null;
}) {
  const pathname = usePathname();
  const t = useTranslations('DashboardLayout');

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{t(label)}</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => {
          if (item.children) {
            const isParentActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Collapsible
                key={item.titleKey}
                asChild
                defaultOpen={pathname.startsWith(item.href)}
                className="group/collapsible"
              >
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton
                      tooltip={t(item.titleKey)}
                      isActive={isParentActive}
                      className="data-[active=true]:bg-[var(--brand-accent-sidebar)]"
                    >
                      {item.icon && <item.icon />}
                      <span>{t(item.titleKey)}</span>
                      <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      {item.children.map((child) => {
                        const isChildActive =
                          pathname === child.href || pathname.startsWith(`${child.href}/`);
                        return (
                          <SidebarMenuSubItem key={child.titleKey}>
                            <SidebarMenuSubButton
                              asChild
                              isActive={isChildActive}
                              className="data-[active=true]:bg-[var(--brand-accent-sidebar)]"
                            >
                              <Link href={child.href}>
                                <span>{t(child.titleKey)}</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        );
                      })}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>
            );
          }

          const isActive = item.href === activeHref;
          return (
            <SidebarMenuItem key={item.titleKey}>
              <SidebarMenuButton
                asChild
                isActive={isActive}
                tooltip={t(item.titleKey)}
                className="data-[active=true]:bg-[var(--brand-accent-sidebar)]"
              >
                <Link href={item.href}>
                  {item.icon && <item.icon />}
                  <span className="flex-1">{t(item.titleKey)}</span>
                  {!!item.badge && (
                    <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-semibold text-white">
                      {item.badge > 99 ? '99+' : item.badge}
                    </span>
                  )}
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}
