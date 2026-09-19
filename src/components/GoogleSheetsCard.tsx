"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Sheet, CheckCircle2, AlertTriangle, Copy, ExternalLink } from "lucide-react";

// Google Sheets integration settings card, modeled on WorkspaceConnectionCard:
// same loading/connected/error states, same owner/admin-only visibility
// (a UX affordance -- the real gate is requireRole(ORG_ADMIN) on every
// /api/integrations/google-sheets/* route this card calls).
//
// The one-time "paste this into Extensions > Apps Script" step exists
// because auto-deploying a bound Apps Script project is a separate, more
// fragile Google API surface than Sheets/Drive -- see the feature plan's
// "Why an Apps Script paste step" note. This card generates the exact
// script text (token/org id/URL already filled in) so that paste is the
// entire setup an admin has to do.

type Status = {
  connected: boolean;
  spreadsheetUrl?: string;
  status?: string;
  lastError?: string | null;
  lastPushedAt?: string | null;
  lastPulledAt?: string | null;
};

export default function GoogleSheetsCard({ canManage }: { canManage: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appsScriptSource, setAppsScriptSource] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations/google-sheets/status");
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Couldn't check the Google Sheets connection (HTTP ${res.status})`);
      setStatus(data as Status);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't check the Google Sheets connection");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canManage) void load();
    else setLoading(false);
  }, [canManage, load]);

  async function connect() {
    setConnecting(true);
    try {
      const res = await fetch("/api/integrations/google-sheets/setup", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Failed to connect (HTTP ${res.status})`);
      setAppsScriptSource(data.appsScriptSource ?? null);
      toast.success("Spreadsheet created. Copy the setup script below into it.");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to connect Google Sheets");
    } finally {
      setConnecting(false);
    }
  }

  async function refreshNow() {
    setRefreshing(true);
    try {
      const res = await fetch("/api/integrations/google-sheets/refresh", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Refresh failed (HTTP ${res.status})`);
      toast.success("Pushed the latest data to the sheet.");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  async function copyScript() {
    if (!appsScriptSource) return;
    try {
      await navigator.clipboard.writeText(appsScriptSource);
      toast.success("Script copied");
    } catch {
      toast.error("Couldn't copy automatically -- select the text manually below.");
    }
  }

  if (!canManage) return null;

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Sheet className="h-4 w-4" aria-hidden />
          Google Sheets
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
        ) : status?.connected ? (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm text-px-muted">
              <CheckCircle2 className="h-4 w-4 text-px-success" aria-hidden />
              Connected. Project updates, bulk entry/edit, reports and roles can be worked from the sheet.
            </p>
            {status.lastError && (
              <p role="alert" className="text-sm text-px-error">Last sync error: {status.lastError}</p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" asChild>
                <a href={status.spreadsheetUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="mr-2 h-4 w-4" aria-hidden /> Open spreadsheet
                </a>
              </Button>
              <Button variant="outline" size="sm" onClick={() => void refreshNow()} disabled={refreshing}>
                {refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
                Push to sheet now
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-px-muted">
              Creates one spreadsheet for this organization with tabs for new projects, project
              updates, bulk data entry/edit, reports, analysis and roles. A teammate can fill it in
              and submit changes back into PROJEXA from the sheet itself.
            </p>
            <Button onClick={() => void connect()} disabled={connecting}>
              {connecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
              Connect Google Sheets
            </Button>
          </div>
        )}

        {appsScriptSource && (
          <div className="space-y-2 rounded-md border border-px-border p-3">
            <p className="text-sm font-medium text-px-ink">One-time setup (about a minute)</p>
            <ol className="list-decimal space-y-1 pl-4 text-sm text-px-muted">
              <li>Open the spreadsheet above, then Extensions → Apps Script.</li>
              <li>Delete any starter code, paste the script below, and save.</li>
              <li>Reload the spreadsheet — a "PROJEXA" menu appears with Refresh/Submit.</li>
            </ol>
            <div className="flex items-center justify-between">
              <span className="text-xs text-px-muted">Contains a secret token for this organization — do not share it.</span>
              <Button variant="outline" size="sm" onClick={() => void copyScript()}>
                <Copy className="mr-2 h-4 w-4" aria-hidden /> Copy script
              </Button>
            </div>
            <pre className="max-h-48 overflow-auto rounded bg-muted p-2 text-xs">{appsScriptSource}</pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
