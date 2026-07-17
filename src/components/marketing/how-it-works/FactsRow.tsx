import { getTranslations } from "next-intl/server";
import { Reveal } from "../Reveal";

const FACT_KEYS = ["fact1", "fact2", "fact3"] as const;

export async function FactsRow() {
  const t = await getTranslations("Marketing.howItWorks.facts");

  return (
    <section className="border-b border-border bg-background py-16 sm:py-20">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          {FACT_KEYS.map((key, i) => (
            <Reveal key={key} delay={i * 80}>
              <div className="rounded-2xl border border-border bg-card p-6 text-center shadow-card">
                <p className="font-heading text-4xl font-semibold text-primary">{t(`${key}.value`)}</p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(`${key}.label`)}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
