import { getSheetsClient } from "./client";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";
import { db, googleSheetsIntegration, memberships, profiles } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { revalidateTag, revalidatePath } from "next/cache";
import { getOrgRoster } from "./spreadsheet-builder";
import {
  SHEET_TITLES,
  NEW_PROJECTS_COLUMNS,
  PROJECT_UPDATES_COLUMNS,
  BULK_ENTRY_COLUMNS,
  BULK_EDIT_COLUMNS,
  ROLES_COLUMNS,
  ORG_ROLES,
  STATUS_READY,
  STATUS_DONE,
  STATUS_ERROR,
} from "./tabs";
import { createBoqVerified, BoqCreateVerificationError } from "@/lib/services/boq-create-service";
import { updateMemberRole, LastAdminGuardError, MemberNotFoundError } from "@/lib/services/member-role-service";
import { ROLE_GROUPS, type OrgRole } from "@/lib/authz/roles";

type Roster = { email: string; role: string }[];
type ProjectLookup = Map<string, string>; // lowercased name -> id

async function getIntegration(organizationId: string) {
  const row = await db.query.googleSheetsIntegration.findFirst({ where: eq(googleSheetsIntegration.organizationId, organizationId) });
  if (!row) throw new Error(`No Google Sheets integration connected for organization ${organizationId}`);
  return row;
}

async function readTabRows(spreadsheetId: string, sheetTitle: string, columnCount: number): Promise<string[][]> {
  const sheets = getSheetsClient();
  const lastCol = String.fromCharCode("A".charCodeAt(0) + columnCount - 1);
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${sheetTitle}'!A2:${lastCol}5000` });
  return (res.data.values ?? []) as string[][];
}

async function writeRow(spreadsheetId: string, sheetTitle: string, rowIndex: number, columnCount: number, values: string[]): Promise<void> {
  const sheets = getSheetsClient();
  const lastCol = String.fromCharCode("A".charCodeAt(0) + columnCount - 1);
  const sheetRow = rowIndex + 2; // +1 for header, +1 for 1-indexing
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${sheetTitle}'!A${sheetRow}:${lastCol}${sheetRow}`,
    valueInputOption: "RAW",
    requestBody: { values: [values] },
  });
}

// Resolves the "Submitted By" email against the live roster. Every
// actionable row requires one, since the webhook token only proves "this
// request came from this org's connected sheet," never "this specific user
// is authorized" -- this is what lets the sheet path re-derive the same
// authorization the app itself would apply to a session-based request.
function resolveMember(roster: Roster, email: string): { email: string; role: string } | null {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) return null;
  return roster.find((m) => m.email.toLowerCase() === trimmed) ?? null;
}

function resolveProjectId(lookup: ProjectLookup, nameOrId: string): string | null {
  const trimmed = nameOrId.trim();
  if (!trimmed) return null;
  const byName = lookup.get(trimmed.toLowerCase());
  if (byName) return byName;
  // Fall back to treating the value as a raw project id, for a user who
  // pasted an id directly instead of using the dropdown.
  if ([...lookup.values()].includes(trimmed)) return trimmed;
  return null;
}

function messageOf(err: unknown): string {
  if (err instanceof BoqCreateVerificationError) return err.message;
  if (err instanceof LastAdminGuardError) return err.message;
  if (err instanceof MemberNotFoundError) return err.message;
  if (err instanceof VeridianApiError) {
    if (err.ruleCode) return `${err.ruleCode}${err.missing?.length ? `: ${err.missing.join(", ")}` : ""}`;
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return "Unknown error";
}

type Counters = { processed: number; succeeded: number; failed: number };

function bump(counters: Counters, ok: boolean) {
  counters.processed += 1;
  if (ok) counters.succeeded += 1;
  else counters.failed += 1;
}

async function fetchProjectLookup(organizationId: string): Promise<ProjectLookup> {
  const data = await callVeridian<{ projects: { id: string; name: string }[] }>("/projects", { organizationId });
  const lookup: ProjectLookup = new Map();
  for (const p of data.projects ?? []) lookup.set(p.name.trim().toLowerCase(), p.id);
  return lookup;
}

async function fetchProductLookup(organizationId: string): Promise<Map<string, string>> {
  const data = await callVeridian<{ products: { id: string; name: string }[] }>("/products", { organizationId });
  const lookup = new Map<string, string>();
  for (const p of data.products ?? []) lookup.set(p.name.trim().toLowerCase(), p.id);
  return lookup;
}

// Applies a set of {ColumnName: value} overrides onto a copy of an existing
// row, leaving every other column untouched -- so writing back Status/
// Result never clobbers the user's own input columns on the same row.
function patch(row: string[], col: (name: string) => number, overrides: Record<string, string>): string[] {
  const copy = [...row];
  for (const [name, value] of Object.entries(overrides)) copy[col(name)] = value;
  return copy;
}

async function processNewProjects(spreadsheetId: string, organizationId: string, roster: Roster, counters: Counters): Promise<void> {
  const rows = await readTabRows(spreadsheetId, SHEET_TITLES.NEW_PROJECTS, NEW_PROJECTS_COLUMNS.length);
  if (!rows.length) return;
  const products = await fetchProductLookup(organizationId);
  const col = (name: string) => NEW_PROJECTS_COLUMNS.indexOf(name as (typeof NEW_PROJECTS_COLUMNS)[number]);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if ((row[col("Status")] ?? "").trim().toUpperCase() !== STATUS_READY) continue;

    const submittedBy = row[col("Submitted By (your email)")] ?? "";
    const member = resolveMember(roster, submittedBy);
    if (!member) {
      await writeRow(spreadsheetId, SHEET_TITLES.NEW_PROJECTS, i, NEW_PROJECTS_COLUMNS.length, patch(row, col, { Status: STATUS_ERROR, Result: `"${submittedBy}" is not a current member of this organization.` }));
      bump(counters, false);
      continue;
    }

    const productName = row[col("Product")] ?? "";
    const productId = products.get(productName.trim().toLowerCase());
    const name = row[col("Name")] ?? "";
    if (!productId || !name.trim()) {
      await writeRow(
        spreadsheetId,
        SHEET_TITLES.NEW_PROJECTS,
        i,
        NEW_PROJECTS_COLUMNS.length,
        patch(row, col, { Status: STATUS_ERROR, Result: !productId ? `Unknown product "${productName}".` : "Name is required." })
      );
      bump(counters, false);
      continue;
    }

    try {
      const data = await callVeridian<{ id?: string }>("/projects", {
        organizationId,
        method: "POST",
        body: {
          productId,
          name: name.trim(),
          description: row[col("Description")] || undefined,
          startDate: row[col("Start Date")] || undefined,
          targetDate: row[col("Target Date")] || undefined,
        },
        actingUserEmail: member.email,
      });
      revalidateTag("projects", "max");
      await writeRow(spreadsheetId, SHEET_TITLES.NEW_PROJECTS, i, NEW_PROJECTS_COLUMNS.length, patch(row, col, { Status: STATUS_DONE, Result: `Created (id ${data.id ?? "?"})` }));
      bump(counters, true);
    } catch (err) {
      await writeRow(spreadsheetId, SHEET_TITLES.NEW_PROJECTS, i, NEW_PROJECTS_COLUMNS.length, patch(row, col, { Status: STATUS_ERROR, Result: messageOf(err) }));
      bump(counters, false);
    }
  }
}

async function processProjectUpdates(spreadsheetId: string, organizationId: string, roster: Roster, counters: Counters): Promise<void> {
  const rows = await readTabRows(spreadsheetId, SHEET_TITLES.PROJECT_UPDATES, PROJECT_UPDATES_COLUMNS.length);
  if (!rows.length) return;
  const projects = await fetchProjectLookup(organizationId);
  const col = (name: string) => PROJECT_UPDATES_COLUMNS.indexOf(name as (typeof PROJECT_UPDATES_COLUMNS)[number]);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if ((row[col("Status")] ?? "").trim().toUpperCase() !== STATUS_READY) continue;

    const member = resolveMember(roster, row[col("Submitted By (your email)")] ?? "");
    if (!member) {
      await writeRow(spreadsheetId, SHEET_TITLES.PROJECT_UPDATES, i, PROJECT_UPDATES_COLUMNS.length, patch(row, col, { Status: STATUS_ERROR, Result: "Submitted By is not a current member of this organization." }));
      bump(counters, false);
      continue;
    }

    const projectId = resolveProjectId(projects, row[col("Project")] ?? "");
    if (!projectId) {
      await writeRow(spreadsheetId, SHEET_TITLES.PROJECT_UPDATES, i, PROJECT_UPDATES_COLUMNS.length, patch(row, col, { Status: STATUS_ERROR, Result: `Unknown project "${row[col("Project")]}".` }));
      bump(counters, false);
      continue;
    }

    try {
      await callVeridian("/work-progress", {
        organizationId,
        method: "POST",
        body: {
          projectId,
          activityId: row[col("Activity ID")],
          boqLineItemId: row[col("BOQ Line Item ID (optional)")] || undefined,
          entryDate: row[col("Entry Date")],
          quantityDone: Number(row[col("Quantity Done")] || 0),
          percentComplete: Number(row[col("Percent Complete")] || 0),
          remarks: row[col("Remarks")] || undefined,
          entryBasis: row[col("Entry Basis")] || undefined,
          actorEmail: member.email,
        },
        // U-20b: named explicitly, like the other writes in this file, so the
        // row's author is sent even if a pull ever runs inside a signed-in
        // request -- an explicit identity always beats the session's
        // (veridian-client.ts), and the session user is not this row's author.
        actingUserEmail: member.email,
      });
      await writeRow(spreadsheetId, SHEET_TITLES.PROJECT_UPDATES, i, PROJECT_UPDATES_COLUMNS.length, patch(row, col, { Status: STATUS_DONE, Result: "Logged" }));
      bump(counters, true);
    } catch (err) {
      await writeRow(spreadsheetId, SHEET_TITLES.PROJECT_UPDATES, i, PROJECT_UPDATES_COLUMNS.length, patch(row, col, { Status: STATUS_ERROR, Result: messageOf(err) }));
      bump(counters, false);
    }
  }
}

type BoqGroup = { rowIndexes: number[]; projectName: string; title: string; submittedBy: string; lineItems: Record<string, unknown>[] };

async function processBulkEntry(spreadsheetId: string, organizationId: string, roster: Roster, counters: Counters): Promise<void> {
  const rows = await readTabRows(spreadsheetId, SHEET_TITLES.BULK_ENTRY, BULK_ENTRY_COLUMNS.length);
  if (!rows.length) return;
  const projects = await fetchProjectLookup(organizationId);
  const col = (name: string) => BULK_ENTRY_COLUMNS.indexOf(name as (typeof BULK_ENTRY_COLUMNS)[number]);

  // Group READY rows by (Project, BOQ Title) so several line items become
  // one BOQ create call, matching how a BOQ is actually created in the app
  // (one header + an array of line items), not one call per line item. The
  // "::" separator is safe here: it's never a legal character inside either
  // a spreadsheet-typed project name or BOQ title in practice, and even a
  // false collision would only merge two BOQs into one create call, which
  // fails loudly (title mismatch would still be visible in the created BOQ)
  // rather than silently corrupting data.
  const groups = new Map<string, BoqGroup>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if ((row[col("Status")] ?? "").trim().toUpperCase() !== STATUS_READY) continue;
    const projectName = row[col("Project")] ?? "";
    const title = row[col("BOQ Title")] ?? "";
    const key = `${projectName}::${title}`;
    if (!groups.has(key)) groups.set(key, { rowIndexes: [], projectName, title, submittedBy: row[col("Submitted By (your email)")] ?? "", lineItems: [] });
    const group = groups.get(key)!;
    group.rowIndexes.push(i);
    group.lineItems.push({
      itemCode: row[col("Item Code")] || undefined,
      parentItemCode: row[col("Parent Item Code")] || undefined,
      description: row[col("Description")],
      unit: row[col("Unit")],
      quantity: Number(row[col("Quantity")] || 0),
      rate: Number(row[col("Rate")] || 0),
      category: row[col("Category")] || undefined,
    });
  }

  const failGroup = async (group: BoqGroup, message: string) => {
    for (const idx of group.rowIndexes) {
      await writeRow(spreadsheetId, SHEET_TITLES.BULK_ENTRY, idx, BULK_ENTRY_COLUMNS.length, patch(rows[idx], col, { Status: STATUS_ERROR, Result: message }));
      bump(counters, false);
    }
  };

  for (const group of groups.values()) {
    const member = resolveMember(roster, group.submittedBy);
    const projectId = resolveProjectId(projects, group.projectName);

    if (!member) {
      await failGroup(group, "Submitted By is not a current member of this organization.");
      continue;
    }
    if (!projectId) {
      await failGroup(group, `Unknown project "${group.projectName}".`);
      continue;
    }
    if (!group.title.trim()) {
      await failGroup(group, "BOQ Title is required.");
      continue;
    }

    try {
      const data = await createBoqVerified(organizationId, { projectId, title: group.title.trim(), lineItems: group.lineItems }, { actingUserEmail: member.email });
      for (const idx of group.rowIndexes) {
        await writeRow(spreadsheetId, SHEET_TITLES.BULK_ENTRY, idx, BULK_ENTRY_COLUMNS.length, patch(rows[idx], col, { Status: STATUS_DONE, Result: `Created (BOQ ${String(data.id ?? "?")})` }));
        bump(counters, true);
      }
    } catch (err) {
      await failGroup(group, messageOf(err));
    }
  }
}

async function processBulkEdit(spreadsheetId: string, organizationId: string, roster: Roster, counters: Counters): Promise<void> {
  const rows = await readTabRows(spreadsheetId, SHEET_TITLES.BULK_EDIT, BULK_EDIT_COLUMNS.length);
  if (!rows.length) return;
  const col = (name: string) => BULK_EDIT_COLUMNS.indexOf(name as (typeof BULK_EDIT_COLUMNS)[number]);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if ((row[col("Status")] ?? "").trim().toUpperCase() !== STATUS_READY) continue;

    const member = resolveMember(roster, row[col("Submitted By (your email)")] ?? "");
    const lineItemId = row[col("Line Item ID")] ?? "";
    if (!member) {
      await writeRow(spreadsheetId, SHEET_TITLES.BULK_EDIT, i, BULK_EDIT_COLUMNS.length, patch(row, col, { Status: STATUS_ERROR, Result: "Submitted By is not a current member of this organization." }));
      bump(counters, false);
      continue;
    }
    if (!lineItemId.trim()) {
      await writeRow(spreadsheetId, SHEET_TITLES.BULK_EDIT, i, BULK_EDIT_COLUMNS.length, patch(row, col, { Status: STATUS_ERROR, Result: "Line Item ID is missing -- do not type new rows into this tab, only edit rows Refresh populated." }));
      bump(counters, false);
      continue;
    }

    try {
      await callVeridian(`/scope/line-items/${encodeURIComponent(lineItemId.trim())}`, {
        organizationId,
        method: "PATCH",
        body: {
          description: row[col("Description")],
          unit: row[col("Unit")],
          quantity: Number(row[col("Quantity")] || 0),
          rate: Number(row[col("Rate")] || 0),
          category: row[col("Category")] || undefined,
        },
        actingUserEmail: member.email,
      });
      await writeRow(spreadsheetId, SHEET_TITLES.BULK_EDIT, i, BULK_EDIT_COLUMNS.length, patch(row, col, { Status: STATUS_DONE, Result: "Updated" }));
      bump(counters, true);
    } catch (err) {
      await writeRow(spreadsheetId, SHEET_TITLES.BULK_EDIT, i, BULK_EDIT_COLUMNS.length, patch(row, col, { Status: STATUS_ERROR, Result: messageOf(err) }));
      bump(counters, false);
    }
  }
}

// getOrgRoster() (used everywhere else in this module) returns email/role
// only -- it has no userId, because push.ts's read-only tabs never needed
// one. Role changes DO need the underlying memberships.user_id.
async function lookupUserIdByEmail(organizationId: string, email: string): Promise<string> {
  const rows = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .innerJoin(profiles, eq(memberships.userId, profiles.id))
    .where(and(eq(memberships.organizationId, organizationId), eq(profiles.email, email)))
    .limit(1);
  if (!rows[0]) throw new MemberNotFoundError(`Member "${email}" not found`);
  return rows[0].userId;
}

async function processRoles(spreadsheetId: string, organizationId: string, roster: Roster, counters: Counters): Promise<void> {
  const rows = await readTabRows(spreadsheetId, SHEET_TITLES.ROLES, ROLES_COLUMNS.length);
  if (!rows.length) return;
  const col = (name: string) => ROLES_COLUMNS.indexOf(name as (typeof ROLES_COLUMNS)[number]);
  const userIdCache = new Map<string, string>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if ((row[col("Status")] ?? "").trim().toUpperCase() !== STATUS_READY) continue;

    const submittedBy = resolveMember(roster, row[col("Submitted By (your admin email)")] ?? "");
    // Mirrors ROLE_GROUPS.ORG_ADMIN on PATCH /api/org-members/[id] -- the
    // webhook token alone only proves "this org's sheet," so the row's own
    // Submitted-By identity is re-checked against the same gate the app
    // itself would apply to a session-based request.
    if (!submittedBy || !(ROLE_GROUPS.ORG_ADMIN as readonly string[]).includes(submittedBy.role)) {
      await writeRow(spreadsheetId, SHEET_TITLES.ROLES, i, ROLES_COLUMNS.length, patch(row, col, { Status: STATUS_ERROR, Result: "Only an owner/admin may submit a role change (Submitted By must resolve to one)." }));
      bump(counters, false);
      continue;
    }

    const targetEmail = (row[col("Member Email")] ?? "").trim().toLowerCase();
    const target = resolveMember(roster, targetEmail);
    const newRole = (row[col("New Role")] ?? "").trim() as OrgRole;
    if (!target) {
      await writeRow(spreadsheetId, SHEET_TITLES.ROLES, i, ROLES_COLUMNS.length, patch(row, col, { Status: STATUS_ERROR, Result: `"${targetEmail}" is not a current member.` }));
      bump(counters, false);
      continue;
    }
    if (!ORG_ROLES.includes(newRole)) {
      await writeRow(spreadsheetId, SHEET_TITLES.ROLES, i, ROLES_COLUMNS.length, patch(row, col, { Status: STATUS_ERROR, Result: `New Role must be one of: ${ORG_ROLES.join(", ")}.` }));
      bump(counters, false);
      continue;
    }

    try {
      let userId = userIdCache.get(targetEmail);
      if (!userId) {
        userId = await lookupUserIdByEmail(organizationId, targetEmail);
        userIdCache.set(targetEmail, userId);
      }
      await updateMemberRole(organizationId, userId, newRole);
      await writeRow(spreadsheetId, SHEET_TITLES.ROLES, i, ROLES_COLUMNS.length, patch(row, col, { Status: STATUS_DONE, Result: `Role set to ${newRole}` }));
      bump(counters, true);
    } catch (err) {
      await writeRow(spreadsheetId, SHEET_TITLES.ROLES, i, ROLES_COLUMNS.length, patch(row, col, { Status: STATUS_ERROR, Result: messageOf(err) }));
      bump(counters, false);
    }
  }
}

export async function pullChangesFromSheet(organizationId: string): Promise<Counters> {
  const integration = await getIntegration(organizationId);
  const spreadsheetId = integration.spreadsheetId;
  const roster = await getOrgRoster(organizationId);
  const counters: Counters = { processed: 0, succeeded: 0, failed: 0 };

  await processNewProjects(spreadsheetId, organizationId, roster, counters);
  await processProjectUpdates(spreadsheetId, organizationId, roster, counters);
  await processBulkEntry(spreadsheetId, organizationId, roster, counters);
  await processBulkEdit(spreadsheetId, organizationId, roster, counters);
  await processRoles(spreadsheetId, organizationId, roster, counters);

  if (counters.processed > 0) revalidatePath("/scope");

  await db
    .update(googleSheetsIntegration)
    .set({ lastPulledAt: new Date(), status: "idle", updatedAt: new Date() })
    .where(eq(googleSheetsIntegration.organizationId, organizationId));

  return counters;
}
