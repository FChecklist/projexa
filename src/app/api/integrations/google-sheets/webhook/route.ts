import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { db, googleSheetsIntegration } from "@/lib/db";
import { eq } from "drizzle-orm";
import { pushDataToSheet } from "@/lib/google-sheets/push";
import { pullChangesFromSheet } from "@/lib/google-sheets/pull";
import { withTiming } from "@/lib/with-timing";

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

// The one endpoint in this feature that is deliberately NOT requireAuth() --
// it's called by Google's Apps Script servers, which have no PROJEXA
// session. Authenticated instead by a per-org bearer token (see
// setup/route.ts), verified with a constant-time comparison of its hash
// against googleSheetsIntegration.webhookTokenHash for the organizationId
// the caller claims. organizationId alone proves nothing -- it's only ever
// trusted once the token hash for THAT org matches, the same "public
// identifier + secret" shape as a username+password pair.
export const POST = withTiming("POST", async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
  if (!token) return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });

  let body: { action?: string; organizationId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }
  const { action, organizationId } = body;
  if (!organizationId || (action !== "refresh" && action !== "submit")) {
    return NextResponse.json({ error: "organizationId and action ('refresh' | 'submit') are required" }, { status: 400 });
  }

  const integration = await db.query.googleSheetsIntegration.findFirst({ where: eq(googleSheetsIntegration.organizationId, organizationId) });
  if (!integration) return NextResponse.json({ error: "Unknown organization" }, { status: 401 });

  const providedHash = Buffer.from(hashToken(token));
  const storedHash = Buffer.from(integration.webhookTokenHash);
  const tokenValid = providedHash.length === storedHash.length && timingSafeEqual(providedHash, storedHash);
  if (!tokenValid) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  try {
    if (action === "submit") {
      const result = await pullChangesFromSheet(organizationId);
      await pushDataToSheet(organizationId);
      return NextResponse.json(result);
    }
    await pushDataToSheet(organizationId);
    return NextResponse.json({ refreshed: true });
  } catch (err) {
    await db
      .update(googleSheetsIntegration)
      .set({ status: "error", lastError: err instanceof Error ? err.message : "Unknown error", updatedAt: new Date() })
      .where(eq(googleSheetsIntegration.organizationId, organizationId));
    return NextResponse.json({ error: err instanceof Error ? err.message : "Sync failed" }, { status: 502 });
  }
});
