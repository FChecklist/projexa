"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Copy, Loader2, UserPlus } from "lucide-react";
import { formatDate } from "@/lib/format-date";

// R48_NO_INVITE_UI_01. Ruled at L5: SAP, Dynamics 365 and Odoo all place user
// provisioning under organisation admin settings, so that is where this sits.
//
// THE LINK IS OURS, NOT SUPABASE'S. Site URL on the projexa auth project is
// still http://localhost:3000, so anything Supabase mails is dead on arrival.
// The admin copies the link and delivers it however they already talk to that
// person. The invite is bound to its email address server-side
// (public.accept_org_invite), so a forwarded link grants nothing to anyone
// else -- it is a delivery convenience, not a bearer credential.

type Invite = {
  id: string;
  email: string;
  role: string;
  token: string;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
};

const ASSIGNABLE_ROLES = ["owner", "admin", "pm", "site_engineer", "member", "client_viewer"] as const;

function inviteUrl(token: string) {
  return `${window.location.origin}/invite/${token}`;
}

function statusOf(i: Invite): { label: string; variant: "default" | "secondary" | "outline" } {
  if (i.accepted_at) return { label: "Accepted", variant: "default" };
  if (i.revoked_at) return { label: "Revoked", variant: "outline" };
  if (new Date(i.expires_at) < new Date()) return { label: "Expired", variant: "outline" };
  return { label: "Pending", variant: "secondary" };
}

export default function OrgInvitesCard() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("member");
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/org/invites");
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error((body as { error?: string }).error ?? "Couldn't load invitations");
      return;
    }
    setInvites((body as { invites: Invite[] }).invites ?? []);
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  async function invite() {
    setSubmitting(true);
    try {
      const res = await fetch("/api/org/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const body = await res.json().catch(() => ({}));
      // C09 SUBMIT_TRUTHFUL: never a success toast for a request that failed.
      if (!res.ok) throw new Error((body as { error?: string }).error ?? "Could not create the invitation");
      const created = (body as { invite: Invite }).invite;
      setEmail("");
      await load();
      try {
        await navigator.clipboard.writeText(inviteUrl(created.token));
        toast.success(`Invitation created for ${created.email} — link copied to your clipboard`);
      } catch {
        // Clipboard can be blocked by permissions; say what actually happened
        // rather than claiming a copy that did not occur.
        toast.success(`Invitation created for ${created.email} — use Copy link to share it`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create the invitation");
    } finally {
      setSubmitting(false);
    }
  }

  async function revoke(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/org/invites/${id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? "Could not revoke the invitation");
      toast.success("Invitation revoked");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not revoke the invitation");
    } finally {
      setBusyId(null);
    }
  }

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(inviteUrl(token));
      toast.success("Invitation link copied");
    } catch {
      toast.error("Your browser blocked clipboard access — copy the link from the address bar instead");
    }
  }

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="text-base">Invite people</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="invite-email">Email address</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-role">Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger id="invite-role" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ASSIGNABLE_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={invite} disabled={submitting || !email.trim()}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />} Invite
          </Button>
        </div>

        <p className="text-[12px] text-px-muted">
          The person receives a link you share with them. It only works for the email address above, and it
          expires in 14 days.
        </p>

        {loading ? (
          <p className="py-6 text-center text-sm text-px-muted">Loading invitations…</p>
        ) : invites.length === 0 ? (
          <p className="py-6 text-center text-sm text-px-muted">No invitations yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invites.map((i) => {
                const status = statusOf(i);
                const open = status.label === "Pending";
                return (
                  <TableRow key={i.id}>
                    <TableCell>{i.email}</TableCell>
                    <TableCell className="text-px-muted">{i.role}</TableCell>
                    <TableCell>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </TableCell>
                    <TableCell className="text-px-muted">{formatDate(i.expires_at)}</TableCell>
                    <TableCell className="text-right">
                      {open && (
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" size="sm" onClick={() => copy(i.token)}>
                            <Copy className="size-3.5" /> Copy link
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => revoke(i.id)}
                            disabled={busyId === i.id}
                          >
                            {busyId === i.id ? <Loader2 className="size-3.5 animate-spin" /> : "Revoke"}
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
