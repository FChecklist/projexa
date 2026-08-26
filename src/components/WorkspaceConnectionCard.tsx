"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, PlugZap, CheckCircle2, AlertTriangle } from "lucide-react";

// The UI half of the half-provisioned-tenant repair.
//
// POST /api/org/repair shipped without any way for a customer to reach it,
// which meant the endpoint existed but the person it was built for still
// could not use it. This is that control.
//
// It is deliberately quiet when everything is fine: a connected workspace
// gets one short confirming line and no button, because a repair action
// offered to a healthy tenant is an invitation to break something. The
// button appears only when the server says the workspace is genuinely
// unconnected.
//
// Owner/admin only, mirroring ROLE_GROUPS.ORG_ADMIN on the route itself.
// That gate is a UX affordance, not the security boundary -- the route
// checks the role server-side regardless of what this component renders.

type Status = { organizationId: string; veridianConnected: boolean; repairAvailable: boolean };

export default function WorkspaceConnectionCard({ canRepair }: { canRepair: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [repairing, setRepairing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/org/repair");
      // Read the status before the body. An error body parses perfectly
      // well, and treating it as data is exactly how a failed request
      // becomes a confident-looking empty state elsewhere in this app.
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          data && typeof data.error === "string" && data.error.trim()
            ? data.error
            : `Couldn't check the workspace connection (HTTP ${res.status})`
        );
      }
      setStatus(data as Status);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't check the workspace connection");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canRepair) void load();
    else setLoading(false);
  }, [canRepair, load]);

  async function repair() {
    setRepairing(true);
    try {
      const res = await fetch("/api/org/repair", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          data && typeof data.error === "string" && data.error.trim()
            ? data.error
            : `Repair failed (HTTP ${res.status})`
        );
      }
      toast.success(
        data?.alreadyHealthy
          ? "This workspace was already connected. Nothing changed."
          : "Workspace reconnected."
      );
      await load();
      router.refresh();
    } catch (err) {
      // Keep the server's own words. "Failed to fetch" or a generic
      // sentence tells the admin nothing they can act on.
      toast.error(err instanceof Error ? err.message : "Repair failed");
    } finally {
      setRepairing(false);
    }
  }

  if (!canRepair) return null;

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <PlugZap className="h-4 w-4" aria-hidden />
          Workspace connection
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-px-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Checking…
          </p>
        ) : error ? (
          <div className="space-y-2">
            <p role="alert" className="flex items-start gap-2 text-sm text-px-error">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {error}
            </p>
            <Button variant="outline" size="sm" onClick={() => void load()}>Try again</Button>
          </div>
        ) : status?.veridianConnected ? (
          <p className="flex items-center gap-2 text-sm text-px-muted">
            <CheckCircle2 className="h-4 w-4 text-px-success" aria-hidden />
            Connected. Your projects, scope and reports are reading live data.
          </p>
        ) : (
          <div className="space-y-3">
            <p role="alert" className="text-sm text-px-error">
              This workspace is not connected to VERIDIAN, so project data cannot load. This
              happens when signup created the organisation but did not finish connecting it.
              Reconnecting is safe and does not affect your team or your existing records.
            </p>
            <Button onClick={() => void repair()} disabled={repairing}>
              {repairing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  Reconnecting…
                </>
              ) : (
                "Reconnect workspace"
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
