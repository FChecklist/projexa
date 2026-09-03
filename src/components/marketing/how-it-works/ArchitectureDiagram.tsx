import {
  GanttChartSquare, Palette, Calculator, Warehouse, TrendingUp,
  UserCog, ShieldAlert, Library,
} from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { MarketingLocaleProps } from "../marketing-locale";
import { Reveal } from "../Reveal";

// Original hub-and-spoke visual (CSS only, no diagram library): the center
// node is VERIDIAN AI OS -- the coordination core -- with the 8 real module
// categories from the catalog (src/components/marketing/ModuleCatalogSection.tsx)
// as spokes. Category titles/icons are kept identical to that section so
// the same real module names appear consistently across the site.
const SPOKES = [
  { key: "execution", icon: GanttChartSquare },
  { key: "interior", icon: Palette },
  { key: "finance", icon: Calculator },
  { key: "procurement", icon: Warehouse },
  { key: "sales", icon: TrendingUp },
  { key: "people", icon: UserCog },
  { key: "governance", icon: ShieldAlert },
  { key: "knowledge", icon: Library },
] as const;

export async function ArchitectureDiagram({ locale }: MarketingLocaleProps) {
  const t = await getTranslations({ locale, namespace: "Marketing.howItWorks.architecture" });
  const tCat = await getTranslations({ locale, namespace: "Marketing.moduleCatalog.categories" });

  return (
    <section className="border-b border-border bg-background py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-primary">{t("eyebrow")}</p>
          <h2 className="mt-3 font-heading text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            {t("heading")}
          </h2>
          <p className="mt-4 text-balance text-lg leading-relaxed text-muted-foreground">
            {t("subhead")}
          </p>
        </Reveal>

        <Reveal delay={100} className="mt-14">
          {/* Hub */}
          <div className="mx-auto w-fit max-w-xs rounded-2xl border-2 border-px-orange bg-px-ink px-6 py-4 text-center shadow-orange sm:max-w-sm">
            <p className="font-heading text-sm font-semibold text-white sm:text-base">{t("core")}</p>
          </div>

          {/* Trunk line */}
          <div className="mx-auto h-8 w-px bg-border" aria-hidden />
          <div className="mx-auto h-px w-full max-w-4xl bg-border" aria-hidden />

          {/* Spokes */}
          <div className="mx-auto grid max-w-4xl grid-cols-2 gap-x-4 gap-y-8 pt-8 sm:grid-cols-4">
            {SPOKES.map((spoke) => (
              <div key={spoke.key} className="flex flex-col items-center gap-2 text-center">
                <div className="h-6 w-px bg-border" aria-hidden />
                <div className="flex h-full w-full flex-col items-center gap-2 rounded-xl border border-border bg-card p-3.5 shadow-card">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <spoke.icon className="h-4 w-4" />
                  </div>
                  <p className="text-xs font-semibold leading-snug text-foreground">{tCat(`${spoke.key}.title`)}</p>
                </div>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
