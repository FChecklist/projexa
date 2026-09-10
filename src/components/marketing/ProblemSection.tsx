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

// English gets the ten-problems-and-fixes ledger merged from the v4
// standalone preview (website/projexa-ai-com-v4/index.html, S12.A.A3/A4);
// Hindi keeps the original four-pain-point card set untouched, per the S12.A
// ruling -- these are ten DIFFERENT translation keys (tenProblems.items.p01
// .. p10), not a retranslation of the points.* keys above, so the /hi route
// never calls them and its rendered output does not change.
const TEN_PROBLEM_IDS = ["p01", "p02", "p03", "p04", "p05", "p06", "p07", "p08", "p09", "p10"] as const;

export async function ProblemSection({ locale }: MarketingLocaleProps) {
  const t = await getTranslations({ locale, namespace: "Marketing.problem" });

  if (locale === "en") {
    return (
      <section id="problem" className="border-b border-border bg-background py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <Reveal className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold uppercase tracking-widest text-primary">{t("tenProblems.eyebrow")}</p>
            <h2 className="mt-3 font-heading text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              {t("tenProblems.heading")}
            </h2>
            <p className="mt-4 text-balance text-lg text-muted-foreground">
              {t("tenProblems.subhead")}
            </p>
          </Reveal>

          <div className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-2">
            {TEN_PROBLEM_IDS.map((id, i) => (
              <Reveal key={id} delay={(i % 4) * 60}>
                <div className="h-full rounded-2xl border border-border bg-card p-6 shadow-card">
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-heading text-2xl text-destructive/70">{i + 1 < 10 ? `0${i + 1}` : i + 1}</span>
                    <span className="shrink-0 rounded-full bg-destructive/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-destructive">
                      {t(`tenProblems.items.${id}.cost`)}
                    </span>
                  </div>
                  <h3 className="mt-3 font-heading text-base font-semibold text-foreground">{t(`tenProblems.items.${id}.title`)}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(`tenProblems.items.${id}.body`)}</p>
                  <p className="mt-4 border-t border-dashed border-border pt-3 text-sm leading-relaxed text-foreground">
                    <span className="mr-1.5 text-xs font-bold uppercase tracking-wide text-primary">PROJEXA</span>
                    {t(`tenProblems.items.${id}.fix`)}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal delay={120} className="mt-8 flex flex-col items-center gap-3 rounded-2xl border border-border bg-muted/40 p-6 text-center sm:flex-row sm:text-left">
            <span className="font-heading text-4xl text-destructive">{t("tenProblems.sumline.stat")}</span>
            <div>
              <p className="text-sm text-foreground">{t("tenProblems.sumline.text")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("tenProblems.sumline.small")}</p>
            </div>
          </Reveal>
        </div>
      </section>
    );
  }

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
