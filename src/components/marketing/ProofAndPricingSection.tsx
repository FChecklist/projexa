import { getTranslations } from "next-intl/server";
import { Link as LinkIcon } from "lucide-react";
import Link from "next/link";
import type { MarketingLocaleProps } from "./marketing-locale";
import { Button } from "@/components/ui/button";
import { Reveal } from "./Reveal";

// New section, merged from the v4 standalone preview
// (website/projexa-ai-com-v4/index.html, S12.A.A3/A4): the 30-day proof
// timeline (Day 0/31/60) and the price + money-back guarantee. Nothing in
// the existing component tree covered pricing or an onboarding timeline
// before this, so this is one new component rather than force-fitting new
// content into an unrelated existing section.
//
// English only, per the S12.A ruling ("leave the /hi route serving its
// current Hindi copy untouched") -- rendered from LandingPage.tsx for both
// locales, but returns null for anything other than "en" so the Hindi
// document's rendered output does not change. Marketing.proof.* keys DO
// exist in messages/hi.json (required by
// src/lib/i18n-messages-integrity.test.ts's same-keys-in-every-locale
// check) even though the Hindi route never reads them.
export async function ProofAndPricingSection({ locale }: MarketingLocaleProps) {
  if (locale !== "en") return null;

  const t = await getTranslations({ locale, namespace: "Marketing.proof" });
  const features = t.raw("price.features") as string[];
  const days = ["day0", "day31", "day60"] as const;

  return (
    <section id="proof" className="border-b border-border bg-muted/40 py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-primary">{t("eyebrow")}</p>
          <h2 className="mt-3 font-heading text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            {t("heading")}
          </h2>
        </Reveal>

        <div className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-3">
          {days.map((day, i) => (
            <Reveal key={day} delay={i * 90}>
              <div className="h-full rounded-2xl border border-border bg-card p-6 shadow-card">
                <p className="text-xs font-semibold uppercase tracking-widest text-primary">{t(`days.${day}.label`)}</p>
                <h3 className="mt-2 font-heading text-lg font-semibold text-foreground">{t(`days.${day}.title`)}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(`days.${day}.body`)}</p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={100} className="mt-10 grid grid-cols-1 gap-6 rounded-2xl border border-border bg-card p-6 shadow-card sm:grid-cols-[1.2fr_1fr_1fr] sm:items-center sm:p-8">
          <div>
            <p className="font-heading text-3xl text-foreground">
              {t("price.amount")} <span className="font-sans text-base font-normal text-muted-foreground">{t("price.unit")}</span>
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{t("price.detail")}</p>
          </div>
          <ul className="space-y-1.5 text-sm text-foreground">
            {features.map((feature) => (
              <li key={feature} className="flex items-start gap-2">
                <span className="mt-0.5 text-primary">✓</span>
                {feature}
              </li>
            ))}
          </ul>
          <div className="border-l-2 border-primary pl-4">
            <p className="font-heading text-sm font-semibold text-foreground">{t("price.guaranteeTitle")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t("price.guaranteeBody")}</p>
          </div>
        </Reveal>

        <Reveal delay={140} className="mt-8 text-center">
          <Button asChild size="lg" className="h-12 px-8 text-base">
            <Link href="#contact">
              <LinkIcon className="h-4 w-4" /> {t("price.cta")}
            </Link>
          </Button>
        </Reveal>
      </div>
    </section>
  );
}
