import { Bot, Sparkles, Search, ShieldCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Reveal } from "./Reveal";

const CAPABILITY_KEYS = [
  { key: "grounded", icon: Search },
  { key: "ask", icon: Sparkles },
  { key: "workflow", icon: ShieldCheck },
] as const;

export async function CopilotSpotlight() {
  const t = await getTranslations("Marketing.copilot");

  return (
    <section id="copilot" className="border-b border-border bg-background py-20 sm:py-28">
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
                <div className="ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-px-orange px-4 py-3 text-sm text-white shadow-orange">
                  {t("chat.q1")}
                </div>
                <div className="mr-auto max-w-[90%] rounded-2xl rounded-tl-sm border border-white/10 bg-white/5 px-4 py-3 text-sm leading-relaxed text-px-cloud2">
                  {t("chat.a1")}
                </div>
                <div className="ml-auto max-w-[70%] rounded-2xl rounded-tr-sm bg-px-orange px-4 py-3 text-sm text-white shadow-orange">
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
      </div>
    </section>
  );
}
