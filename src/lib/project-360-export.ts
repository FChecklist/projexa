// Sumeet R-99 / R-100 (2026-10-13): the Project 360 profit-and-loss analysis could be read but not taken away. This builds the file from the SAME figures the screen
// shows (already formatted by the screen's own money/percent functions), so the download cannot disagree with the page. CSV only: PROJEXA has no PDF library;
// the screen also offers the browser's own Print / Save as PDF.
import { csvEscape } from "@/lib/report-run";

export type Project360Figures = {
  profit: [label: string, value: string][];
  boq: [label: string, value: string][];
  counts: [label: string, value: string][];
};

export function project360ToCsv(projectName: string, today: string, f: Project360Figures): string {
  const lines: string[] = [csvEscape(`Project 360 analysis - ${projectName} - ${today}`)];
  const block = (heading: string, rows: [string, string][]) => {
    lines.push("", csvEscape(heading), "Measure,Value");
    for (const [k, v] of rows) lines.push(`${csvEscape(k)},${csvEscape(v)}`);
  };
  block("Profit and loss", f.profit);
  block("Change of BOQ", f.boq);
  block("Scope changes, milestones, timeline, billing", f.counts);
  return lines.join("\n");
}
