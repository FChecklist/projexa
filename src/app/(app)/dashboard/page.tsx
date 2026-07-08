import { AppTopbar } from "@/components/AppTopbar";
import { DashboardCard } from "@/components/ui/dashboard-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Wallet, TrendingUp, Receipt, Building2, AlertTriangle } from "lucide-react";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

type OrgDashboard = {
  totalProjects: number;
  totalBudget: number;
  totalRevenue: number;
  totalExpenses: number;
  projects: { id: string; name: string; revenue: number; expenses: number; taskCount: number; delayedTaskCount: number }[];
};

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

export default async function DashboardPage() {
  let data: OrgDashboard | null = null;
  let errorMessage: string | null = null;

  try {
    data = await callVeridian<OrgDashboard>("/dashboard");
  } catch (err) {
    errorMessage = err instanceof VeridianApiError ? err.message : "Failed to load dashboard from VERIDIAN";
  }

  return (
    <>
      <AppTopbar title="Dashboard" />
      <main className="flex-1 space-y-6 p-6">
        {errorMessage && (
          <Card className="border-px-error-border bg-px-error-light">
            <CardContent className="p-4 text-sm text-px-error">
              Could not load live data: {errorMessage}
            </CardContent>
          </Card>
        )}

        {data && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <DashboardCard title="Active Projects" value={data.totalProjects} icon={Building2} variant="total" />
              <DashboardCard title="Total Budget" value={formatCurrency(data.totalBudget)} icon={Wallet} variant="total" />
              <DashboardCard title="Total Revenue" value={formatCurrency(data.totalRevenue)} icon={TrendingUp} variant="completed" />
              <DashboardCard title="Total Expenses" value={formatCurrency(data.totalExpenses)} icon={Receipt} variant="pending" />
            </div>

            <Card className="shadow-card">
              <CardHeader>
                <CardTitle className="font-heading text-base">Projects</CardTitle>
              </CardHeader>
              <CardContent>
                {data.projects.length === 0 ? (
                  <p className="py-8 text-center text-sm text-px-muted">No active projects yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Project</TableHead>
                        <TableHead>Revenue</TableHead>
                        <TableHead>Expenses</TableHead>
                        <TableHead>Tasks</TableHead>
                        <TableHead>Delayed</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.projects.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="font-medium">{p.name}</TableCell>
                          <TableCell>{formatCurrency(p.revenue)}</TableCell>
                          <TableCell>{formatCurrency(p.expenses)}</TableCell>
                          <TableCell>{p.taskCount}</TableCell>
                          <TableCell>
                            {p.delayedTaskCount > 0 ? (
                              <span className="inline-flex items-center gap-1 text-px-error">
                                <AlertTriangle className="size-3.5" /> {p.delayedTaskCount}
                              </span>
                            ) : (
                              <span className="text-px-muted">0</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </>
  );
}
