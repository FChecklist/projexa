"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAwlClient } from "@/lib/ai-work-link-client";
import { LINK_DAYS, OAUTH_BASE, decodeConsentPayload, denyAddress, safeReturnAddress, tokenFromLink } from "@/lib/connectors/consent";

type Phase = "ask" | "working" | "error";

/** Plain words, one decision: let this AI tool use PROJEXA as you (read and draft; you confirm changes), for 30 days. */
export function ConnectAuthorizeClient({ payload }: { payload: string }) {
  const request = useMemo(() => decodeConsentPayload(payload), [payload]);
  const [phase, setPhase] = useState<Phase>("ask");
  const [message, setMessage] = useState("");

  if (!request) {
    return (
      <main className="mx-auto max-w-md p-6" data-testid="connect-invalid">
        <Card>
          <CardHeader>
            <CardTitle>This sign-in request is not valid</CardTitle>
          </CardHeader>
          <CardContent>Close this window and start again from your AI tool.</CardContent>
        </Card>
      </main>
    );
  }

  async function allow() {
    if (!request) return;
    setPhase("working");
    try {
      const minted = await getAwlClient().mintUserLink({ days: LINK_DAYS, label: `${request.clientName} (sign-in)` });
      const token = tokenFromLink(minted.link);
      if (!token) throw new Error("The link could not be read.");
      const res = await fetch(`${OAUTH_BASE}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: request.clientId, redirect_uri: request.redirectUri, code_challenge: request.codeChallenge, state: request.state, link_token: token }),
      });
      const body = (await res.json().catch(() => null)) as { redirect?: string; error_description?: string } | null;
      if (!res.ok || !body?.redirect || !safeReturnAddress(body.redirect)) throw new Error(body?.error_description ?? "The sign-in service did not accept this request.");
      window.location.assign(body.redirect);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Something went wrong.");
      setPhase("error");
    }
  }

  return (
    <main className="mx-auto max-w-md p-6" data-testid="connect-authorize">
      <Card>
        <CardHeader>
          <CardTitle>Let {request.clientName} use PROJEXA as you?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>It can read your projects and records, and draft changes. You confirm every change in PROJEXA.</li>
            <li>It sees only what your own role allows, never more.</li>
            <li>It works for {LINK_DAYS} days. You can switch it off any time from your AI link settings.</li>
          </ul>
          {phase === "error" && (
            <p role="alert" className="text-sm text-red-600" data-testid="connect-error">
              {message}
            </p>
          )}
          <div className="flex gap-2">
            <Button onClick={allow} disabled={phase === "working"} data-testid="connect-allow">
              {phase === "working" ? "Connecting…" : "Allow"}
            </Button>
            <Button variant="outline" disabled={phase === "working"} data-testid="connect-deny" onClick={() => window.location.assign(denyAddress(request))}>
              Not now
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
