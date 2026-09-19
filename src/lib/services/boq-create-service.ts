import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// Extracted from src/app/api/scope/route.ts's POST handler so the Google
// Sheets bulk-entry sync (src/lib/google-sheets/pull.ts) gets the exact same
// protection, not a re-implementation that could silently drop it.
//
// R46M13_TC10_01 (fault reproduced live 3x on projexa-ai.com, 2026-08-25):
// creating a parent + 3-weighted-children BOQ through the real "New BOQ"
// dialog showed a green "BOQ created" toast while NOTHING was persisted. A
// create is only reported as success when the response PROVES the write
// landed: a real row id, plus at least as many line items as were
// submitted -- see the original route for the full incident writeup.

export type CreatedBoqResponse = { id?: unknown; lineItems?: unknown; error?: unknown };

export class BoqCreateVerificationError extends Error {}

export async function createBoqVerified(
  organizationId: string,
  body: { title?: string; projectId?: string; lineItems?: unknown },
  acting?: { actingUserId?: string; actingUserEmail?: string }
): Promise<CreatedBoqResponse> {
  const requestedLineItems = Array.isArray(body?.lineItems) ? body.lineItems.length : 0;

  const data = await callVeridian<CreatedBoqResponse>("/scope", {
    organizationId,
    method: "POST",
    body,
    actingUserId: acting?.actingUserId,
    actingUserEmail: acting?.actingUserEmail,
  });

  const savedId = typeof data?.id === "string" ? data.id.trim() : "";
  if (!savedId) {
    throw new BoqCreateVerificationError(
      "BOQ was not created: the scope service reported success but returned no saved BOQ. Nothing has been saved -- please try again."
    );
  }

  const savedLineItems = Array.isArray(data.lineItems) ? data.lineItems.length : 0;
  if (savedLineItems < requestedLineItems) {
    throw new BoqCreateVerificationError(
      `BOQ was not saved correctly: ${requestedLineItems} line item(s) were submitted but only ${savedLineItems} came back saved. Check the BOQ list before retrying.`
    );
  }

  return data;
}

export function boqCreateErrorMessage(err: unknown): string {
  if (err instanceof BoqCreateVerificationError) return err.message;
  if (err instanceof VeridianApiError) return err.message;
  return "Failed to create BOQ";
}
