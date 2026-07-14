import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Reveal } from "./Reveal";

export function FinalCTA() {
  return (
    <section className="relative overflow-hidden bg-px-ink py-20 sm:py-28">
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
            PROJEXA makes work complete.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-balance text-lg leading-relaxed text-px-cloud2">
            Every RFI answered. Every schedule slip caught early. Every change order on
            record. From first drawing to final handover — nothing falls through.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" className="h-12 w-full bg-px-orange px-8 text-base text-white shadow-orange hover:bg-px-orange-hover sm:w-auto">
              <Link href="/signup">
                Start free <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="h-12 w-full border-white/20 bg-transparent px-8 text-base text-white hover:bg-white/10 hover:text-white sm:w-auto"
            >
              <Link href="/login">Log in</Link>
            </Button>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
