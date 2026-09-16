import { NextRequest, NextResponse } from "next/server";
import { consumeEmailActionToken, applyOneClickAction } from "@/lib/services/email-token-service";
import { db, securityAuditLog } from "@/lib/db";

// PUBLIC, unauthenticated by necessity -- this is what "no sign-in" for a
// routine, reversible, one-click email action means. Safety comes from the
// token itself: single-use (enforced atomically in consumeEmailActionToken),
// membership-scoped, and org-matched by a real DB trigger at issue time (see
// email-token-service.ts's own header) -- not from anything checked here.
function page(title: string, body: string, status: number): NextResponse {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>body{font-family:Inter,Arial,sans-serif;background:#FFFDF9;margin:0;padding:48px 20px;color:#1C2B3A}
.card{max-width:420px;margin:0 auto;background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:28px;text-align:center}
h1{font-size:18px;margin:0 0 10px}p{font-size:14px;color:#4B5568;line-height:1.5;margin:0}</style></head>
<body><div class="card"><h1>${title}</h1><p>${body}</p></div></body></html>`;
  return new NextResponse(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const result = await consumeEmailActionToken(token);

  if (!result.ok) {
    await db.insert(securityAuditLog).values({
      event: "email_action_token_refused",
      actor: "public_link",
      metadata: { reason: result.reason },
    });
    const messages: Record<string, string> = {
      not_found: "This link doesn't match anything we know about — it may have been copied incorrectly.",
      already_used: "This link has already been used. If you clicked it before, that action already went through — nothing more to do here.",
      expired: "This link has expired. Ask for a fresh one if you still need to act on it.",
    };
    return page("This link isn't valid", messages[result.reason] ?? "This link can't be used.", 410);
  }

  await applyOneClickAction(result.todoId, result.action);
  await db.insert(securityAuditLog).values({
    event: "email_action_token_applied",
    actor: "public_link",
    metadata: { todoId: result.todoId, action: result.action },
  });

  return page("Done", "Thanks — that's recorded. You can close this page.", 200);
}
