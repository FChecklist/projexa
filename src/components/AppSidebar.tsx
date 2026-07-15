"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  LayoutDashboard, FileText, ClipboardList, BookOpen, Users, Package,
  Building2, Wallet, Receipt, Target, BarChart3, Bot, FolderOpen, Settings, GanttChartSquare,
  MessageCircleQuestion, FileCheck2, ListChecks, FileSignature, Palette, Sofa, LayoutPanelLeft,
  CalendarClock, ShieldCheck, UserCog, IdCard, Banknote, Briefcase,
  TrendingUp, UserPlus, Handshake, FileSpreadsheet, ShoppingCart, Contact2,
  ShieldAlert, Calculator, ReceiptText, NotebookText, Library,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Suspense, useState } from "react";
import { cn } from "@/lib/utils";
import { useSidebar } from "@/components/sidebar-context";
import { ProjectSwitcher } from "@/components/ProjectSwitcher";

// `labelKey`/`titleKey` are keys into the "Nav" namespace of messages/*.json
// (see messages/en.json's Nav.items / Nav.sections) -- PLATFORM-01 Wave 2
// (Workstream 5, i18n) reference pattern: this array is module-scope data,
// outside any component, so it cannot call useTranslations() itself (hooks
// only work inside components) -- it carries translation keys, and the
// actual t() lookups happen in SidebarContent below, which is a component.
type NavItem = { labelKey: string; href: string; icon: React.ComponentType<{ className?: string }> };
type NavSection = { titleKey: string | null; items: NavItem[] };

const NAV_SECTIONS: NavSection[] = [
  {
    titleKey: "sections.overview",
    items: [{ labelKey: "items.dashboard", href: "/dashboard", icon: LayoutDashboard }],
  },
  {
    titleKey: "sections.execution",
    items: [
      { labelKey: "items.schedule", href: "/schedule", icon: GanttChartSquare },
      { labelKey: "items.meetings", href: "/meetings", icon: CalendarClock },
      { labelKey: "items.scope", href: "/scope", icon: FileText },
      { labelKey: "items.workProgress", href: "/work-progress", icon: ClipboardList },
      { labelKey: "items.siteDiary", href: "/site-diary", icon: BookOpen },
      { labelKey: "items.documents", href: "/documents", icon: FolderOpen },
      // Priority 17 Wave 1: per-project working notes over
      // pms-wiki-service.ts -- distinct from Documents (file storage) and
      // from the org-wide Knowledge Base below (see KnowledgeBaseClient.tsx).
      { labelKey: "items.wiki", href: "/wiki", icon: NotebookText },
      { labelKey: "items.permits", href: "/permits", icon: ShieldCheck },
    ],
  },
  {
    titleKey: "sections.field",
    items: [
      { labelKey: "items.rfis", href: "/rfis", icon: MessageCircleQuestion },
      { labelKey: "items.submittals", href: "/submittals", icon: FileCheck2 },
      { labelKey: "items.punchList", href: "/punch-list", icon: ListChecks },
      { labelKey: "items.changeOrders", href: "/change-orders", icon: FileSignature },
    ],
  },
  {
    titleKey: "sections.design",
    items: [
      { labelKey: "items.moodBoards", href: "/mood-boards", icon: Palette },
      { labelKey: "items.ffe", href: "/ffe", icon: Sofa },
      { labelKey: "items.floorPlans", href: "/floor-plans", icon: LayoutPanelLeft },
    ],
  },
  {
    titleKey: "sections.resources",
    items: [
      { labelKey: "items.labour", href: "/labour", icon: Users },
      { labelKey: "items.materials", href: "/materials", icon: Package },
      { labelKey: "items.vendors", href: "/vendors", icon: Building2 },
    ],
  },
  {
    titleKey: "sections.sales",
    items: [
      { labelKey: "items.salesDashboard", href: "/sales", icon: TrendingUp },
      { labelKey: "items.leads", href: "/sales/leads", icon: UserPlus },
      { labelKey: "items.opportunities", href: "/sales/opportunities", icon: Handshake },
      { labelKey: "items.quotations", href: "/quotations", icon: FileSpreadsheet },
      { labelKey: "items.salesOrders", href: "/sales-orders", icon: ShoppingCart },
      { labelKey: "items.customers", href: "/customers", icon: Contact2 },
    ],
  },
  {
    titleKey: "sections.grc",
    items: [
      { labelKey: "items.grc", href: "/grc", icon: ShieldAlert },
    ],
  },
  {
    titleKey: "sections.finance",
    items: [
      { labelKey: "items.budgets", href: "/budgets", icon: Wallet },
      { labelKey: "items.expenses", href: "/expenses", icon: Receipt },
      { labelKey: "items.accounting", href: "/accounting", icon: Calculator },
      { labelKey: "items.invoices", href: "/invoices", icon: ReceiptText },
    ],
  },
  {
    titleKey: "sections.hr",
    items: [
      { labelKey: "items.hrDashboard", href: "/hr", icon: UserCog },
      { labelKey: "items.employees", href: "/employees", icon: IdCard },
      { labelKey: "items.payroll", href: "/payroll", icon: Banknote },
      { labelKey: "items.recruitment", href: "/recruitment", icon: Briefcase },
    ],
  },
  {
    titleKey: "sections.intelligence",
    items: [
      { labelKey: "items.kpis", href: "/kpis", icon: Target },
      { labelKey: "items.reports", href: "/reports", icon: BarChart3 },
      { labelKey: "items.aiCopilot", href: "/copilot", icon: Bot },
      // Priority 17 Wave 1: org-wide reference material over
      // knowledge-base-service.ts -- not project-scoped, unlike every other
      // link in this sidebar (see KnowledgeBaseClient.tsx's own header).
      { labelKey: "items.knowledgeBase", href: "/knowledge-base", icon: Library },
    ],
  },
  {
    titleKey: null,
    items: [{ labelKey: "items.settings", href: "/settings", icon: Settings }],
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
  const t = useTranslations("Nav");
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
          <div key={section.titleKey ?? "bottom"} className="mb-5">
            {section.titleKey && (
              <div className="px-2 pb-2 text-[11px] font-semibold tracking-wider text-px-muted">{t(section.titleKey)}</div>
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
                    <span className="truncate">{t(item.labelKey)}</span>
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
  const t = useTranslations("Nav");
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
            <SheetTitle>{t("navigationLabel")}</SheetTitle>
          </SheetHeader>
          <Suspense fallback={<SidebarContent pathname={pathname} projectId={null} onNavigate={() => setOpen(false)} />}>
            <SidebarContentWithProject pathname={pathname} onNavigate={() => setOpen(false)} />
          </Suspense>
        </SheetContent>
      </Sheet>
    </>
  );
}
