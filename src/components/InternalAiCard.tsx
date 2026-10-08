"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { formatDate } from "@/lib/format-date";
import { viaPxApi } from "@/lib/px-api";

// P6 (aims 5-6). The organisation owner's one switch for PROJEXA's own AI. Default OFF: the person's own AI is always the first choice
// and nothing of ours calls a model unless the owner allows it here. The page is a UX affordance for owner/admin; the real gate is
// PUT /api/org/internal-ai (answered by the projexa-api Edge function via viaPxApi, ORG_ADMIN; the Next handler is the requireRole ORG_ADMIN fallback) and the same check again on the VERIDIAN side.
export const INTERNAL_AI_SWITCH_LABEL = "Allow PROJEXA's own AI for this organisation";
export const INTERNAL_AI_EXPLANATION =
  "Off by default: your people use their own AI. When on, PROJEXA's own AI can answer typed requests here. It can never change code, and it acts only within each person's role.";

type State = { allowed: boolean; changedAt: string | null };

export default function InternalAiCard() {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    viaPxApi("/api/org/internal-ai")
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((body as { error?: string }).error ?? "Couldn't load this setting");
        if (live) setState({ allowed: (body as State).allowed === true, changedAt: (body as State).changedAt ?? null });
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Couldn't load this setting"));
    return () => { live = false; };
  }, []);

  async function change(next: boolean) {
    setBusy(true);
    try {
      const res = await viaPxApi("/api/org/internal-ai", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowed: next }),
      });
      const body = await res.json().catch(() => ({}));
      // Never a success message for a change that did not save; the switch shows what the server says now.
      if (!res.ok) throw new Error((body as { error?: string }).error ?? "Could not save this setting");
      setState({ allowed: (body as State).allowed === true, changedAt: (body as State).changedAt ?? null });
      toast.success(next ? "PROJEXA's own AI is allowed for this organisation" : "PROJEXA's own AI is off for this organisation");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save this setting");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="shadow-card" data-testid="internal-ai-card">
      <CardHeader><CardTitle className="text-base">PROJEXA&apos;s own AI</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center gap-3">
          <Switch
            id="internal-ai-switch"
            data-testid="internal-ai-switch"
            aria-label={INTERNAL_AI_SWITCH_LABEL}
            checked={state?.allowed === true}
            disabled={state === null || busy}
            onCheckedChange={(v) => void change(v)}
          />
          <label htmlFor="internal-ai-switch" className="text-sm font-medium text-px-ink">{INTERNAL_AI_SWITCH_LABEL}</label>
        </div>
        <p className="text-xs text-px-muted">{INTERNAL_AI_EXPLANATION}</p>
        {state?.changedAt ? <p className="text-xs text-px-muted" data-testid="internal-ai-changed">Last changed {formatDate(state.changedAt)}</p> : null}
      </CardContent>
    </Card>
  );
}
