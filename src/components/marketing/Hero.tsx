import Link from "next/link";
import { ArrowRight, GanttChartSquare, Wallet, MessageCircleQuestion, ShieldAlert } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { MarketingLocaleProps } from "./marketing-locale";
import { Button } from "@/components/ui/button";

const STAT_CHIP_KEYS = ["coordination", "productivity", "savings"] as const;

const PREVIEW_TILE_KEYS = [
  { key: "schedule", icon: GanttChartSquare },
  { key: "budget", icon: Wallet },
  { key: "rfis", icon: MessageCircleQuestion },
  { key: "permits", icon: ShieldAlert },
] as const;

// Owner's Statement redesign (2026-09-16): white ground, gold/orange accent
// glow instead of the dark px-ink hero -- the owner's explicit direction
// ("don't use black, use white background, make colours better") applied to
// the real site, not just the mockup it was proven on first. The dashboard
// preview keeps the same real-project-workspace shape (deliberately NOT a
// chat bubble UI, per the owner's standing "not a chatbot" instruction) but
// is now a framed paper card on the page rather than a dark panel on a dark
// hero, and its tiles show the real dashboard metric NAMES
// ("% Complete by BOQ", "Budget vs Actual", "Permits Expiring") rather than
// generic status words -- matching what src/components/DashboardProjectClient.tsx
// actually renders, not an illustration of it.
export async function Hero({ locale }: MarketingLocaleProps) {
  const t = await getTranslations({ locale, namespace: "Marketing.hero" });

  return (
    <section id="ai-os" className="relative overflow-hidden bg-white">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "linear-gradient(to right, #1C2B3A 1px, transparent 1px), linear-gradient(to bottom, #1C2B3A 1px, transparent 1px)",
          backgroundSize: "44px 44px",
        }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -top-32 right-[-10%] h-[560px] w-[560px] rounded-full bg-px-orange/20 blur-[120px] animate-px-drift"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute bottom-[-20%] left-[-10%] h-[420px] w-[420px] rounded-full bg-px-steel/20 blur-[120px]"
        aria-hidden
      />

      <div className="relative mx-auto max-w-7xl px-4 pb-20 pt-16 sm:px-6 sm:pb-28 sm:pt-24 lg:px-8">
        <div className="grid grid-cols-1 items-center gap-14 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10">
          {/* Left: copy */}
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-px-ink/15 bg-px-ink/[0.03] px-3.5 py-1.5 font-mono text-[11px] font-medium uppercase tracking-wide text-px-ink2">
              <span className="h-1.5 w-1.5 rounded-full bg-px-orange" />
              {t("badge")}
            </div>

            {/* Each chip links to the ROI section's own honest math rather
                than floating as a bare, unexplained multiplier -- that
                section explicitly says "we won't hand you a fabricated
                statistic," so these numbers need a way to show their work,
                not just assert it. */}
            <div className="mt-5 flex flex-wrap items-center gap-2">
              {STAT_CHIP_KEYS.map((key) => (
                <Link
                  key={key}
                  href="#pays-for-itself"
                  className="rounded-full border border-px-ink/10 bg-px-ink/[0.02] px-3 py-1 font-mono text-[11px] font-medium text-px-ink2 transition-colors hover:border-px-orange/40 hover:text-px-ink"
                >
                  {t(`statChips.${key}`)}
                </Link>
              ))}
            </div>

            <h1 className="mt-5 font-heading text-balance text-4xl font-semibold leading-[1.08] tracking-tight text-px-ink sm:text-5xl lg:text-6xl">
              {t("headingLine1")}{" "}
              <span className="bg-gradient-to-r from-px-orange to-orange-300 bg-clip-text text-transparent">
                {t("headingLine2")}
              </span>
            </h1>

            <p className="mt-6 max-w-xl text-balance text-lg leading-relaxed text-px-ink2">
              {t("subhead")}
            </p>

            <div className="mt-6 flex items-start gap-3 rounded-xl border border-border bg-muted/40 p-4">
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-px-orange" aria-hidden />
              <p className="text-sm leading-relaxed text-px-ink2">{t("manifesto")}</p>
            </div>

            <div className="mt-8 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
              <Button asChild size="lg" className="h-12 w-full bg-gradient-to-r from-px-orange to-orange-300 px-8 text-base text-ct-navy shadow-orange hover:opacity-90 sm:w-auto">
                <Link href="#proof">
                  {t("ctaProof")} <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-12 w-full px-8 text-base sm:w-auto">
                <Link href="#contact">{t("ctaTalk")}</Link>
              </Button>
            </div>
            <p className="mt-3 font-mono text-[11px] text-px-ink3">{t("ctaSub")}</p>
          </div>

          {/* Right: dashboard preview mockup -- a paper statement, gold-framed, on the page */}
          <div className="relative">
            <div className="rounded-2xl bg-gradient-to-br from-px-orange to-orange-300 p-[2px] shadow-xl">
              <div className="overflow-hidden rounded-[14px] bg-white">
                {/* Fake browser chrome */}
                <div className="flex items-center gap-2 border-b border-border bg-muted/60 px-4 py-2.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-px-ink/10" />
                  <span className="h-2.5 w-2.5 rounded-full bg-px-ink/10" />
                  <span className="h-2.5 w-2.5 rounded-full bg-px-ink/10" />
                  <div className="ml-2 flex-1 truncate rounded-md bg-px-ink/5 px-3 py-1 font-mono text-[11px] text-px-ink3">
                    {t("preview.url")}
                  </div>
                </div>

                <div className="space-y-4 p-4 sm:p-5">
                  {/* Project header */}
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-heading text-sm font-semibold text-px-ink">{t("preview.projectName")}</p>
                    </div>
                    <div className="flex -space-x-2">
                      {["PM", "SE", "DS", "PR"].map((initials) => (
                        <span
                          key={initials}
                          className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-px-orange/80 text-[10px] font-semibold text-ct-navy shadow-sm"
                        >
                          {initials}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* VERI greeting */}
                  <div className="rounded-xl border border-border bg-muted/40 p-3.5">
                    <p className="text-xs leading-relaxed text-px-ink2">{t("preview.greeting")}</p>
                  </div>

                  {/* 2x2 status tiles -- real dashboard metric names */}
                  <div className="grid grid-cols-2 gap-3">
                    {PREVIEW_TILE_KEYS.map((tile) => (
                      <div key={tile.key} className="rounded-xl border border-border bg-muted/40 p-3.5">
                        <div className="flex items-center gap-1.5 text-px-orange">
                          <tile.icon className="h-3.5 w-3.5" aria-hidden />
                          <p className="text-[11px] font-semibold uppercase tracking-wide">{t(`preview.tiles.${tile.key}.label`)}</p>
                        </div>
                        <p className="mt-1.5 text-xs leading-snug text-px-ink2">{t(`preview.tiles.${tile.key}.value`)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
