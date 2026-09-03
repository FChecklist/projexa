import {
  GanttChartSquare, Palette, Calculator, Warehouse, TrendingUp,
  UserCog, ShieldAlert, Library, Bot,
} from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { MarketingLocaleProps } from "./marketing-locale";
import { Reveal } from "./Reveal";

// Every item below was verified against this repo's real
// src/app/(app)/**/page.tsx route folders and src/components/AppSidebar.tsx
// nav labels before being listed here -- nothing here is a roadmap item
// presented as shipped. See the PR description for the honesty-check note
// (what was verified real vs. dropped).
const CATEGORIES = [
  {
    key: "execution",
    icon: GanttChartSquare,
    items: ["schedule", "scope", "workProgress", "siteDiary", "rfisSubmittals", "punchList", "changeOrders", "permits"],
  },
  {
    key: "interior",
    icon: Palette,
    items: ["moodBoards", "ffe", "floorPlans", "materials"],
  },
  {
    key: "finance",
    icon: Calculator,
    items: ["accounting", "budgets", "expenses", "invoices"],
  },
  {
    key: "procurement",
    icon: Warehouse,
    items: ["procurement", "purchaseOrders", "inventory", "vendors"],
  },
  {
    key: "sales",
    icon: TrendingUp,
    items: ["salesDashboard", "leads", "opportunities", "quotations", "salesOrders", "customers"],
  },
  {
    key: "people",
    icon: UserCog,
    items: ["hr", "employees", "payroll", "recruitment", "labour"],
  },
  {
    key: "governance",
    icon: ShieldAlert,
    items: ["riskCompliance", "riskRegister", "auditsFindings", "policies", "vendorRisk", "complianceRegister"],
  },
  {
    key: "knowledge",
    icon: Library,
    items: ["documents", "knowledgeBase", "wiki", "meetings"],
  },
] as const;

const CORE_ITEMS = ["veri", "reports", "kpis", "multiProject", "bilingual"] as const;

export async function ModuleCatalogSection({ locale }: MarketingLocaleProps) {
  const t = await getTranslations({ locale, namespace: "Marketing.moduleCatalog" });
  const tSystem = await getTranslations({ locale, namespace: "Marketing.system" });

  return (
    <section className="border-b border-border bg-background py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* "system" anchor: intro copy immediately preceding the catalog grid */}
        <Reveal id="system" className="mx-auto max-w-2xl scroll-mt-20 text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-primary">{tSystem("eyebrow")}</p>
          <h2 className="mt-3 font-heading text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            {tSystem("heading")}
          </h2>
          <p className="mt-4 text-balance text-lg leading-relaxed text-muted-foreground">
            {tSystem("body")}
          </p>
        </Reveal>

        {/* "modules" anchor: the categorized catalog grid itself */}
        <div id="modules" className="mt-14 scroll-mt-20">
          <Reveal className="mx-auto mb-10 max-w-2xl text-center">
            <h3 className="font-heading text-balance text-2xl font-semibold tracking-tight text-foreground">
              {t("heading")}
            </h3>
            <p className="mt-3 text-balance text-base leading-relaxed text-muted-foreground">
              {t("subhead")}
            </p>
          </Reveal>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {CATEGORIES.map((cat, i) => (
              <Reveal key={cat.key} delay={(i % 3) * 80}>
                <div className="h-full rounded-2xl border border-border bg-card p-6 shadow-card">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <cat.icon className="h-5 w-5" />
                  </div>
                  <h4 className="mt-4 font-heading text-base font-semibold text-foreground">
                    {t(`categories.${cat.key}.title`)}
                  </h4>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    {t(`categories.${cat.key}.body`)}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {cat.items.map((item) => (
                      <span
                        key={item}
                        className="rounded-full border border-border bg-muted/60 px-2.5 py-1 text-xs font-medium text-muted-foreground"
                      >
                        {t(`items.${item}`)}
                      </span>
                    ))}
                  </div>
                </div>
              </Reveal>
            ))}

            {/* The AI OS Core -- visually distinct dark card, cross-cutting
                platform capabilities rather than a single-domain category. */}
            <Reveal delay={240}>
              <div className="h-full rounded-2xl border border-white/10 bg-px-ink p-6 shadow-nav">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-px-orange/20 text-px-orange">
                  <Bot className="h-5 w-5" />
                </div>
                <h4 className="mt-4 font-heading text-base font-semibold text-white">
                  {t("categories.core.title")}
                </h4>
                <p className="mt-1.5 text-sm leading-relaxed text-px-cloud2">
                  {t("categories.core.body")}
                </p>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {CORE_ITEMS.map((item) => (
                    <span
                      key={item}
                      className="rounded-full border border-white/15 bg-white/[0.06] px-2.5 py-1 text-xs font-medium text-px-cloud2"
                    >
                      {t(`items.${item}`)}
                    </span>
                  ))}
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}
