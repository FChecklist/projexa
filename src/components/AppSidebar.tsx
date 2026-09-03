"use client";

import Image from "next/image";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  LayoutDashboard, FileText, ClipboardList, BookOpen, Users, Package,
  Building2, Wallet, Receipt, Target, BarChart3, Bot, FolderOpen, Settings, GanttChartSquare,
  MessageCircleQuestion, FileCheck2, ListChecks, FileSignature, Palette, Sofa, LayoutPanelLeft,
  CalendarClock, ShieldCheck, UserCog, IdCard, Banknote, Briefcase,
  TrendingUp, UserPlus, Handshake, FileSpreadsheet, ShoppingCart, Contact2,
  ShieldAlert, Calculator, ReceiptText, NotebookText, Library, Warehouse, ClipboardCheck,
  Clock,
} from "lucide-react";
import { AppSidebar as SharedAppSidebar, type NavItem as SharedNavItem, type NavSection as SharedNavSection, type MiddleColumnToggle } from "@fchecklist/veridian-ui-kit/shell";
import { filterShippedNav } from "@/lib/nav-routes";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Suspense, useEffect, useState } from "react";
import { ProjectSwitcher } from "@/components/ProjectSwitcher";

// `labelKey`/`titleKey` are keys into the "Nav" namespace of messages/*.json
// (see messages/en.json's Nav.items / Nav.sections) -- PLATFORM-01 Wave 2
// (Workstream 5, i18n) reference pattern: this array is module-scope data,
// outside any component, so it cannot call useTranslations() itself (hooks
// only work inside components) -- it carries translation keys, and the
// actual t() lookups happen in SidebarInner below, which is a component.
export type NavItem = { labelKey: string; href: string; icon: React.ComponentType<{ className?: string }> };
export type NavSection = { titleKey: string | null; items: NavItem[] };

const NAV_SECTIONS: NavSection[] = [
  {
    titleKey: "sections.overview",
    items: [
      { labelKey: "items.dashboard", href: "/dashboard", icon: LayoutDashboard },
      { labelKey: "items.companyDashboard", href: "/dashboard/hierarchy", icon: Building2 },
      { labelKey: "items.projectsOverview", href: "/dashboard/overview", icon: BarChart3 },
      // R67 D-69 (audit R-261/R-300): the Projects LIST. Projects were the one
      // entity every other entity nests under that had no landing of its own --
      // only a card at the bottom of the home dashboard and a cycling switcher
      // in the top rail, neither of which is a list you can filter or export.
      { labelKey: "items.projects", href: "/projects", icon: FolderOpen },
    ],
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
      { labelKey: "items.drawings", href: "/drawings", icon: LayoutPanelLeft },
      { labelKey: "items.moms", href: "/moms", icon: NotebookText },
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
      // R67 WS-H (item H-01): the Design Studio joins the DESIGN group beside
      // Mood Boards, FF&E Specification and Floor Plans. Its Review and Cost
      // analysis tabs are deliberately NOT separate nav entries -- see
      // nav-routes.test.ts's allowlist for that reasoning.
      { labelKey: "items.designStudio", href: "/design-studio", icon: Clock },
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
      // R52 / R48_NAV_OMITS_LIVE_MODULE_ROUTE_01: /site-materials is a live,
      // fully-rendering module (HTTP 200, its own "Site Materials" heading,
      // three working tabs) that had no nav entry at all, so it could only be
      // opened by typing the URL -- a direct C01 REACHABLE failure. It is the
      // mirror of the unwired-pill problem this file already guards against:
      // a route with no nav item in front of it, rather than a nav item with
      // no route behind it. The test file now asserts BOTH directions.
      { labelKey: "items.siteMaterials", href: "/site-materials", icon: Package },
      { labelKey: "items.inventory", href: "/inventory", icon: Warehouse },
      { labelKey: "items.vendors", href: "/vendors", icon: Building2 },
      { labelKey: "items.procurement", href: "/procurement", icon: ClipboardCheck },
      { labelKey: "items.purchaseOrders", href: "/purchase-orders", icon: ClipboardCheck },
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
      // R67 D-62 (audit R-202): "Budgets" in a project manager's sidebar has to
      // mean the PROJECT's budget -- a percent and a vendor amount per BOQ line,
      // which is what Sumeet's own budget sheet is. It used to open the ERP's
      // fiscal-year budget, a screen that cannot save anything until a finance
      // team has created a fiscal year and a chart of accounts, so the one door
      // marked Budgets was a dead end for the person most likely to open it.
      // The ERP budget still exists, at /finance/budgets, reached from the
      // project dashboard's own "Budget vs Actual" tile (and from VERIDIAN's ERP
      // module, where it belongs) -- see nav-routes.test.ts's allowlist entry.
      { labelKey: "items.budgets", href: "/scope?tab=budget", icon: Wallet },
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

// R-80/R-81 ("ONE full pill path works end to end" / "NO visible pill may be
// unwired -- HIDE, do not wire"). The single gate every sidebar pill passes
// through: an entry whose href has no matching src/app/**/page.tsx is dropped
// here, and a section left empty by that drop is dropped with it. Filtering
// the DATA once at module scope (rather than adding a condition to the render
// path) means there is exactly one place a reviewer has to look to know what
// the sidebar can possibly show, and no code path that can bypass it.
//
// Nothing is deleted by this: an entry that disappears is hidden, not removed
// from NAV_SECTIONS above, and it comes back by itself the moment its page
// ships. See src/lib/nav-routes.ts for the shipped-route registry and the
// test that keeps that registry honest against the real filesystem.
//
// MEASURED as of 2026-08-26: NAV_SECTIONS declared 46 entries (three
// independent counts agreed -- 46 `href:` keys, 46 `labelKey:` keys, and 46
// Nav.items keys in messages/en.json), and all 46 resolved to a real page, so
// this filter hid 0 of 46. R52 added the 47th, /site-materials, which was a
// live module with no nav entry (R48_NAV_OMITS_LIVE_MODULE_ROUTE_01); the
// three counts are 47 each now and the filter still hides 0. It is a standing guard against the
// next unwired entry, not a mass cull -- the honest finding is that PROJEXA's
// SIDEBAR was never the source of the unwired-pill risk (see
// veri-chat-context.tsx's fetchCapabilityTree for where that risk actually
// lives).
// R52: exported so HOME's module directory renders the SAME groups from the
// SAME filtered source. M24 deletes the left rail and makes HOME the grouped
// module directory that replaces it -- if the directory rebuilt its own list,
// the two would drift and a module could exist in one and not the other.
export const VISIBLE_NAV_SECTIONS: NavSection[] = filterShippedNav(NAV_SECTIONS);

// veridian-ui-kit migration: the shared AppSidebar component owns only the
// generic nav-sections shell/style (logo row + scrollable section list, per
// that package's own README scope boundary) -- PROJEXA's real nav DATA
// (NAV_SECTIONS above) is built here and converted to the shared
// component's NavItem/NavSection shape.
//
// `projectId`, when present, is threaded onto every nav link's href so that
// navigating between the project-scoped pages (RFIs, Scope, Labour, ...)
// via the sidebar keeps showing the same selected project instead of
// silently reverting to the org's first project on every click -- same real
// behavior as before this migration. Disclosed tradeoff: the shared
// component's active-highlight check is `pathname === href || pathname
// .startsWith(href + "/")`, with no query-string awareness, so once a
// non-default project is selected, every project-scoped nav item still
// navigates correctly but stops visually highlighting as active (matches
// the same class of tradeoff veridian-ui-kit's own README/compliance-
// tracker adoption already accepted for its own query-string-routed items).
function toSharedItem(href: string, label: string, icon: React.ComponentType<{ className?: string }>): SharedNavItem {
  return { href, label, icon: <SidebarIcon icon={icon} /> };
}

function SidebarIcon({ icon: Icon }: { icon: React.ComponentType<{ className?: string }> }) {
  return <Icon className="h-4 w-4 shrink-0" />;
}

function buildSharedSections(t: ReturnType<typeof useTranslations>, projectId: string | null): SharedNavSection[] {
  const suffix = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
  return VISIBLE_NAV_SECTIONS.map((section) => ({
    label: section.titleKey ? t(section.titleKey) : undefined,
    items: section.items.map((item) => toSharedItem(item.href + suffix, t(item.labelKey), item.icon)),
  }));
}

// ProjectSwitcher sits above the shared component (the shared AppSidebar has
// no slot between its logo row and nav list, unlike this repo's previous
// hand-rolled layout) -- a disclosed, real-but-cosmetic reordering: the
// PROJEXA wordmark (rendered by the shared component itself) now appears
// below the switcher instead of above it. Real behavior (which project's
// data the 17 project-scoped pages render) is unaffected.
function SidebarInner({ pathname, projectId, middleColumnToggle }: { pathname: string; projectId: string | null; middleColumnToggle?: MiddleColumnToggle }) {
  const t = useTranslations("Nav");
  const sections = buildSharedSections(t, projectId);
  const logo = <Image src="/logo-mark.svg" alt="PROJEXA" width={28} height={28} className="rounded-sm" />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ProjectSwitcher pathname={pathname} projectId={projectId} />
      <div className="flex min-h-0 flex-1">
        <SharedAppSidebar sections={sections} logo={logo} productName="PROJEXA" collapsed={false} middleColumnToggle={middleColumnToggle} />
      </div>
    </div>
  );
}

// Isolates the useSearchParams() call behind a Suspense boundary (Next.js
// requirement) so it doesn't force the whole app shell into client-only
// rendering. Falls back to no project param on first paint; hydration
// fills in the real value immediately after.
function SidebarInnerWithProject({ pathname, middleColumnToggle }: { pathname: string; middleColumnToggle?: MiddleColumnToggle }) {
  const searchParams = useSearchParams();
  return <SidebarInner pathname={pathname} projectId={searchParams.get("projectId")} middleColumnToggle={middleColumnToggle} />;
}

// Desktop persistent sidebar -- mounted exactly once, from (app)/layout.tsx.
// Conditionally rendered (via the `sidebar` prop passed to AppShellFrame in
// layout.tsx being `null` when collapsed) rather than width-toggled: the
// shared component sets its own min-width internally, which would otherwise
// fight a wrapper's width:0 (see VERI_CHAT_COMPOSER_DESIGN.md).
//
// `middleColumnToggle` (Owner directive 2026-08-16): shows/hides the middle
// VERI Chat assistant column. Passed straight through to the shared
// AppSidebar's `middleColumnToggle` prop, which renders it as a rail button
// structurally inside this LEFT column -- previously this control lived in
// AppTopbar's header (see (app)/layout.tsx's ShellBody for the real
// panelCollapsed state this now drives, and AppTopbar.tsx's own header
// comment for why it moved). `label` is set to "VERI Chat" so the
// button's title/aria-label read "Show VERI Chat" / "Hide VERI Chat",
// matching the product's own name for this panel everywhere else in the
// app (see VeriChatPanel, VERI_CHAT_COMPOSER_DESIGN.md).
export function AppSidebar({ middleColumnToggle }: { middleColumnToggle?: Omit<MiddleColumnToggle, "label"> } = {}) {
  const pathname = usePathname();
  const resolvedToggle: MiddleColumnToggle | undefined = middleColumnToggle && { ...middleColumnToggle, label: "VERI Chat" };

  return (
    <aside className="hidden h-full lg:block">
      <Suspense fallback={<SidebarInner pathname={pathname} projectId={null} middleColumnToggle={resolvedToggle} />}>
        <SidebarInnerWithProject pathname={pathname} middleColumnToggle={resolvedToggle} />
      </Suspense>
    </aside>
  );
}

// Mobile hamburger + drawer -- mounted exactly once, from AppTopbar (so it
// sits inside the header row itself, same real placement as before this
// migration). Deliberately its own export, independent of the desktop
// sidebar's collapsed state (see (app)/layout.tsx's ShellBody): a mobile
// user must always be able to reach this trigger regardless of whether the
// desktop sidebar happens to be collapsed.
//
// Auto-closes on navigation via a pathname effect, not a per-Link onClick --
// the shared AppSidebar's NavItem has no onClick slot to hook (its Link
// components are fully internal to that component), and AppTopbar (and thus
// this trigger) is now mounted once from layout.tsx instead of remounting
// per page, so the Sheet's open state would otherwise persist across
// navigations instead of resetting the way it used to.
export function MobileSidebarTrigger() {
  const pathname = usePathname();
  const t = useTranslations("Nav");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="veri-icon-btn lg:hidden">
          <LayoutDashboard className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[260px] border-none p-0">
        <SheetHeader className="sr-only">
          <SheetTitle>{t("navigationLabel")}</SheetTitle>
        </SheetHeader>
        <Suspense fallback={<SidebarInner pathname={pathname} projectId={null} />}>
          <SidebarInnerWithProject pathname={pathname} />
        </Suspense>
      </SheetContent>
    </Sheet>
  );
}
