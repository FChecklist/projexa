import { sheets_v4 } from "googleapis";
import { getDriveClient, getSheetsClient } from "./client";
import {
  SHEET_TITLES,
  PROJECTS_COLUMNS,
  NEW_PROJECTS_COLUMNS,
  PROJECT_UPDATES_COLUMNS,
  BULK_ENTRY_COLUMNS,
  BULK_EDIT_COLUMNS,
  ROLES_COLUMNS,
  REPORT_NAMES,
  ORG_ROLES,
} from "./tabs";
import { db, memberships, profiles } from "@/lib/db";
import { eq } from "drizzle-orm";

// Explicit numeric sheetIds so every other file in this module can address
// a specific tab (for data validation, protected ranges, values.update)
// without re-discovering it via spreadsheets.get first.
export const SHEET_IDS: Record<keyof typeof SHEET_TITLES, number> = {
  PROJECTS: 0,
  NEW_PROJECTS: 1,
  PROJECT_UPDATES: 2,
  BULK_ENTRY: 3,
  BULK_EDIT: 4,
  REPORTS: 5,
  ANALYSIS: 6,
  ROLES: 7,
};

const REPORTS_COLUMNS = ["Report Name", "Project"] as const;
// Analysis has no report picker (it's a fixed dashboard of
// ANALYSIS_REPORT_NAMES, see push.ts) -- just a Project picker to scope it.
const ANALYSIS_COLUMNS = ["Project"] as const;
// Where flattened report output starts, leaving row 2 for the picker
// value(s) and row 3 blank as a visual separator.
export const REPORT_OUTPUT_START_ROW = 4;

const TAB_COLUMNS: Record<string, readonly string[]> = {
  [SHEET_TITLES.PROJECTS]: PROJECTS_COLUMNS,
  [SHEET_TITLES.NEW_PROJECTS]: NEW_PROJECTS_COLUMNS,
  [SHEET_TITLES.PROJECT_UPDATES]: PROJECT_UPDATES_COLUMNS,
  [SHEET_TITLES.BULK_ENTRY]: BULK_ENTRY_COLUMNS,
  [SHEET_TITLES.BULK_EDIT]: BULK_EDIT_COLUMNS,
  [SHEET_TITLES.REPORTS]: REPORTS_COLUMNS,
  [SHEET_TITLES.ANALYSIS]: ANALYSIS_COLUMNS,
  [SHEET_TITLES.ROLES]: ROLES_COLUMNS,
};

const ADMIN_ROLES = ["owner", "admin"];
const MAX_ROW = 1000;

function colIndex(columns: readonly string[], name: string): number {
  const idx = columns.indexOf(name);
  if (idx === -1) throw new Error(`Column "${name}" not found in [${columns.join(", ")}]`);
  return idx;
}

export async function getOrgRoster(organizationId: string): Promise<{ email: string; role: string }[]> {
  const rows = await db
    .select({ email: profiles.email, role: memberships.role })
    .from(memberships)
    .innerJoin(profiles, eq(memberships.userId, profiles.id))
    .where(eq(memberships.organizationId, organizationId));
  return rows.filter((r): r is { email: string; role: string } => !!r.email);
}

function oneOfList(values: readonly string[], strict = false): sheets_v4.Schema$DataValidationRule {
  return {
    condition: { type: "ONE_OF_LIST", values: values.map((v) => ({ userEnteredValue: v })) },
    showCustomUi: true,
    strict,
  };
}

// Dropdown sourced from the hidden Projects tab's name column (col B), kept
// fresh on every "Refresh" (see push.ts) rather than a static list.
function projectDropdownRule(): sheets_v4.Schema$DataValidationRule {
  return {
    condition: { type: "ONE_OF_RANGE", values: [{ userEnteredValue: `'${SHEET_TITLES.PROJECTS}'!B2:B${MAX_ROW}` }] },
    showCustomUi: true,
    strict: false,
  };
}

function dataValidationRequest(
  sheetId: number,
  columns: readonly string[],
  columnName: string,
  rule: sheets_v4.Schema$DataValidationRule,
  endRowIndex: number = MAX_ROW
): sheets_v4.Schema$Request {
  const col = colIndex(columns, columnName);
  return {
    setDataValidation: {
      range: { sheetId, startRowIndex: 1, endRowIndex, startColumnIndex: col, endColumnIndex: col + 1 },
      rule,
    },
  };
}

function boldHeaderRequest(sheetId: number, columnCount: number): sheets_v4.Schema$Request {
  return {
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: Math.max(columnCount, 1) },
      cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.92, green: 0.94, blue: 0.97 } } },
      fields: "userEnteredFormat(textFormat,backgroundColor)",
    },
  };
}

async function findProtectedRangeIds(spreadsheetId: string, sheetId: number): Promise<number[]> {
  const sheets = getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId, ranges: [], fields: "sheets(properties.sheetId,protectedRanges.protectedRangeId)" });
  const sheet = meta.data.sheets?.find((s) => s.properties?.sheetId === sheetId);
  return (sheet?.protectedRanges ?? []).map((p) => p.protectedRangeId!).filter((id) => id != null);
}

// Restricts editing on New Projects / Roles to the org's current owner/admin
// emails, since the webhook token only proves "this org's sheet," not "this
// specific user" -- any editor on the file could otherwise submit a role
// change the app itself would 403. Re-callable: drops and re-adds so it
// always reflects the current roster (called again by push.ts on refresh).
export async function applyAdminProtectedRanges(spreadsheetId: string, adminEmails: string[]): Promise<void> {
  const sheets = getSheetsClient();
  const targets = [SHEET_IDS.NEW_PROJECTS, SHEET_IDS.ROLES];

  const deleteRequests: sheets_v4.Schema$Request[] = [];
  for (const sheetId of targets) {
    const ids = await findProtectedRangeIds(spreadsheetId, sheetId);
    for (const protectedRangeId of ids) deleteRequests.push({ deleteProtectedRange: { protectedRangeId } });
  }
  if (deleteRequests.length) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: deleteRequests } });
  }

  const addRequests: sheets_v4.Schema$Request[] = targets.map((sheetId) => ({
    addProtectedRange: {
      protectedRange: {
        range: { sheetId },
        description: "Owner/admin only -- mirrors this app's own ROLE_GROUPS.ORG_ADMIN gate",
        warningOnly: false,
        editors: adminEmails.length ? { users: adminEmails } : undefined,
      },
    },
  }));
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: addRequests } });
}

async function applyValidationAndFormatting(spreadsheetId: string): Promise<void> {
  const sheets = getSheetsClient();
  const requests: sheets_v4.Schema$Request[] = [];

  for (const [key, title] of Object.entries(SHEET_TITLES)) {
    const sheetId = SHEET_IDS[key as keyof typeof SHEET_IDS];
    const columns = TAB_COLUMNS[title] ?? [];
    if (columns.length) requests.push(boldHeaderRequest(sheetId, columns.length));
  }

  const statusRule = oneOfList(["", "READY"]);
  requests.push(dataValidationRequest(SHEET_IDS.NEW_PROJECTS, NEW_PROJECTS_COLUMNS, "Status", statusRule));
  requests.push(dataValidationRequest(SHEET_IDS.PROJECT_UPDATES, PROJECT_UPDATES_COLUMNS, "Status", statusRule));
  requests.push(dataValidationRequest(SHEET_IDS.BULK_ENTRY, BULK_ENTRY_COLUMNS, "Status", statusRule));
  requests.push(dataValidationRequest(SHEET_IDS.BULK_EDIT, BULK_EDIT_COLUMNS, "Status", statusRule));
  requests.push(dataValidationRequest(SHEET_IDS.ROLES, ROLES_COLUMNS, "Status", statusRule));

  const projectRule = projectDropdownRule();
  requests.push(dataValidationRequest(SHEET_IDS.PROJECT_UPDATES, PROJECT_UPDATES_COLUMNS, "Project", projectRule));
  requests.push(dataValidationRequest(SHEET_IDS.BULK_ENTRY, BULK_ENTRY_COLUMNS, "Project", projectRule));

  requests.push(dataValidationRequest(SHEET_IDS.PROJECT_UPDATES, PROJECT_UPDATES_COLUMNS, "Entry Basis", oneOfList(["DELTA", "SNAPSHOT"])));
  requests.push(dataValidationRequest(SHEET_IDS.ROLES, ROLES_COLUMNS, "New Role", oneOfList(ORG_ROLES)));
  requests.push(dataValidationRequest(SHEET_IDS.REPORTS, REPORTS_COLUMNS, "Report Name", oneOfList(REPORT_NAMES), 2));
  requests.push(dataValidationRequest(SHEET_IDS.REPORTS, REPORTS_COLUMNS, "Project", projectRule, 2));
  requests.push(dataValidationRequest(SHEET_IDS.ANALYSIS, ANALYSIS_COLUMNS, "Project", projectRule, 2));

  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
}

export async function shareWithOrgMembers(spreadsheetId: string, organizationId: string): Promise<void> {
  const drive = getDriveClient();
  const roster = await getOrgRoster(organizationId);
  await Promise.all(
    roster.map((member) =>
      drive.permissions
        .create({
          fileId: spreadsheetId,
          sendNotificationEmail: false,
          requestBody: { type: "user", role: "writer", emailAddress: member.email },
        })
        .catch((err) => {
          // One bad/typo'd member email should not abort sharing for the
          // rest of the org -- surfaced in the setup response instead.
          console.error(`[google-sheets] failed to share with ${member.email}:`, err instanceof Error ? err.message : err);
        })
    )
  );
}

export async function createOrgSpreadsheet(organizationId: string, orgName: string): Promise<{ spreadsheetId: string; spreadsheetUrl: string }> {
  const sheets = getSheetsClient();

  const create = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: `PROJEXA - ${orgName}` },
      sheets: Object.entries(SHEET_IDS).map(([key, sheetId]) => ({
        properties: {
          sheetId,
          title: SHEET_TITLES[key as keyof typeof SHEET_TITLES],
          gridProperties: { frozenRowCount: 1 },
          hidden: key === "PROJECTS",
        },
      })),
    },
  });

  const spreadsheetId = create.data.spreadsheetId;
  const spreadsheetUrl = create.data.spreadsheetUrl;
  if (!spreadsheetId || !spreadsheetUrl) throw new Error("Google Sheets did not return a spreadsheet id/url");

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "RAW",
      data: Object.values(SHEET_TITLES)
        .filter((title) => (TAB_COLUMNS[title] ?? []).length > 0)
        .map((title) => ({ range: `'${title}'!A1`, values: [TAB_COLUMNS[title] as string[]] })),
    },
  });

  await applyValidationAndFormatting(spreadsheetId);

  const roster = await getOrgRoster(organizationId);
  await shareWithOrgMembers(spreadsheetId, organizationId);
  await applyAdminProtectedRanges(
    spreadsheetId,
    roster.filter((m) => ADMIN_ROLES.includes(m.role)).map((m) => m.email)
  );

  return { spreadsheetId, spreadsheetUrl };
}

export { TAB_COLUMNS, ADMIN_ROLES, MAX_ROW, REPORTS_COLUMNS, ANALYSIS_COLUMNS };
