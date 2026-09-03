import { getTranslations } from "next-intl/server";
import type { MarketingLocaleProps } from "../marketing-locale";

export async function HowItWorksHero({ locale }: MarketingLocaleProps) {
  const t = await getTranslations({ locale, namespace: "Marketing.howItWorks.hero" });

  return (
    <section className="relative overflow-hidden bg-px-ink py-20 sm:py-28">
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
        className="pointer-events-none absolute -top-32 left-[-10%] h-[480px] w-[480px] rounded-full bg-px-steel/25 blur-[120px]"
        aria-hidden
      />

      <div className="relative mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
        <h1 className="font-heading text-balance text-4xl font-semibold leading-[1.1] tracking-tight text-white sm:text-5xl lg:text-6xl">
          {t("heading")}
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-balance text-lg leading-relaxed text-px-cloud2">
          {t("subhead")}
        </p>
      </div>
    </section>
  );
}
