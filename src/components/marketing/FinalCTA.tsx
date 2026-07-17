import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Reveal } from "./Reveal";
import { ContactForm } from "./ContactForm";

export async function FinalCTA({ sourcePage = "home" }: { sourcePage?: "home" | "how-it-works" }) {
  const t = await getTranslations("Marketing.finalCta");

  return (
    <section id="contact" className="relative overflow-hidden bg-px-ink py-20 sm:py-28">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)",
          backgroundSize: "44px 44px",
        }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute left-1/2 top-0 h-[420px] w-[720px] -translate-x-1/2 rounded-full bg-px-orange/20 blur-[140px]"
        aria-hidden
      />

      <div className="relative mx-auto max-w-3xl px-4 text-center sm:px-6 lg:px-8">
        <Reveal>
          <h2 className="font-heading text-balance text-3xl font-semibold tracking-tight text-white sm:text-5xl">
            {t("heading")}
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-balance text-lg leading-relaxed text-px-cloud2">
            {t("body")}
          </p>
        </Reveal>

        <Reveal delay={100} className="mt-9">
          <p className="mb-5 font-heading text-base font-semibold text-white">{t("formIntro")}</p>
          <ContactForm sourcePage={sourcePage} />
          <div className="mt-5">
            <Button
              asChild
              size="lg"
              variant="outline"
              className="h-11 border-white/20 bg-transparent px-8 text-base text-white hover:bg-white/10 hover:text-white"
            >
              <Link href="/login">{t("ctaLogin")}</Link>
            </Button>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
