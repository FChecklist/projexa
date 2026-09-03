import { PenLine } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { MarketingLocaleProps } from "./marketing-locale";
import { Reveal } from "./Reveal";

export async function ValueSection({ locale }: MarketingLocaleProps) {
  const t = await getTranslations({ locale, namespace: "Marketing.value" });

  return (
    <section id="value" className="border-b border-border bg-background py-20 sm:py-28">
      <div className="mx-auto max-w-3xl px-4 text-center sm:px-6 lg:px-8">
        <Reveal>
          <p className="text-sm font-semibold uppercase tracking-widest text-primary">{t("eyebrow")}</p>
          <h2 className="mt-3 font-heading text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            {t("heading")}
          </h2>
          <p className="mt-4 text-balance text-lg leading-relaxed text-muted-foreground">
            {t("body")}
          </p>
        </Reveal>

        <Reveal delay={100} className="mt-10 rounded-2xl border border-border bg-card p-6 text-left shadow-card sm:p-8">
          <div className="flex items-center gap-2 text-primary">
            <PenLine className="h-4 w-4" />
            <p className="text-sm font-semibold uppercase tracking-wide">{t("noteTitle")}</p>
          </div>
          <p className="mt-3 text-base leading-relaxed text-foreground">{t("noteBody")}</p>
          <p className="mt-4 text-sm font-medium text-muted-foreground">{t("signature")}</p>
        </Reveal>
      </div>
    </section>
  );
}
