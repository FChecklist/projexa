"use client";

// Real-screen conversion (2026-08-30): the "New Vendor" Dialog popup is
// gone -- routes to a real create screen (VendorCreateClient.tsx). Rows
// now route to a real Object Page (VendorObjectClient.tsx) -- this module
// had no detail view at all before, "not even clickable rows" per its own
// tracker note.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Plus } from "lucide-react";
import { useOrgRole } from "@/hooks/use-org-role";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import DataLoadError from "@/components/DataLoadError";

type Vendor = {
  id: string; vendorName: string; vendorType: string | null; gst: string | null;
  trade: string | null; creditLimit: string | null; isActive: boolean;
};

// Priority 19 Part 2, Workstream C: GST is an Indian GST-registration
// field with no UAE VAT/TRN (or any other country's) equivalent -- it was
// rendering unconditionally regardless of the org's own country. Gated on
// isIndiaOrg (hide, don't error, for non-IN orgs), same pattern as
// CustomersClient.tsx's GSTIN field.
export default function VendorsClient() {
  const router = useRouter();
  const { isIndiaOrg } = useOrgRole();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchJson<{ vendors?: Vendor[] }>("/api/vendors");
      setVendors(data.vendors ?? []);
    } catch (err) {
      const msg = errorMessage(err, "Couldn't load vendors");
      setLoadError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {/* Real screen navigation (2026-08-30) -- replaces the old "New
            Vendor" Dialog popup with a real create route. */}
        <Button onClick={() => router.push("/vendors/new")}><Plus className="size-4" /> New Vendor</Button>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : loadError ? (
            // R48_VENDORS_500_RENDERED_AS_EMPTY_STATE_01: "No vendors added
            // yet." used to render here on a load where GET /api/vendors had
            // returned 500 on 3 of 3 attempts. The screen stated a fact about
            // the user's data that the failed read makes unknowable.
            <DataLoadError messages={[loadError]} onRetry={load} />
          ) : vendors.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No vendors added yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>Trade</TableHead>{isIndiaOrg && <TableHead>GST</TableHead>}<TableHead>Status</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {/* Real screen navigation (2026-08-30) -- rows open the
                    real Object Page, where the Vendor Master workflows
                    (qualification/sanction screening/banking/portal links)
                    now live. */}
                {vendors.map((v) => (
                  <TableRow key={v.id} className="cursor-pointer hover:bg-px-cloud/40" onClick={() => router.push(`/vendors/${v.id}`)}>
                    <TableCell className="font-medium">{v.vendorName}</TableCell>
                    <TableCell className="text-px-muted">{v.vendorType ?? "—"}</TableCell>
                    <TableCell className="text-px-muted">{v.trade ?? "—"}</TableCell>
                    {isIndiaOrg && <TableCell className="text-px-muted">{v.gst ?? "—"}</TableCell>}
                    <TableCell><Badge variant={v.isActive ? "default" : "outline"}>{v.isActive ? "active" : "inactive"}</Badge></TableCell>
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
