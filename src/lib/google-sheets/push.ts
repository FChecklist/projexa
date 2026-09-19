import { getSheetsClient } from "./client";
import { callVeridian } from "@/lib/veridian-client";
import { db, googleSheetsIntegration } from "@/lib/db";
import { eq } from "drizzle-orm";
import {
  SHEET_IDS,
  getOrgRoster,
  applyAdminProtectedRanges,
  ADMIN_ROLES,
  REPORT_OUTPUT_START_ROW,
} from "./spreadsheet-builder";
import { SHEET_TITLES, ANALYSIS_REPORT_NAMES } from "./tabs";
import { flattenReportToGrid } from "./report-flatten";

type VeridianProject = { id: string; name: string };
type BoqLineItem = Record<string, unknown>;
type Boq = { id?: string; title?: string; lineItems?: BoqLineItem[] };

async function getIntegration(organizationId: string) {
  const row = await db.query.googleSheetsIntegration.findFirst({ where: eq(googleSheetsIntegration.organizationId, organizationId) });
  if (!row) throw new Error(`No Google Sheets integration connected for organization ${organizationId}`);
  return row;
}

async function clearAndWrite(spreadsheetId: string, sheetTitle: string, startCol: string, startRow: number, endCol: string, values: (string | number)[][]) {
  const sheets = getSheetsClient();
  // Clear a generous range first so a shrinking dataset doesn't leave stale
  // rows behind from a previous, larger push.
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: `'${sheetTitle}'!${startCol}${startRow}:${endCol}5000` });
  if (values.length === 0) return;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${sheetTitle}'!${startCol}${startRow}`,
    valueInputOption: "RAW",
    requestBody: { values },
  });
}

async function readCell(spreadsheetId: string, sheetTitle: string, cell: string): Promise<string> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${sheetTitle}'!${cell}` });
  return res.data.values?.[0]?.[0] ?? "";
}

async function fetchProjects(organizationId: string): Promise<VeridianProject[]> {
  const data = await callVeridian<{ projects: VeridianProject[] }>("/dashboard", { organizationId });
  return data.projects ?? [];
}

async function fetchBoqsForProject(organizationId: string, projectId: string): Promise<Boq[]> {
  try {
    const data = await callVeridian<{ boqs: Boq[] }>(`/scope?projectId=${encodeURIComponent(projectId)}`, { organizationId });
    return data.boqs ?? [];
  } catch (err) {
    console.error(`[google-sheets] failed to load BOQ for project ${projectId}:`, err instanceof Error ? err.message : err);
    return [];
  }
}

async function pushProjectsTab(spreadsheetId: string, projects: VeridianProject[]): Promise<void> {
  await clearAndWrite(
    spreadsheetId,
    SHEET_TITLES.PROJECTS,
    "A",
    2,
    "B",
    projects.map((p) => [p.id, p.name])
  );
}

async function pushRolesTab(spreadsheetId: string, roster: { email: string; role: string }[]): Promise<void> {
  // Regenerates the whole tab from the live roster every refresh -- Status/
  // Submitted By/New Role/Result are reset blank in the process. A known,
  // documented tradeoff (see the settings card's help text): "Refresh"
  // clears any in-progress, not-yet-submitted edits on this tab.
  await clearAndWrite(
    spreadsheetId,
    SHEET_TITLES.ROLES,
    "A",
    2,
    "F",
    roster.map((m) => ["", "", m.email, m.role, "", ""])
  );
}

async function pushBulkEditTab(spreadsheetId: string, organizationId: string, projects: VeridianProject[]): Promise<void> {
  const rows: (string | number)[][] = [];
  for (const project of projects) {
    const boqs = await fetchBoqsForProject(organizationId, project.id);
    for (const boq of boqs) {
      for (const item of boq.lineItems ?? []) {
        rows.push([
          "",
          "",
          String(item.id ?? ""),
          project.name,
          String(boq.title ?? ""),
          String(item.itemCode ?? ""),
          String(item.description ?? ""),
          String(item.unit ?? ""),
          Number(item.quantity ?? 0),
          Number(item.rate ?? 0),
          String(item.category ?? ""),
          "",
        ]);
      }
    }
  }
  // Same documented tradeoff as Roles: this fully regenerates from live BOQ
  // state on every refresh, since there is no cheap way to know which rows
  // a user has half-edited without a much larger change-tracking design.
  await clearAndWrite(spreadsheetId, SHEET_TITLES.BULK_EDIT, "A", 2, "L", rows);
}

async function pushReportsTab(spreadsheetId: string, organizationId: string, projects: VeridianProject[]): Promise<void> {
  const reportName = await readCell(spreadsheetId, SHEET_TITLES.REPORTS, "A2");
  const projectName = await readCell(spreadsheetId, SHEET_TITLES.REPORTS, "B2");
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: `'${SHEET_TITLES.REPORTS}'!A${REPORT_OUTPUT_START_ROW}:Z5000` });

  if (!reportName || !projectName) return;
  const project = projects.find((p) => p.name === projectName);
  if (!project) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${SHEET_TITLES.REPORTS}'!A${REPORT_OUTPUT_START_ROW}`,
      valueInputOption: "RAW",
      requestBody: { values: [[`No project named "${projectName}" -- pick one from the dropdown.`]] },
    });
    return;
  }

  try {
    const data = await callVeridian(`/reports/${encodeURIComponent(reportName)}?projectId=${encodeURIComponent(project.id)}`, { organizationId });
    const grid = flattenReportToGrid(data);
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${SHEET_TITLES.REPORTS}'!A${REPORT_OUTPUT_START_ROW}`,
      valueInputOption: "RAW",
      requestBody: { values: grid },
    });
  } catch (err) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${SHEET_TITLES.REPORTS}'!A${REPORT_OUTPUT_START_ROW}`,
      valueInputOption: "RAW",
      requestBody: { values: [[err instanceof Error ? err.message : "Failed to load report"]] },
    });
  }
}

async function pushAnalysisTab(spreadsheetId: string, organizationId: string, projects: VeridianProject[]): Promise<void> {
  const projectName = await readCell(spreadsheetId, SHEET_TITLES.ANALYSIS, "A2");
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: `'${SHEET_TITLES.ANALYSIS}'!A${REPORT_OUTPUT_START_ROW}:Z5000` });
  if (!projectName) return;
  const project = projects.find((p) => p.name === projectName);
  if (!project) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${SHEET_TITLES.ANALYSIS}'!A${REPORT_OUTPUT_START_ROW}`,
      valueInputOption: "RAW",
      requestBody: { values: [[`No project named "${projectName}" -- pick one from the dropdown.`]] },
    });
    return;
  }

  const grid: string[][] = [];
  for (const reportName of ANALYSIS_REPORT_NAMES) {
    try {
      const data = await callVeridian(`/reports/${encodeURIComponent(reportName)}?projectId=${encodeURIComponent(project.id)}`, { organizationId });
      grid.push(...flattenReportToGrid(data, reportName), []);
    } catch (err) {
      grid.push([`### ${reportName}`], [err instanceof Error ? err.message : "Failed to load"], []);
    }
  }
  if (grid.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${SHEET_TITLES.ANALYSIS}'!A${REPORT_OUTPUT_START_ROW}`,
      valueInputOption: "RAW",
      requestBody: { values: grid },
    });
  }
}

export async function pushDataToSheet(organizationId: string): Promise<void> {
  const integration = await getIntegration(organizationId);
  const spreadsheetId = integration.spreadsheetId;

  const [projects, roster] = await Promise.all([fetchProjects(organizationId), getOrgRoster(organizationId)]);

  await pushProjectsTab(spreadsheetId, projects);
  await pushRolesTab(spreadsheetId, roster);
  await pushBulkEditTab(spreadsheetId, organizationId, projects);
  await pushReportsTab(spreadsheetId, organizationId, projects);
  await pushAnalysisTab(spreadsheetId, organizationId, projects);
  await applyAdminProtectedRanges(
    spreadsheetId,
    roster.filter((m) => ADMIN_ROLES.includes(m.role)).map((m) => m.email)
  );

  await db
    .update(googleSheetsIntegration)
    .set({ lastPushedAt: new Date(), status: "idle", lastError: null, updatedAt: new Date() })
    .where(eq(googleSheetsIntegration.organizationId, organizationId));
}
