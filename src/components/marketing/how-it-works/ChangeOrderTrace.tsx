import { getTranslations } from "next-intl/server";
import { Reveal } from "../Reveal";

const STEP_KEYS = ["step1", "step2", "step3", "step4", "step5"] as const;

// The real traced example: verified against
// src/app/api/change-orders/[id]/signature-status/route.ts and
// ChangeOrdersClient.tsx -- step 3 describes the actual e-signature-gated
// approval flow that ships in this app today (a real signature-progress
// summary, no one-click override button exists on purpose, see that
// component's own comment). Nothing in this sequence is aspirational.
export async function ChangeOrderTrace() {
  const t = await getTranslations("Marketing.howItWorks.trace");

  return (
    <section className="border-b border-border bg-muted/40 py-20 sm:py-28">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <Reveal className="text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-primary">{t("eyebrow")}</p>
          <h2 className="mt-3 font-heading text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            {t("heading")}
          </h2>
          <p className="mt-4 text-balance text-lg leading-relaxed text-muted-foreground">
            {t("subhead")}
          </p>
        </Reveal>

        <div className="mt-14 space-y-0">
          {STEP_KEYS.map((stepKey, i) => (
            <Reveal key={stepKey} delay={i * 80}>
              <div className="flex gap-5">
                <div className="flex flex-col items-center">
                  {/* R67 WS-G / C-13: navy on saffron (5.55:1), preferred fix. */}
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-px-orange font-heading text-sm font-semibold text-ct-navy">
                    {i + 1}
                  </div>
                  {i < STEP_KEYS.length - 1 && <div className="mt-1 w-px flex-1 bg-border" aria-hidden />}
                </div>
                <div className="pb-10">
                  <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                    {t(`steps.${stepKey}.category`)}
                  </p>
                  <h3 className="mt-1 font-heading text-base font-semibold text-foreground">
                    {t(`steps.${stepKey}.title`)}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {t(`steps.${stepKey}.body`)}
                  </p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
