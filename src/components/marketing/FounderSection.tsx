import Image from "next/image";
import { getTranslations } from "next-intl/server";
import type { MarketingLocaleProps } from "./marketing-locale";
import { Reveal } from "./Reveal";

// New section (2026-09-16), owner-directed: a real "who built this" credit,
// not a stock-photo team slide. English only, same posture as
// ProofAndPricingSection -- rendered from LandingPage.tsx for both locales,
// returns null for anything other than "en" so the Hindi document's
// rendered output does not change. Marketing.founder.* keys still exist in
// messages/hi.json (required by src/lib/i18n-messages-integrity.test.ts's
// same-keys-in-every-locale check) even though the Hindi route never reads
// them -- same documented tradeoff ProofAndPricingSection already made.
//
// The quote is a DRAFT, not verified as Sumeet's own words -- grounded in
// his real, verified background (20+ years fit-out project management,
// Dubai) but written by this session, not transcribed from him. Replace it
// before this is treated as a real testimonial; flagged here so the next
// person touching this file does not assume otherwise.
export async function FounderSection({ locale }: MarketingLocaleProps) {
  if (locale !== "en") return null;

  const t = await getTranslations({ locale, namespace: "Marketing.founder" });

  return (
    <section id="who-built-this" className="border-b border-border bg-background py-16 sm:py-20">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <Reveal>
          <div className="grid grid-cols-[auto_1fr] gap-6 rounded-2xl border border-border bg-card p-6 shadow-card sm:p-8">
            <div className="h-[72px] w-[72px] shrink-0 self-start overflow-hidden rounded-full border-[3px] border-px-orange shadow-orange">
              <Image
                src="/team/sumeet-aggarwal.jpg"
                alt={t("name")}
                width={72}
                height={72}
                className="h-full w-full object-cover"
              />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-primary">{t("eyebrow")}</p>
              <h3 className="mt-1 font-heading text-lg font-semibold text-foreground">{t("name")}</h3>
              <p className="mt-1 font-mono text-[11px] text-muted-foreground">{t("role")}</p>
              <blockquote className="mt-3 border-l-2 border-px-orange pl-4 font-heading text-base leading-snug text-foreground">
                &ldquo;{t("quote")}&rdquo;
              </blockquote>
              <a
                href="https://www.linkedin.com/in/sumeet-s-aggarwal-%E3%80%8Bsolutionadvisor-interiordesigner/"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-block text-sm font-semibold text-primary hover:underline"
              >
                {t("linkedin")}
              </a>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
