import { TrendingUp, Clock, AlertTriangle } from "lucide-react";
import { Reveal } from "./Reveal";

const REASONS = [
  {
    icon: Clock,
    title: "One missed deadline costs more than a year of PROJEXA",
    body: "A single schedule slip that cascades into the next trade, or a change order that goes undocumented, routinely costs more than what a team spends on PROJEXA in a full year.",
  },
  {
    icon: AlertTriangle,
    title: "Rework is the silent budget killer",
    body: "Miscommunication between site and office doesn't show up as a line item — it shows up as redone work, disputed change orders, and client trust you have to rebuild.",
  },
  {
    icon: TrendingUp,
    title: "Coordination, done once, compounds",
    body: "Every project run through PROJEXA makes the next one faster — the same schedule discipline, the same paper trail, the same AI Copilot context, reused.",
  },
];

export function ROISection() {
  return (
    <section id="value" className="border-b border-border bg-muted/40 py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
          <Reveal>
            <p className="text-sm font-semibold uppercase tracking-widest text-primary">Why it pays for itself</p>
            <h2 className="mt-3 font-heading text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Built to save teams at least 2x what they spend on it.
            </h2>
            <p className="mt-4 text-balance text-lg leading-relaxed text-muted-foreground">
              We won&apos;t hand you a fabricated statistic — every project is different.
              What we will say plainly: the cost of PROJEXA is small next to the cost of
              a missed deadline, a disputed change order, or a week of rework caused by
              a decision that never made it back to the drawings. Prevent one of those
              on a single project, and PROJEXA has already paid for itself many times
              over.
            </p>
            <div className="mt-8 rounded-2xl border border-primary/20 bg-primary/5 p-6">
              <p className="font-heading text-lg font-semibold text-foreground">
                The math is simple, not fabricated.
              </p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                PROJEXA costs a small, predictable amount per month. A single missed
                deadline, rework cycle, or vendor dispute typically costs far more than
                that — on just one project. Catch it before it happens, and you&apos;re
                ahead.
              </p>
            </div>
          </Reveal>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-1">
            {REASONS.map((reason, i) => (
              <Reveal key={reason.title} delay={i * 90}>
                <div className="flex gap-4 rounded-2xl border border-border bg-card p-6 shadow-card">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <reason.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-heading text-base font-semibold text-foreground">{reason.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{reason.body}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
