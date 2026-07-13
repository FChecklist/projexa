"use client";

// Priority 13 (Permits as a first-class module): reuses the same
// Card/Table/Badge/Select primitives DocumentsClient.tsx already uses for
// generic documents, rather than inventing new ones -- a permit is a
// documents row with category='permit' (Wave 117 on the VERIDIAN side).
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldCheck, ExternalLink } from "lucide-react";

type Permit = {
  id: string;
  name: string;
  permitNumber: string | null;
  permitAuthority: string | null;
  expiryDate: string | null;
  daysToExpiry: number | null;
  documentUrl: string | null;
};

const WINDOW_OPTIONS = [
  { value: "30", label: "Next 30 days" },
  { value: "60", label: "Next 60 days" },
  { value: "90", label: "Next 90 days" },
  { value: "365", label: "Next 12 months" },
];

// Red = already expired or expiring within a week, amber = within 30 days,
// green = further out than that -- simple, standard expiry-badge convention.
function expiryVariant(daysToExpiry: number | null): { label: string; className: string } {
  if (daysToExpiry === null) return { label: "No expiry set", className: "bg-px-muted/10 text-px-muted border-px-muted/30" };
  if (daysToExpiry < 0) return { label: `Expired ${Math.abs(daysToExpiry)}d ago`, className: "bg-red-50 text-red-700 border-red-200" };
  if (daysToExpiry <= 7) return { label: `${daysToExpiry}d left`, className: "bg-red-50 text-red-700 border-red-200" };
  if (daysToExpiry <= 30) return { label: `${daysToExpiry}d left`, className: "bg-amber-50 text-amber-700 border-amber-200" };
  return { label: `${daysToExpiry}d left`, className: "bg-emerald-50 text-emerald-700 border-emerald-200" };
}

export default function PermitsClient() {
  const [permits, setPermits] = useState<Permit[]>([]);
  const [loading, setLoading] = useState(true);
  const [withinDays, setWithinDays] = useState("90");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/permits?withinDays=${withinDays}`);
      const data = await res.json();
      setPermits(data.permits ?? []);
    } catch {
      toast.error("Couldn't load permits");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [withinDays]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-px-muted">
          Permits expiring within the selected window, pulled from VERIDIAN&apos;s document store (category
          &quot;permit&quot;). Listing only — upload a permit document directly in VERIDIAN.
        </p>
        <Select value={withinDays} onValueChange={setWithinDays}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>{WINDOW_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : permits.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No permits expiring in this window.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Permit</TableHead><TableHead>Number</TableHead><TableHead>Authority</TableHead>
                  <TableHead>Expiry</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Document</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {permits.map((p) => {
                  const variant = expiryVariant(p.daysToExpiry);
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="flex items-center gap-2 font-medium"><ShieldCheck className="size-4 text-px-muted" />{p.name}</TableCell>
                      <TableCell className="text-px-muted">{p.permitNumber ?? "—"}</TableCell>
                      <TableCell className="text-px-muted">{p.permitAuthority ?? "—"}</TableCell>
                      <TableCell className="text-px-muted">{p.expiryDate ? new Date(p.expiryDate).toLocaleDateString() : "—"}</TableCell>
                      <TableCell><Badge variant="outline" className={variant.className}>{variant.label}</Badge></TableCell>
                      <TableCell className="text-right">
                        {p.documentUrl ? (
                          <Button variant="ghost" size="sm" asChild>
                            <a href={p.documentUrl} target="_blank" rel="noopener noreferrer">
                              View <ExternalLink className="size-3.5" />
                            </a>
                          </Button>
                        ) : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
