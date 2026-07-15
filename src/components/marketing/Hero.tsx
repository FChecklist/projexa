import Link from "next/link";
import { ArrowRight, PlayCircle } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";

export async function Hero() {
  const t = await getTranslations("Marketing.hero");

  return (
    <section className="relative overflow-hidden bg-px-ink">
      {/* Blueprint grid texture -- faint, construction-drawing-coded rather
          than a generic SaaS dot grid. */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)",
          backgroundSize: "44px 44px",
        }}
        aria-hidden
      />
      {/* Ambient orange glow, slow drift -- the one deliberate motion cue in
          the hero. Killed under prefers-reduced-motion (see globals.css). */}
      <div
        className="pointer-events-none absolute -top-32 right-[-10%] h-[560px] w-[560px] rounded-full bg-px-orange/25 blur-[120px] animate-px-drift"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute bottom-[-20%] left-[-10%] h-[420px] w-[420px] rounded-full bg-px-steel/25 blur-[120px]"
        aria-hidden
      />

      <div className="relative mx-auto max-w-7xl px-4 pb-24 pt-16 sm:px-6 sm:pb-32 sm:pt-24 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-xs font-medium tracking-wide text-px-cloud2">
            <span className="h-1.5 w-1.5 rounded-full bg-px-orange" />
            {t("badge")}
          </div>

          <h1 className="font-heading text-balance text-4xl font-semibold leading-[1.08] tracking-tight text-white sm:text-6xl lg:text-7xl">
            {t("headingLine1")}{" "}
            <span className="bg-gradient-to-r from-px-orange to-orange-300 bg-clip-text text-transparent">
              {t("headingLine2")}
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-balance text-lg leading-relaxed text-px-cloud2 sm:text-xl">
            {t("subhead")}
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" className="h-12 w-full bg-px-orange px-8 text-base text-white shadow-orange hover:bg-px-orange-hover sm:w-auto">
              <Link href="/signup">
                {t("ctaStart")} <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="h-12 w-full border-white/20 bg-transparent px-8 text-base text-white hover:bg-white/10 hover:text-white sm:w-auto"
            >
              <Link href="/login">
                <PlayCircle className="h-4 w-4" />
                {t("ctaLogin")}
              </Link>
            </Button>
          </div>

          <p className="mt-5 text-sm text-px-cloud2/70">
            {t("note")}
          </p>
        </div>
      </div>
    </section>
  );
}
