"use client";

// R46 P8 seq134: registry-driven LIST archetype, same pattern R43 seq2
// established for permits.list (see PermitsListClient.tsx's header comment
// for the full history). This screen never adopted the kit's ListScreen
// component -- it's a plain shadcn Table with a bespoke, live e-signature
// Actions column (SignatureStatusCell below) that has no registry
// equivalent -- so only the 5 real data columns (#/Title/Cost Impact/
// Schedule Impact/Status) are registry-driven: COLUMNS is now the fallback
// used when change-orders/page.tsx's server-side resolve of the
// variations.list screen_definitions row returns null (404/error), same
// "keep the hardcoded version behind a flag until verified" contract as
// permits. Actions stays hardcoded outside the columns map, always.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Plus } from "lucide-react";
import { currencyLabel, useCurrencies } from "@/lib/currency";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import { fetchJson } from "@/lib/fetch-json";

type ChangeOrder = {
  id: string; number: number; title: string; reason: string | null; costImpact: string; scheduleImpactDays: number; status: string;
};

// Shape returned by compliance-tracker's screen_definitions.columns jsonb --
// same convention as PermitsListClient.tsx's RegistryColumn.
export type RegistryColumn = ScreenColumn;

const COLUMNS: ScreenColumn[] = [
  { label: "#", field: "number", type: "text", importance: "High" },
  { label: "Title", field: "title", type: "text", importance: "High" },
  { label: "Cost Impact", field: "costImpact", type: "number", importance: "High" },
  { label: "Schedule Impact", field: "scheduleImpactDays", type: "number", importance: "High" },
  { label: "Status", field: "status", type: "text", importance: "High" },
];

type SignatureStatus = {
  signatureRequest: {
    id: string; status: string; title: string; completedAt: string | null;
    signers: { name: string; email: string; status: string; signOrder: number | null; signedAt: string | null; declinedAt: string | null; declineReason: string | null }[];
  } | null;
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline", pending_approval: "secondary", approved: "default", rejected: "destructive",
};

// Per-field cell renderer -- this screen isn't built on the kit's ListScreen
// (its Actions column needs the live SignatureStatusCell below, which has no
// registry equivalent), so unlike PermitsListClient there's no generic
// column-type-driven renderer to hand columns to. A registry row can still
// reorder/relabel these 5 columns live (the hard-stop test); the actual cell
// value for each known field is still this project's own formatting logic,
// looked up by field name so reordering doesn't change what renders.
function renderChangeOrderCell(field: string, c: ChangeOrder, formatCurrency: (n: number) => string) {
  switch (field) {
    case "number":
      return <span className="font-mono text-xs">CO-{c.number}</span>;
    case "title":
      return <span className="font-medium">{c.title}</span>;
    case "costImpact":
      return (
        <span className={Number(c.costImpact) >= 0 ? "text-px-error" : "text-px-success"}>
          {formatCurrency(Number(c.costImpact))}
        </span>
      );
    case "scheduleImpactDays":
      return (
        <span className="text-px-muted">
          {c.scheduleImpactDays > 0 ? `+${c.scheduleImpactDays}d` : c.scheduleImpactDays === 0 ? "—" : `${c.scheduleImpactDays}d`}
        </span>
      );
    case "status":
      return <Badge variant={STATUS_VARIANT[c.status]}>{c.status.replace(/_/g, " ")}</Badge>;
    default:
      return String((c as unknown as Record<string, unknown>)[field] ?? "—");
  }
}

// Real, honest signature-progress summary for a pending_approval change
// order -- deliberately NOT a one-click approve/reject button. A naive
// button here would let any team member flip a change order to "approved"
// regardless of whether the actual external signer signed anything,
// defeating the entire point of using e-signature instead of a status flag
// (PROJEXA_GAP_ANALYSIS.md gap #5). The real approval mechanism is
// VERIDIAN's e-signature completion path (esignature-service.ts), which now
// auto-transitions the change order's own status once every signer has
// signed (or rejects it if a signer declines) -- this cell only reports
// that real progress, it never causes it.
function SignatureStatusCell({ data, loading }: { data: SignatureStatus | undefined; loading: boolean }) {
  if (loading) return <span className="text-xs text-px-muted">Checking signature status…</span>;
  if (!data || !data.signatureRequest) {
    return <span className="text-xs text-px-muted">No signature request created yet</span>;
  }
  const { signers, status } = data.signatureRequest;
  const signedCount = signers.filter((s) => s.status === "signed").length;
  const declined = signers.find((s) => s.status === "declined");
  if (status === "declined" || declined) {
    return (
      <span className="text-xs text-px-error">
        Declined by {declined?.name ?? "a signer"}{declined?.declineReason ? ` — "${declined.declineReason}"` : ""}
      </span>
    );
  }
  if (status === "voided") return <span className="text-xs text-px-muted">Signature request voided</span>;
  return (
    <span className="text-xs text-px-muted" title={signers.map((s) => `${s.name} (${s.email}): ${s.status}`).join(", ")}>
      Awaiting signature ({signedCount} of {signers.length} signed)
    </span>
  );
}

export default function ChangeOrdersClient({ projectId, registryColumns }: { projectId: string; registryColumns?: RegistryColumn[] | null }) {
  const router = useRouter();
  const currencies = useCurrencies();
  // Priority 17 re-sweep fix: was Intl.NumberFormat(..., { currency: "INR" })
  // -- forced both symbol and grouping to India regardless of the org's real
  // base currency. Closure over `currencies` so every existing
  // formatCurrency(...) call site below is unchanged.
  const formatCurrency = (n: number) => `${currencyLabel(undefined, currencies)}${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  const columns = registryColumns && registryColumns.length > 0 ? registryColumns : COLUMNS;
  const [items, setItems] = useState<ChangeOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [signatureStatuses, setSignatureStatuses] = useState<Record<string, SignatureStatus>>({});
  const [signatureStatusLoading, setSignatureStatusLoading] = useState<Record<string, boolean>>({});

  async function load() {
    setLoading(true);
    try {
      const data = await fetchJson(`/api/change-orders?projectId=${encodeURIComponent(projectId)}`);
      const changeOrders: ChangeOrder[] = data.changeOrders ?? [];
      setItems(changeOrders);
      // Only pending_approval rows have anything to show here -- draft has
      // no signature request yet, approved/rejected already have their
      // final Badge, no need to spend a request on those.
      const pending = changeOrders.filter((c) => c.status === "pending_approval");
      setSignatureStatusLoading(Object.fromEntries(pending.map((c) => [c.id, true])));
      await Promise.all(pending.map(async (c) => {
        try {
          const sData = await fetchJson(`/api/change-orders/${c.id}/signature-status`);
          setSignatureStatuses((prev) => ({ ...prev, [c.id]: sData }));
        } catch (err) {
          // Leave this row's entry unset -- SignatureStatusCell already
          // renders an honest "No signature request created yet" fallback
          // for undefined, no separate error state needed for one row.
        } finally {
          setSignatureStatusLoading((prev) => ({ ...prev, [c.id]: false }));
        }
      }));
    } catch {
      toast.error("Couldn't load change orders");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [projectId]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {/* Real screen navigation (2026-08-30) -- replaces the old "New
            Change Order" Dialog popup with a real create route. */}
        <Button onClick={() => router.push(`/change-orders/new?projectId=${projectId}`)}><Plus className="size-4" /> New Change Order</Button>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : items.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No change orders yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((col) => <TableHead key={col.field}>{col.label}</TableHead>)}
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((c) => (
                  // Real screen navigation (2026-08-30) -- rows now open the
                  // real Object Page instead of nothing (no detail view
                  // existed before this -- "reason" wasn't shown anywhere).
                  <TableRow key={c.id} className="cursor-pointer hover:bg-px-cloud/40" onClick={() => router.push(`/change-orders/${c.id}`)}>
                    {columns.map((col) => (
                      <TableCell key={col.field}>{renderChangeOrderCell(col.field, c, formatCurrency)}</TableCell>
                    ))}
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      {c.status === "draft" && <Button size="sm" variant="outline" onClick={() => router.push(`/change-orders/${c.id}`)}>Send for Approval</Button>}
                      {c.status === "pending_approval" && (
                        <SignatureStatusCell data={signatureStatuses[c.id]} loading={!!signatureStatusLoading[c.id]} />
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
