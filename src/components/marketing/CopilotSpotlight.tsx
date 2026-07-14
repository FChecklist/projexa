import { Bot, Sparkles, Search, ShieldCheck } from "lucide-react";
import { Reveal } from "./Reveal";

const CAPABILITIES = [
  {
    icon: Search,
    title: "Grounded in your project, not the internet",
    body: "Every answer is drawn from your own schedule, RFIs, site diaries and budgets — not a generic model guessing.",
  },
  {
    icon: Sparkles,
    title: "Ask instead of digging",
    body: "“What's blocking the electrical RFI on the third floor?” gets answered in seconds, not after three phone calls.",
  },
  {
    icon: ShieldCheck,
    title: "Built into the workflow",
    body: "The Copilot sits alongside every module, so it already has the context — no exporting data or switching tabs.",
  },
];

export function CopilotSpotlight() {
  return (
    <section id="copilot" className="border-b border-border bg-background py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
          <Reveal>
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3.5 py-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
              <Bot className="h-3.5 w-3.5" />
              AI Copilot
            </div>
            <h2 className="mt-4 font-heading text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              An AI Copilot that actually knows your project.
            </h2>
            <p className="mt-4 text-balance text-lg leading-relaxed text-muted-foreground">
              This isn&apos;t a chatbot bolted onto a dashboard. PROJEXA&apos;s AI Copilot is
              wired into every module — schedule, RFIs, site diary, budgets, change
              orders — so it can answer real questions about a real project, in context,
              the moment you ask.
            </p>

            <div className="mt-8 space-y-5">
              {CAPABILITIES.map((cap) => (
                <div key={cap.title} className="flex gap-4">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <cap.icon className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="font-heading text-sm font-semibold text-foreground">{cap.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{cap.body}</p>
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
                  What&apos;s blocking the electrical RFI on Level 3?
                </div>
                <div className="mr-auto max-w-[90%] rounded-2xl rounded-tl-sm border border-white/10 bg-white/5 px-4 py-3 text-sm leading-relaxed text-px-cloud2">
                  RFI-042 has been pending vendor response for 4 days. It&apos;s
                  blocking two dependent schedule items due Friday. Want me to flag it
                  to the vendor and notify the PM?
                </div>
                <div className="ml-auto max-w-[70%] rounded-2xl rounded-tr-sm bg-px-orange px-4 py-3 text-sm text-white shadow-orange">
                  Yes, do that.
                </div>
                <div className="mr-auto flex max-w-[75%] items-center gap-2 rounded-2xl rounded-tl-sm border border-white/10 bg-white/5 px-4 py-3 text-sm text-px-cloud2">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-px-orange" />
                  Notifying vendor and PM…
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
