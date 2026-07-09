"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, FileText, ClipboardList, BookOpen, Users, Package,
  Building2, Wallet, Receipt, Target, BarChart3, Bot, FolderOpen, Settings,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useSidebar } from "@/components/sidebar-context";

type NavItem = { label: string; href: string; icon: React.ElementType };
type NavSection = { title: string; items: NavItem[] };

const NAV_SECTIONS: NavSection[] = [
  {
    title: "OVERVIEW",
    items: [{ label: "Dashboard", href: "/dashboard", icon: LayoutDashboard }],
  },
  {
    title: "EXECUTION",
    items: [
      { label: "Scope of Work (BOQ)", href: "/scope", icon: FileText },
      { label: "Work Progress", href: "/work-progress", icon: ClipboardList },
      { label: "Site Diary", href: "/site-diary", icon: BookOpen },
      { label: "Documents", href: "/documents", icon: FolderOpen },
    ],
  },
  {
    title: "RESOURCES",
    items: [
      { label: "Manpower & Attendance", href: "/labour", icon: Users },
      { label: "Materials", href: "/materials", icon: Package },
      { label: "Vendors", href: "/vendors", icon: Building2 },
    ],
  },
  {
    title: "FINANCE",
    items: [
      { label: "Budgets", href: "/budgets", icon: Wallet },
      { label: "Expenses", href: "/expenses", icon: Receipt },
    ],
  },
  {
    title: "INTELLIGENCE",
    items: [
      { label: "KPIs", href: "/kpis", icon: Target },
      { label: "Reports", href: "/reports", icon: BarChart3 },
      { label: "AI Copilot", href: "/copilot", icon: Bot },
    ],
  },
  {
    title: "",
    items: [{ label: "Settings", href: "/settings", icon: Settings }],
  },
];

function SidebarContent({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col bg-px-ink text-px-cloud">
      <div className="flex items-center gap-2 px-5 py-5">
        <Image src="/logo-mark.svg" alt="PROJEXA" width={28} height={28} />
        <span className="font-heading text-lg font-semibold text-white">PROJEXA</span>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pb-6">
        {NAV_SECTIONS.map((section) => (
          <div key={section.title || "bottom"} className="mb-5">
            {section.title && (
              <div className="px-2 pb-2 text-[11px] font-semibold tracking-wider text-px-muted">{section.title}</div>
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + "/");
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                      active ? "bg-px-orange text-white" : "text-px-cloud2 hover:bg-px-ink2 hover:text-white"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </div>
  );
}

export function AppSidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { collapsed } = useSidebar();

  return (
    <>
      {/* Desktop -- conditionally rendered rather than width-toggled:
          SidebarContent sets its own min-width internally, which would
          otherwise fight a wrapper's width:0 (see VERI_CHAT_COMPOSER_DESIGN.md). */}
      {!collapsed && (
        <aside className="hidden w-64 shrink-0 lg:block">
          <SidebarContent pathname={pathname} />
        </aside>
      )}

      {/* Mobile */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="lg:hidden">
            <LayoutDashboard className="h-5 w-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 border-none p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation</SheetTitle>
          </SheetHeader>
          <SidebarContent pathname={pathname} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </>
  );
}
