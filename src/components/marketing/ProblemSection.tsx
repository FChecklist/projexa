import { MessageCircleQuestion, CalendarClock, FolderX, Repeat } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { MarketingLocaleProps } from "./marketing-locale";
import { Reveal } from "./Reveal";

const PAIN_POINT_KEYS = [
  { key: "commsScattered", icon: MessageCircleQuestion },
  { key: "deadlinesSlip", icon: CalendarClock },
  { key: "noSourceOfTruth", icon: FolderX },
  { key: "rework", icon: Repeat },
] as const;

export async function ProblemSection({ locale }: MarketingLocaleProps) {
  const t = await getTranslations({ locale, namespace: "Marketing.problem" });

  return (
    <section id="problem" className="border-b border-border bg-background py-20 sm:py-28">
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

        <div className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {PAIN_POINT_KEYS.map((point, i) => (
            <Reveal key={point.key} delay={i * 80}>
              <div className="h-full rounded-2xl border border-border bg-card p-6 shadow-card transition-transform duration-300 hover:-translate-y-1">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
                  <point.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 font-heading text-base font-semibold text-foreground">{t(`points.${point.key}.title`)}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(`points.${point.key}.body`)}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
