"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { currencyLabel, useCurrencies } from "@/lib/currency";

type Overview = {
  totalLeads: number;
  totalOpportunities: number;
  leadsByStatus: Record<string, number>;
  opportunitiesByStage: Record<string, { count: number; value: number }>;
  wonCount: number;
  lostCount: number;
  winRate: number | null;
  openPipelineValue: number;
  overdueLeadFollowUps: number;
  overdueOpportunityFollowUps: number;
};

const STAGE_ORDER = ["prospecting", "proposal", "negotiation", "won", "lost"];
const LEAD_STATUS_ORDER = ["new", "contacted", "qualified", "converted", "lost"];

export default function SalesDashboardClient() {
  const currencies = useCurrencies();
  // Priority 17 re-sweep fix: was a module-level `inr()` hardcoding "₹" --
  // now a closure over `currencies` so both existing inr(...) call sites
  // below resolve the org's real base currency instead.
  const inr = (n: number) => `${currencyLabel(undefined, currencies)}${n.toLocaleString("en-US")}`;
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/sales-pipeline")
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => toast.error("Couldn't load sales pipeline overview"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="grid h-40 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>;
  if (!data) return <p className="py-10 text-center text-sm text-px-muted">No pipeline data available.</p>;

  const maxStageCount = Math.max(1, ...STAGE_ORDER.map((s) => data.opportunitiesByStage[s]?.count ?? 0));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="shadow-card"><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-px-muted">Total Leads</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{data.totalLeads}</CardContent></Card>
        <Card className="shadow-card"><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-px-muted">Total Opportunities</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{data.totalOpportunities}</CardContent></Card>
        <Card className="shadow-card"><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-px-muted">Win Rate</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{data.winRate != null ? `${(data.winRate * 100).toFixed(0)}%` : "—"}</CardContent></Card>
        <Card className="shadow-card"><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-px-muted">Open Pipeline Value</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{inr(data.openPipelineValue)}</CardContent></Card>
      </div>

      {(data.overdueLeadFollowUps > 0 || data.overdueOpportunityFollowUps > 0) && (
        <Card className="border-destructive/40 shadow-card">
          <CardContent className="flex items-center justify-between py-4 text-sm">
            <span>
              <Badge variant="destructive" className="mr-2">Overdue</Badge>
              {data.overdueLeadFollowUps} lead(s) and {data.overdueOpportunityFollowUps} opportunity(ies) have a follow-up date in the past.
            </span>
            <div className="flex gap-3">
              <Link href="/sales/leads" className="text-px-orange hover:underline">Review leads</Link>
              <Link href="/sales/opportunities" className="text-px-orange hover:underline">Review opportunities</Link>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="shadow-card">
        <CardHeader><CardTitle className="text-base">Opportunity Funnel</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {STAGE_ORDER.map((stage) => {
            const bucket = data.opportunitiesByStage[stage] ?? { count: 0, value: 0 };
            return (
              <div key={stage} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="capitalize">{stage}</span>
                  <span className="text-px-muted">{bucket.count} · {inr(bucket.value)}</span>
                </div>
                <div className="h-2 w-full rounded-full bg-px-ink2/10">
                  <div className="h-2 rounded-full bg-px-orange" style={{ width: `${(bucket.count / maxStageCount) * 100}%` }} />
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardHeader><CardTitle className="text-base">Lead Status Breakdown</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          {LEAD_STATUS_ORDER.map((status) => (
            <Badge key={status} variant="outline" className="px-3 py-1.5 text-sm">
              {status}: {data.leadsByStatus[status] ?? 0}
            </Badge>
          ))}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-3 text-sm">
        <Link href="/sales/leads" className="text-px-orange hover:underline">View all leads →</Link>
        <Link href="/sales/opportunities" className="text-px-orange hover:underline">View all opportunities →</Link>
        <Link href="/quotations" className="text-px-orange hover:underline">View quotations →</Link>
        <Link href="/sales-orders" className="text-px-orange hover:underline">View sales orders →</Link>
        <Link href="/customers" className="text-px-orange hover:underline">View customers →</Link>
      </div>
    </div>
  );
}
