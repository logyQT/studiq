'use client';

import { ChevronRight, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@/components/ui/sidebar';
export type NavItem = {
  titleKey: string;
  href: string;
  icon?: LucideIcon;
  children?: { titleKey: string; href: string }[];
  feature?: string;
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
            const isParentActive =
              pathname === item.href || pathname.startsWith(item.href + '/');
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
                          pathname === child.href ||
                          pathname.startsWith(child.href + '/');
                        return (
                          <SidebarMenuSubItem key={child.titleKey}>
                            <SidebarMenuSubButton asChild isActive={isChildActive}>
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
              <SidebarMenuButton asChild isActive={isActive} tooltip={t(item.titleKey)}>
                <Link href={item.href}>
                  {item.icon && <item.icon />}
                  <span>{t(item.titleKey)}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}
