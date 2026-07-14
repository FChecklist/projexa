import { MessageCircleQuestion, CalendarClock, FolderX, Repeat } from "lucide-react";
import { Reveal } from "./Reveal";

const PAIN_POINTS = [
  {
    icon: MessageCircleQuestion,
    title: "Communication scattered everywhere",
    body: "RFIs in email, submittals in WhatsApp, approvals over calls. By the time an answer surfaces, the site has already moved on.",
  },
  {
    icon: CalendarClock,
    title: "Deadlines slip silently",
    body: "Schedule delays get discovered after they've already cascaded into the next trade, the next milestone, the next client conversation.",
  },
  {
    icon: FolderX,
    title: "No single source of truth",
    body: "Budgets in one spreadsheet, change orders in another, site diaries on paper. Nobody — including the PM — has the full picture.",
  },
  {
    icon: Repeat,
    title: "Rework from miscommunication",
    body: "A decision made on-site never makes it back to the drawings. Three weeks later, it's redone at the client's expense — and yours.",
  },
];

export function ProblemSection() {
  return (
    <section id="problem" className="border-b border-border bg-background py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-primary">The real cost</p>
          <h2 className="mt-3 font-heading text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            The work isn&apos;t the expensive part. The coordination is.
          </h2>
          <p className="mt-4 text-balance text-lg text-muted-foreground">
            Every mid-size construction and interior design team loses money the same
            way — not on materials or labour, but on the gaps between them.
          </p>
        </Reveal>

        <div className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {PAIN_POINTS.map((point, i) => (
            <Reveal key={point.title} delay={i * 80}>
              <div className="h-full rounded-2xl border border-border bg-card p-6 shadow-card transition-transform duration-300 hover:-translate-y-1">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
                  <point.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 font-heading text-base font-semibold text-foreground">{point.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{point.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
