import {
  GanttChartSquare, FileText, BookOpen, MessageCircleQuestion,
  FileSignature, Wallet, Bot, ClipboardList, FileCheck2,
} from "lucide-react";
import { Reveal } from "./Reveal";

const MODULES = [
  {
    icon: GanttChartSquare,
    title: "Schedule",
    body: "One live timeline the whole team works from — so a slip on-site shows up before it becomes a missed milestone.",
  },
  {
    icon: FileText,
    title: "Scope of Work (BOQ)",
    body: "Line-item scope tied straight to budgets and progress, not a spreadsheet nobody re-checks.",
  },
  {
    icon: ClipboardList,
    title: "Work Progress",
    body: "Actual site progress against plan, tracked continuously instead of reconstructed at month-end.",
  },
  {
    icon: BookOpen,
    title: "Site Diary",
    body: "The daily record of what actually happened on site — searchable, not buried in a paper logbook.",
  },
  {
    icon: MessageCircleQuestion,
    title: "RFIs & Submittals",
    body: "Every question and every approval tracked to resolution, with nothing left waiting in someone's inbox.",
  },
  {
    icon: FileCheck2,
    title: "Punch List",
    body: "Snags and closeout items owned, assigned, and closed — visible to everyone, not just whoever wrote it down.",
  },
  {
    icon: FileSignature,
    title: "Change Orders",
    body: "Scope changes documented and priced the moment they happen, not reconstructed in a dispute later.",
  },
  {
    icon: Wallet,
    title: "Budgets & Expenses",
    body: "Real spend against real budget, per project — visible before it becomes a surprise at handover.",
  },
  {
    icon: Bot,
    title: "AI Copilot",
    body: "Grounded in your own project data — ask it about any RFI, budget line, or schedule change and get a real answer.",
  },
];

const MORE_MODULES = [
  "Mood Boards", "FF&E Specification", "Floor Plans", "Manpower & Attendance",
  "Materials", "Vendors", "Documents", "KPIs", "Reports",
];

export function SolutionSection() {
  return (
    <section id="modules" className="border-b border-border bg-muted/40 py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-primary">One coordinated system</p>
          <h2 className="mt-3 font-heading text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Every module talks to every other module.
          </h2>
          <p className="mt-4 text-balance text-lg text-muted-foreground">
            Not twenty disconnected tools stitched together with exports — one system
            where a change order updates the budget, and a schedule slip shows up in
            the diary automatically.
          </p>
        </Reveal>

        <div className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((mod, i) => (
            <Reveal key={mod.title} delay={(i % 3) * 80}>
              <div className="group h-full rounded-2xl border border-border bg-card p-6 shadow-card transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-lg">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                  <mod.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 font-heading text-base font-semibold text-foreground">{mod.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{mod.body}</p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={120} className="mt-10 flex flex-wrap items-center justify-center gap-2">
          <span className="text-sm text-muted-foreground">Plus:</span>
          {MORE_MODULES.map((label) => (
            <span
              key={label}
              className="rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground"
            >
              {label}
            </span>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
