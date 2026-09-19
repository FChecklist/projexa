import { NextResponse } from "next/server";
import { randomBytes, createHash } from "node:crypto";
import { requireAuth, requireRole, ROLE_GROUPS } from "@/lib/supabase/auth-guard";
import { db, googleSheetsIntegration, organizations } from "@/lib/db";
import { eq } from "drizzle-orm";
import { createOrgSpreadsheet } from "@/lib/google-sheets/spreadsheet-builder";
import { buildAppsScriptSource } from "@/lib/google-sheets/apps-script-template";
import { withTiming } from "@/lib/with-timing";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3100";

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

// Owner/admin only, mirroring WorkspaceConnectionCard's own repair action --
// creating an org-wide spreadsheet and sharing it with every member is a
// privileged, org-level action, not something any member should trigger.
export const POST = withTiming("POST", async function POST() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const roleError = requireRole(ctx, ROLE_GROUPS.ORG_ADMIN);
  if (roleError) return roleError;

  const organizationId = ctx.organizationId!;

  const existing = await db.query.googleSheetsIntegration.findFirst({ where: eq(googleSheetsIntegration.organizationId, organizationId) });
  if (existing) {
    return NextResponse.json({ error: "Google Sheets is already connected for this organization. Disconnect first to recreate it." }, { status: 409 });
  }

  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, organizationId) });
  if (!org) return NextResponse.json({ error: "Organization not found" }, { status: 404 });

  let spreadsheetId: string;
  let spreadsheetUrl: string;
  try {
    ({ spreadsheetId, spreadsheetUrl } = await createOrgSpreadsheet(organizationId, org.name));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to create the Google Sheet" }, { status: 502 });
  }

  const rawToken = randomBytes(24).toString("base64url");
  await db.insert(googleSheetsIntegration).values({
    organizationId,
    spreadsheetId,
    spreadsheetUrl,
    webhookTokenHash: hashToken(rawToken),
  });

  const appsScriptSource = buildAppsScriptSource({ webhookToken: rawToken, organizationId, baseUrl: APP_URL });

  return NextResponse.json({ spreadsheetUrl, appsScriptSource }, { status: 201 });
});
