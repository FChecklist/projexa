import { TrendingUp, Clock, AlertTriangle } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Reveal } from "./Reveal";

const REASON_KEYS = [
  { key: "deadline", icon: Clock },
  { key: "rework", icon: AlertTriangle },
  { key: "compound", icon: TrendingUp },
] as const;

export async function ROISection() {
  const t = await getTranslations("Marketing.roi");

  return (
    <section id="pays-for-itself" className="border-b border-border bg-muted/40 py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
          <Reveal>
            <p className="text-sm font-semibold uppercase tracking-widest text-primary">{t("eyebrow")}</p>
            <h2 className="mt-3 font-heading text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              {t("heading")}
            </h2>
            <p className="mt-4 text-balance text-lg leading-relaxed text-muted-foreground">
              {t("body")}
            </p>
            <div className="mt-8 rounded-2xl border border-primary/20 bg-primary/5 p-6">
              <p className="font-heading text-lg font-semibold text-foreground">
                {t("boxTitle")}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {t("boxBody")}
              </p>
            </div>
          </Reveal>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-1">
            {REASON_KEYS.map((reason, i) => (
              <Reveal key={reason.key} delay={i * 90}>
                <div className="flex gap-4 rounded-2xl border border-border bg-card p-6 shadow-card">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <reason.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-heading text-base font-semibold text-foreground">{t(`reasons.${reason.key}.title`)}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(`reasons.${reason.key}.body`)}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
