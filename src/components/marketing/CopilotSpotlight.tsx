import { Bot, Sparkles, Search, ShieldCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { MarketingLocaleProps } from "./marketing-locale";
import { Reveal } from "./Reveal";

const CAPABILITY_KEYS = [
  { key: "grounded", icon: Search },
  { key: "ask", icon: Sparkles },
  { key: "workflow", icon: ShieldCheck },
] as const;

// English gets three "how it works" example rows appended below, merged
// from the v4 standalone preview (website/projexa-ai-com-v4/index.html,
// S12.A.A3/A4) -- a concrete walkthrough of the same VERI capability pitched
// above it, not a replacement for it. Hindi keeps this section exactly as it
// was, per the S12.A ruling: these are new translation keys
// (copilot.flow.*), never requested when locale is "hi".
const FLOW_ROW_KEYS = ["tell", "complete", "decide"] as const;

export async function CopilotSpotlight({ locale }: MarketingLocaleProps) {
  const t = await getTranslations({ locale, namespace: "Marketing.copilot" });

  return (
    <section id="veri" className="border-b border-border bg-background py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
          <Reveal>
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3.5 py-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
              <Bot className="h-3.5 w-3.5" />
              {t("badge")}
            </div>
            <h2 className="mt-4 font-heading text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              {t("heading")}
            </h2>
            <p className="mt-4 text-balance text-lg leading-relaxed text-muted-foreground">
              {t("subhead")}
            </p>

            <div className="mt-8 space-y-5">
              {CAPABILITY_KEYS.map((cap) => (
                <div key={cap.key} className="flex gap-4">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <cap.icon className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="font-heading text-sm font-semibold text-foreground">{t(`capabilities.${cap.key}.title`)}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t(`capabilities.${cap.key}.body`)}</p>
                  </div>
                </div>
              ))}
            </div>
          </Reveal>

          <Reveal delay={120}>
            <div className="relative overflow-hidden rounded-2xl border border-border bg-px-ink p-6 shadow-nav sm:p-8">
              <div
                className="pointer-events-none absolute inset-0 opacity-[0.06]"
                style={{
                  backgroundImage:
                    "linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)",
                  backgroundSize: "36px 36px",
                }}
                aria-hidden
              />
              <div className="relative space-y-3">
                {/* R67 WS-G / C-13: navy on saffron (5.55:1), the preferred
                    fix -- the brand fill is unchanged. */}
                <div className="ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-px-orange px-4 py-3 text-sm text-ct-navy shadow-orange">
                  {t("chat.q1")}
                </div>
                <div className="mr-auto max-w-[90%] rounded-2xl rounded-tl-sm border border-white/10 bg-white/5 px-4 py-3 text-sm leading-relaxed text-px-cloud2">
                  {t("chat.a1")}
                </div>
                <div className="ml-auto max-w-[70%] rounded-2xl rounded-tr-sm bg-px-orange px-4 py-3 text-sm text-ct-navy shadow-orange">
                  {t("chat.q2")}
                </div>
                <div className="mr-auto flex max-w-[75%] items-center gap-2 rounded-2xl rounded-tl-sm border border-white/10 bg-white/5 px-4 py-3 text-sm text-px-cloud2">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-px-orange" />
                  {t("chat.typing")}
                </div>
              </div>
            </div>
          </Reveal>
        </div>

        {locale === "en" && (
          <div className="mt-20">
            <Reveal className="mx-auto max-w-2xl text-center">
              <p className="text-sm font-semibold uppercase tracking-widest text-primary">{t("flow.eyebrow")}</p>
              <h3 className="mt-3 font-heading text-balance text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                {t("flow.heading")}
              </h3>
            </Reveal>

            <div className="mt-10 space-y-6">
              {FLOW_ROW_KEYS.map((row, i) => (
                <Reveal key={row} delay={i * 90}>
                  <div className="grid grid-cols-1 gap-4 rounded-2xl border border-border bg-card p-6 shadow-card sm:grid-cols-[auto_1fr_1fr] sm:items-start sm:gap-8">
                    <span className="font-heading text-2xl text-primary">{`0${i + 1}`}</span>
                    <div>
                      <h4 className="font-heading text-base font-semibold text-foreground">{t(`flow.rows.${row}.title`)}</h4>
                      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{t(`flow.rows.${row}.body`)}</p>
                    </div>
                    <div className="rounded-xl border border-border bg-muted/40 p-4 text-sm">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(`flow.rows.${row}.exampleFrom`)}</p>
                      <p className="mt-1.5 text-foreground">{t(`flow.rows.${row}.exampleLine`)}</p>
                      <p className="mt-2 border-t border-dashed border-border pt-2 text-muted-foreground">
                        <span className="mr-1.5 text-xs font-bold uppercase tracking-wide text-primary">PROJEXA AI</span>
                        {t(`flow.rows.${row}.exampleAi`)}
                      </p>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
