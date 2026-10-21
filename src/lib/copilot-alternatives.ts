// When an AI button cannot answer (PROJEXA's own AI is off, or there is no connection), the person is sent to the ordinary screen that shows the same
// facts without any AI. One entry per Copilot construction tool (src/components/CopilotClient.tsx); anything else falls back to Reports.
export type Alternative = { href: string; label: string; where: string };

const TABLE: Record<string, Alternative> = {
  get_construction_project_dashboard: { href: "/dashboard", label: "Open the Project Dashboard", where: "Dashboard" },
  get_construction_budget_status: { href: "/budgets", label: "Open Budgets", where: "Budgets" },
  get_construction_kpi_status: { href: "/kpis", label: "Open KPIs", where: "KPIs" },
  generate_construction_progress_summary: { href: "/work-progress", label: "Open Work Progress", where: "Work Progress" },
  detect_construction_budget_schedule_risk: { href: "/analysis", label: "Open Analysis", where: "Analysis" },
  list_delayed_activities: { href: "/schedule", label: "Open Schedule", where: "Schedule" },
  list_over_budget_projects: { href: "/budgets", label: "Open Budgets", where: "Budgets" },
};

export function alternativeFor(codeReference: string | null | undefined, projectId?: string | null): Alternative {
  const a = TABLE[codeReference ?? ""] ?? { href: "/reports", label: "Open Reports", where: "Reports" };
  return projectId ? { ...a, href: `${a.href}${a.href.includes("?") ? "&" : "?"}projectId=${encodeURIComponent(projectId)}` } : a;
}
