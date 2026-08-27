"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/format-date";
import OrgInvitesCard from "@/components/OrgInvitesCard";
import WorkspaceConnectionCard from "@/components/WorkspaceConnectionCard";

type OrgInfo = { organization: { id: string; name: string; slug: string; created_at: string }; role: string; email: string };
type Member = { user_id: string; role: string; profiles: { email: string; display_name: string | null } | null };
type BaseCurrency = { id: string; code: string; name: string; symbol: string | null } | null;

// R48_NO_CURRENCY_UI_01. Mirrors the fixed set erp-accounting-service.ts's
// setBaseCurrency() already knows a display name for (CURRENCY_NAMES) --
// PUT accepts any 3-letter ISO code, but a bounded dropdown of the codes
// this org's markets actually use (AED/GCC + the existing INR base) is
// safer than a free-text field nobody can validate at a glance.
const CURRENCY_OPTIONS = [
  { code: "AED", name: "UAE Dirham" },
  { code: "INR", name: "Indian Rupee" },
  { code: "USD", name: "US Dollar" },
  { code: "EUR", name: "Euro" },
  { code: "GBP", name: "Pound Sterling" },
  { code: "SAR", name: "Saudi Riyal" },
  { code: "QAR", name: "Qatari Riyal" },
  { code: "OMR", name: "Omani Rial" },
  { code: "BHD", name: "Bahraini Dinar" },
  { code: "KWD", name: "Kuwaiti Dinar" },
] as const;

const ROLE_VARIANT: Record<string, "default" | "secondary" | "outline"> = { owner: "default", admin: "secondary", member: "outline" };

// Mirrors ALL_ORG_ROLES in src/lib/supabase/auth-guard.ts -- kept as a
// plain client-side list rather than importing that (server-only) module.
const ASSIGNABLE_ROLES = ["owner", "admin", "pm", "site_engineer", "member", "client_viewer"] as const;

// Owner/admin only -- matches ROLE_GROUPS.ORG_ADMIN's server-side gate on
// PATCH /api/org-members/[id]; this is a UX affordance only (hides a
// control the caller couldn't use), not itself the security boundary.
const CAN_ASSIGN_ROLES = new Set(["owner", "admin"]);

export default function SettingsClient() {
  const router = useRouter();
  const [info, setInfo] = useState<OrgInfo | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [currency, setCurrency] = useState<BaseCurrency>(null);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [savingCurrency, setSavingCurrency] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/organization").then((r) => r.json()),
      fetch("/api/org-members").then((r) => r.json()),
    ])
      .then(([orgData, memberData]) => {
        if (orgData.error) throw new Error(orgData.error);
        setInfo(orgData);
        setMembers(memberData.members ?? []);
      })
      .catch(() => toast.error("Couldn't load settings"))
      .finally(() => setLoading(false));

    // Fetched outside the Promise.all above, deliberately: this proxies to
    // VERIDIAN (see R46, the documented chronic upstream-timeout history),
    // and a slow/failed currency read must not block Name/Slug/Team from
    // ever rendering. Failure here just leaves currency showing "Not set"
    // rather than surfacing a toast for a field nobody asked to change yet.
    fetch("/api/organization/currency")
      .then((r) => r.json())
      .then((d: { baseCurrency?: BaseCurrency; error?: string }) => {
        if (!d.error) setCurrency(d.baseCurrency ?? null);
      })
      .catch(() => {});
  }, []);

  async function changeRole(userId: string, role: string) {
    setUpdatingId(userId);
    try {
      const res = await fetch(`/api/org-members/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update role");
      setMembers((prev) => prev.map((m) => (m.user_id === userId ? { ...m, role } : m)));
      toast.success("Role updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update role");
    } finally {
      setUpdatingId(null);
    }
  }

  async function changeCurrency(code: string) {
    setSavingCurrency(true);
    try {
      const res = await fetch("/api/organization/currency", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update currency");
      setCurrency(data.baseCurrency ?? null);
      toast.success(`Organization currency set to ${data.baseCurrency?.code ?? code}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update currency");
    } finally {
      setSavingCurrency(false);
    }
  }

  async function signOut() {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  if (loading) {
    return <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>;
  }

  return (
    <div className="space-y-6">
      <Card className="shadow-card">
        <CardHeader><CardTitle className="text-base">Organization</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div><div className="text-xs text-px-muted">Name</div><div className="font-medium text-px-ink">{info?.organization.name ?? "—"}</div></div>
          <div><div className="text-xs text-px-muted">Slug</div><div className="font-medium text-px-ink">{info?.organization.slug ?? "—"}</div></div>
          <div><div className="text-xs text-px-muted">Member since</div><div className="font-medium text-px-ink">{info ? formatDate(info.organization.created_at) : "—"}</div></div>
          {/* R48_NO_CURRENCY_UI_01: the org's base currency, explicit rather
              than an implicit default -- "Not set" is shown as-is rather
              than silently assumed, per R-62/R-63 (a company currency must
              be a visible setting or a visible config error, never a guess).
              Edit control gated the same way Team-table role assignment is:
              a UX affordance mirroring the real gate, which is
              API_WRITE_POLICY's ORG_ADMIN tier on PUT (middleware.ts), not
              this client-side check. */}
          <div>
            <div className="text-xs text-px-muted">Currency</div>
            {info && CAN_ASSIGN_ROLES.has(info.role) ? (
              <Select value={currency?.code ?? ""} onValueChange={changeCurrency} disabled={savingCurrency}>
                <SelectTrigger size="sm" className="h-7 w-full sm:w-28">
                  <SelectValue placeholder="Not set" />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCY_OPTIONS.map((c) => (
                    <SelectItem key={c.code} value={c.code}>{c.code} — {c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="font-medium text-px-ink">{currency?.code ?? "Not set"}</div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardHeader><CardTitle className="text-base">Your Account</CardTitle></CardHeader>
        <CardContent className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="font-medium text-px-ink">{info?.email ?? "—"}</div>
            {info && <Badge variant={ROLE_VARIANT[info.role] ?? "outline"}>{info.role}</Badge>}
          </div>
          <Button variant="outline" onClick={signOut} disabled={signingOut}>
            {signingOut ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />} Sign Out
          </Button>
        </CardContent>
      </Card>

      {/* R48_NO_INVITE_UI_01: org-admin user provisioning, placed with the
          rest of organisation administration (ruled at L5 -- SAP, Dynamics
          365 and Odoo all put it here). Rendered for owner/admin only, which
          is a UX affordance; the real gate is requireRole(ORG_ADMIN) on the
          API plus RLS in drizzle/0015_org_invites.sql. */}
      {info && <WorkspaceConnectionCard canRepair={CAN_ASSIGN_ROLES.has(info.role)} />}
      {info && CAN_ASSIGN_ROLES.has(info.role) && <OrgInvitesCard />}

      <Card className="shadow-card">
        <CardHeader><CardTitle className="text-base">Team</CardTitle></CardHeader>
        <CardContent className="p-0">
          {members.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No other teammates in this organization yet.</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Email</TableHead><TableHead>Name</TableHead><TableHead>Role</TableHead></TableRow></TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.user_id}>
                    <TableCell>{m.profiles?.email ?? "—"}</TableCell>
                    <TableCell className="text-px-muted">{m.profiles?.display_name ?? "—"}</TableCell>
                    <TableCell>
                      {info && CAN_ASSIGN_ROLES.has(info.role) ? (
                        <Select
                          value={m.role}
                          onValueChange={(role) => changeRole(m.user_id, role)}
                          disabled={updatingId === m.user_id}
                        >
                          <SelectTrigger size="sm" className="w-40"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {ASSIGNABLE_ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant={ROLE_VARIANT[m.role] ?? "outline"}>{m.role}</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
