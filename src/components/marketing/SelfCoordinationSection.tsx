import { X, Check } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Reveal } from "./Reveal";

const ROW_KEYS = ["chatbot", "platform"] as const;

// The "here's the actual difference" comparison the header's "Self
// Coordination" nav item points at -- addresses AI-branding skepticism
// directly: what "self-coordinating AI OS" concretely means, versus (a) a
// chatbot bolted onto a dashboard and (b) a generic business-apps platform.
export async function SelfCoordinationSection() {
  const t = await getTranslations("Marketing.selfCoordination");

  return (
    <section id="self-coordination" className="border-b border-border bg-muted/40 py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-primary">{t("eyebrow")}</p>
          <h2 className="mt-3 font-heading text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            {t("heading")}
          </h2>
          <p className="mt-4 text-balance text-lg leading-relaxed text-muted-foreground">
            {t("subhead")}
          </p>
        </Reveal>

        <div className="mt-14 space-y-6">
          {ROW_KEYS.map((rowKey, i) => (
            <Reveal key={rowKey} delay={i * 100}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex gap-4 rounded-2xl border border-border bg-card p-6 shadow-card">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
                    <X className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="font-heading text-sm font-semibold text-foreground">{t(`rows.${rowKey}.themLabel`)}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{t(`rows.${rowKey}.themBody`)}</p>
                  </div>
                </div>
                <div className="flex gap-4 rounded-2xl border border-primary/30 bg-primary/5 p-6 shadow-card">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                    <Check className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="font-heading text-sm font-semibold text-foreground">{t(`rows.${rowKey}.usLabel`)}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{t(`rows.${rowKey}.usBody`)}</p>
                  </div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
