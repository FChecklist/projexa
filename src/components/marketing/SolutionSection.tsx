import {
  GanttChartSquare, FileText, BookOpen, MessageCircleQuestion,
  FileSignature, Wallet, Bot, ClipboardList, FileCheck2,
} from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { MarketingLocaleProps } from "./marketing-locale";
import { Reveal } from "./Reveal";

const MODULE_KEYS = [
  { key: "schedule", icon: GanttChartSquare },
  { key: "scope", icon: FileText },
  { key: "workProgress", icon: ClipboardList },
  { key: "siteDiary", icon: BookOpen },
  { key: "rfisSubmittals", icon: MessageCircleQuestion },
  { key: "punchList", icon: FileCheck2 },
  { key: "changeOrders", icon: FileSignature },
  { key: "budgets", icon: Wallet },
  { key: "veri", icon: Bot },
] as const;

const MORE_MODULE_KEYS = [
  "moodBoards", "ffe", "floorPlans", "manpower", "materials", "vendors", "documents", "kpis", "reports",
] as const;

// English gets the "good news" band merged from the v4 standalone preview
// (website/projexa-ai-com-v4/index.html, S12.A.A3/A4): all ten problems are
// one hand-off problem, three role good-news cards, the 15-minutes-a-day
// method, and three outcome tiles. Hindi keeps this section's original
// module-teaser content untouched, per the S12.A ruling -- the deeper module
// catalog is still available to every visitor, in both locales, in
// ModuleCatalogSection right after this one.
const ROLE_KEYS = ["owner", "pm", "site"] as const;
const OUTCOME_KEYS = ["recovered", "approvals", "groupChats"] as const;

export async function SolutionSection({ locale }: MarketingLocaleProps) {
  const t = await getTranslations({ locale, namespace: "Marketing.solution" });

  if (locale === "en") {
    return (
      <section className="border-b border-border bg-muted/40 py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <Reveal className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold uppercase tracking-widest text-primary">{t("goodNews.eyebrow")}</p>
            <h2 className="mt-3 font-heading text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              {t("goodNews.heading")}
            </h2>
            <p className="mt-4 text-balance text-lg text-muted-foreground">
              {t("goodNews.subhead")}
            </p>
          </Reveal>

          <div className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-3">
            {ROLE_KEYS.map((role, i) => (
              <Reveal key={role} delay={i * 90}>
                <div className="h-full rounded-2xl border border-border bg-card p-6 shadow-card">
                  <p className="text-xs font-semibold uppercase tracking-widest text-primary">{t(`goodNews.roles.${role}.label`)}</p>
                  <h3 className="mt-2 font-heading text-lg font-semibold text-foreground">{t(`goodNews.roles.${role}.title`)}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(`goodNews.roles.${role}.body`)}</p>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal delay={100} className="mt-8 max-w-2xl rounded-2xl border-l-4 border-primary bg-card p-6 shadow-card">
            <p className="font-heading text-lg leading-snug text-foreground">{t("goodNews.method.headline")}</p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t("goodNews.method.small")}</p>
          </Reveal>

          <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-3">
            {OUTCOME_KEYS.map((outcome, i) => (
              <Reveal key={outcome} delay={i * 90}>
                <div className="h-full rounded-2xl border border-border bg-card p-6 text-center shadow-card">
                  <p className="font-heading text-3xl font-semibold text-foreground">{t(`goodNews.outcomes.${outcome}.value`)}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{t(`goodNews.outcomes.${outcome}.label`)}</p>
                  <p className="mt-1 text-xs text-muted-foreground/70">{t(`goodNews.outcomes.${outcome}.note`)}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="border-b border-border bg-muted/40 py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-primary">{t("eyebrow")}</p>
          <h2 className="mt-3 font-heading text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            {t("heading")}
          </h2>
          <p className="mt-4 text-balance text-lg text-muted-foreground">
            {t("subhead")}
          </p>
        </Reveal>

        <div className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {MODULE_KEYS.map((mod, i) => (
            <Reveal key={mod.key} delay={(i % 3) * 80}>
              <div className="group h-full rounded-2xl border border-border bg-card p-6 shadow-card transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-lg">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                  <mod.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 font-heading text-base font-semibold text-foreground">{t(`modules.${mod.key}.title`)}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(`modules.${mod.key}.body`)}</p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={120} className="mt-10 flex flex-wrap items-center justify-center gap-2">
          <span className="text-sm text-muted-foreground">{t("plusLabel")}</span>
          {MORE_MODULE_KEYS.map((key) => (
            <span
              key={key}
              className="rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground"
            >
              {t(`more.${key}`)}
            </span>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
