"use client";

// LOCAL-FIRST shell, overview cluster: the ANALYSIS hub on this laptop -- the online hub's own list, the selected project carried into
// every link. Each screen's figures are the server's; a screen that is on this laptop shows the last ones saved here, one that is not
// is opened from the server when connected (the shell says so calmly when it is not).

import type { ShellScreenProps } from "../types";
import type { AnalysisHubData } from "./analysis-adapter";

export default function AnalysisHubScreen({ shell, data }: ShellScreenProps<AnalysisHubData>) {
  const project = shell.data.projects.find((p) => p.id === data.projectId);
  return (
    <section data-testid="overview-analysis" className="space-y-3">
      <h1 className="font-heading text-2xl text-px-ink">Analysis</h1>
      <p className="text-sm text-px-muted">
        {project ? `Every screen below is scoped to ${project.name}.` : "No project is on this laptop yet, so these screens open unscoped."}
        {" "}Their figures are worked out by the server; this laptop shows the last ones it received for you.
      </p>
      <ul className="max-w-2xl space-y-2 rounded-lg border border-black/10 bg-white p-3 text-sm">
        {data.screens.map((s) => (
          <li key={s.key} data-testid="overview-analysis-entry">
            <a className="font-medium text-px-ink underline-offset-2 hover:underline" href={s.href}>{s.label}</a>
            <span className="block text-xs text-px-muted">{s.description}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
