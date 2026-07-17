import Link from "next/link";
import { ArrowRight, Users2, GanttChartSquare, Wallet, MessageCircleQuestion, HardHat } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";

const STAT_CHIP_KEYS = ["coordination", "productivity", "savings"] as const;

const PREVIEW_TILE_KEYS = [
  { key: "schedule", icon: GanttChartSquare },
  { key: "budget", icon: Wallet },
  { key: "rfis", icon: MessageCircleQuestion },
  { key: "team", icon: Users2 },
] as const;

// Redesigned hero: two-column instead of centered text-only. The right
// column is a static dashboard-preview mockup, deliberately NOT a chat
// bubble UI (the owner was explicit PROJEXA must not present itself as a
// chatbot) -- it shows a realistic project workspace with VERI's greeting
// as one line inside it, not the whole card. The blueprint-grid texture and
// ambient orange/steel glow are kept from the previous centered layout;
// only the content layout changes.
export async function Hero() {
  const t = await getTranslations("Marketing.hero");

  return (
    <section id="ai-os" className="relative overflow-hidden bg-px-ink">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)",
          backgroundSize: "44px 44px",
        }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -top-32 right-[-10%] h-[560px] w-[560px] rounded-full bg-px-orange/25 blur-[120px] animate-px-drift"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute bottom-[-20%] left-[-10%] h-[420px] w-[420px] rounded-full bg-px-steel/25 blur-[120px]"
        aria-hidden
      />

      <div className="relative mx-auto max-w-7xl px-4 pb-20 pt-16 sm:px-6 sm:pb-28 sm:pt-24 lg:px-8">
        <div className="grid grid-cols-1 items-center gap-14 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10">
          {/* Left: copy */}
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 font-mono text-[11px] font-medium uppercase tracking-wide text-px-cloud2">
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
                  className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 font-mono text-[11px] font-medium text-px-cloud2 transition-colors hover:border-white/25 hover:text-white"
                >
                  {t(`statChips.${key}`)}
                </Link>
              ))}
            </div>

            <h1 className="mt-5 font-heading text-balance text-4xl font-semibold leading-[1.08] tracking-tight text-white sm:text-5xl lg:text-6xl">
              {t("headingLine1")}{" "}
              <span className="bg-gradient-to-r from-px-orange to-orange-300 bg-clip-text text-transparent">
                {t("headingLine2")}
              </span>
            </h1>

            <p className="mt-6 max-w-xl text-balance text-lg leading-relaxed text-px-cloud2">
              {t("subhead")}
            </p>

            <div className="mt-6 flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <HardHat className="mt-0.5 h-5 w-5 shrink-0 text-px-orange" />
              <p className="text-sm leading-relaxed text-px-cloud2">{t("manifesto")}</p>
            </div>

            <div className="mt-8 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
              <Button asChild size="lg" className="h-12 w-full bg-px-orange px-8 text-base text-white shadow-orange hover:bg-px-orange-hover sm:w-auto">
                <Link href="#contact">
                  {t("ctaTalk")} <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="h-12 w-full border-white/20 bg-transparent px-8 text-base text-white hover:bg-white/10 hover:text-white sm:w-auto"
              >
                <Link href="/how-it-works">{t("ctaHowItWorks")}</Link>
              </Button>
            </div>
          </div>

          {/* Right: dashboard preview mockup */}
          <div className="relative">
            <div className="overflow-hidden rounded-2xl border border-white/15 bg-px-ink2 shadow-nav">
              {/* Fake browser chrome */}
              <div className="flex items-center gap-2 border-b border-white/10 bg-px-ink3/60 px-4 py-2.5">
                <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
                <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
                <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
                <div className="ml-2 flex-1 truncate rounded-md bg-white/5 px-3 py-1 font-mono text-[11px] text-px-cloud2/80">
                  {t("preview.url")}
                </div>
              </div>

              <div className="space-y-4 p-4 sm:p-5">
                {/* Project header */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-heading text-sm font-semibold text-white">{t("preview.projectName")}</p>
                  </div>
                  <div className="flex -space-x-2">
                    {["PM", "SE", "DS", "PR"].map((initials) => (
                      <span
                        key={initials}
                        className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-px-ink2 bg-px-orange/80 text-[10px] font-semibold text-white"
                      >
                        {initials}
                      </span>
                    ))}
                  </div>
                </div>

                {/* VERI greeting */}
                <div className="rounded-xl border border-white/10 bg-white/5 p-3.5">
                  <p className="text-xs leading-relaxed text-px-cloud2">{t("preview.greeting")}</p>
                </div>

                {/* 2x2 status tiles */}
                <div className="grid grid-cols-2 gap-3">
                  {PREVIEW_TILE_KEYS.map((tile) => (
                    <div key={tile.key} className="rounded-xl border border-white/10 bg-white/[0.04] p-3.5">
                      <div className="flex items-center gap-1.5 text-px-orange">
                        <tile.icon className="h-3.5 w-3.5" />
                        <p className="text-[11px] font-semibold uppercase tracking-wide">{t(`preview.tiles.${tile.key}.label`)}</p>
                      </div>
                      <p className="mt-1.5 text-xs leading-snug text-px-cloud2">{t(`preview.tiles.${tile.key}.value`)}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
