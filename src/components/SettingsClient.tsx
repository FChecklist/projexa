"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type OrgInfo = { organization: { id: string; name: string; slug: string; created_at: string }; role: string; email: string };
type Member = { user_id: string; role: string; profiles: { email: string; display_name: string | null } | null };

const ROLE_VARIANT: Record<string, "default" | "secondary" | "outline"> = { owner: "default", admin: "secondary", member: "outline" };

export default function SettingsClient() {
  const router = useRouter();
  const [info, setInfo] = useState<OrgInfo | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);

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
  }, []);

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
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div><div className="text-xs text-px-muted">Name</div><div className="font-medium text-px-ink">{info?.organization.name ?? "—"}</div></div>
          <div><div className="text-xs text-px-muted">Slug</div><div className="font-medium text-px-ink">{info?.organization.slug ?? "—"}</div></div>
          <div><div className="text-xs text-px-muted">Member since</div><div className="font-medium text-px-ink">{info ? new Date(info.organization.created_at).toLocaleDateString() : "—"}</div></div>
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
                    <TableCell><Badge variant={ROLE_VARIANT[m.role] ?? "outline"}>{m.role}</Badge></TableCell>
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
