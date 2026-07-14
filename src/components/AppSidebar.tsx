"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  LayoutDashboard, FileText, ClipboardList, BookOpen, Users, Package,
  Building2, Wallet, Receipt, Target, BarChart3, Bot, FolderOpen, Settings, GanttChartSquare,
  MessageCircleQuestion, FileCheck2, ListChecks, FileSignature, Palette, Sofa, LayoutPanelLeft,
  CalendarClock, ShieldCheck, UserCog, IdCard, Banknote, Briefcase,
  TrendingUp, UserPlus, Handshake, FileSpreadsheet, ShoppingCart, Contact2,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Suspense, useState } from "react";
import { cn } from "@/lib/utils";
import { useSidebar } from "@/components/sidebar-context";
import { ProjectSwitcher } from "@/components/ProjectSwitcher";

type NavItem = { label: string; href: string; icon: React.ComponentType<{ className?: string }> };
type NavSection = { title: string; items: NavItem[] };

const NAV_SECTIONS: NavSection[] = [
  {
    title: "OVERVIEW",
    items: [{ label: "Dashboard", href: "/dashboard", icon: LayoutDashboard }],
  },
  {
    title: "EXECUTION",
    items: [
      { label: "Schedule", href: "/schedule", icon: GanttChartSquare },
      { label: "Meetings", href: "/meetings", icon: CalendarClock },
      { label: "Scope of Work (BOQ)", href: "/scope", icon: FileText },
      { label: "Work Progress", href: "/work-progress", icon: ClipboardList },
      { label: "Site Diary", href: "/site-diary", icon: BookOpen },
      { label: "Documents", href: "/documents", icon: FolderOpen },
      { label: "Permits", href: "/permits", icon: ShieldCheck },
    ],
  },
  {
    title: "FIELD",
    items: [
      { label: "RFIs", href: "/rfis", icon: MessageCircleQuestion },
      { label: "Submittals", href: "/submittals", icon: FileCheck2 },
      { label: "Punch List", href: "/punch-list", icon: ListChecks },
      { label: "Change Orders", href: "/change-orders", icon: FileSignature },
    ],
  },
  {
    title: "DESIGN",
    items: [
      { label: "Mood Boards", href: "/mood-boards", icon: Palette },
      { label: "FF&E Specification", href: "/ffe", icon: Sofa },
      { label: "Floor Plans", href: "/floor-plans", icon: LayoutPanelLeft },
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
    title: "SALES",
    items: [
      { label: "Sales Dashboard", href: "/sales", icon: TrendingUp },
      { label: "Leads", href: "/sales/leads", icon: UserPlus },
      { label: "Opportunities", href: "/sales/opportunities", icon: Handshake },
      { label: "Quotations", href: "/quotations", icon: FileSpreadsheet },
      { label: "Sales Orders", href: "/sales-orders", icon: ShoppingCart },
      { label: "Customers", href: "/customers", icon: Contact2 },
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
    title: "HR",
    items: [
      { label: "HR Dashboard", href: "/hr", icon: UserCog },
      { label: "Employees", href: "/employees", icon: IdCard },
      { label: "Payroll", href: "/payroll", icon: Banknote },
      { label: "Recruitment", href: "/recruitment", icon: Briefcase },
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

// `projectId`, when present, is threaded onto every nav link's href so that
// navigating between the project-scoped pages (RFIs, Scope, Labour, ...)
// via the sidebar keeps showing the same selected project instead of
// silently reverting to the org's first project on every click.
function SidebarContent({
  pathname,
  projectId,
  onNavigate,
}: {
  pathname: string;
  projectId: string | null;
  onNavigate?: () => void;
}) {
  const suffix = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";

  return (
    <div className="flex h-full flex-col bg-px-ink text-px-cloud">
      <div className="flex items-center gap-2 px-5 py-5">
        <Image src="/logo-mark.svg" alt="PROJEXA" width={28} height={28} />
        <span className="font-heading text-lg font-semibold text-white">PROJEXA</span>
      </div>
      <ProjectSwitcher pathname={pathname} projectId={projectId} />
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
                    href={item.href + suffix}
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

// Isolates the useSearchParams() call behind a Suspense boundary (Next.js
// requirement) so it doesn't force the whole app shell into client-only
// rendering. Falls back to no project param on first paint; hydration
// fills in the real value immediately after.
function SidebarContentWithProject({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const searchParams = useSearchParams();
  return <SidebarContent pathname={pathname} projectId={searchParams.get("projectId")} onNavigate={onNavigate} />;
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
          <Suspense fallback={<SidebarContent pathname={pathname} projectId={null} />}>
            <SidebarContentWithProject pathname={pathname} />
          </Suspense>
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
          <Suspense fallback={<SidebarContent pathname={pathname} projectId={null} onNavigate={() => setOpen(false)} />}>
            <SidebarContentWithProject pathname={pathname} onNavigate={() => setOpen(false)} />
          </Suspense>
        </SheetContent>
      </Sheet>
    </>
  );
}
