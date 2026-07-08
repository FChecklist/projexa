"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

export type DeptData = {
  name: string;
  overdue: number;
  pending: number;
  safe: number;
};

type ComplianceChartProps = {
  data: DeptData[];
  className?: string;
};

const COLORS = {
  overdue: "#C0392B",
  pending: "#F5820A",
  safe: "#0E7C6E",
};

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload || !payload.length) return null;

  return (
    <div className="bg-white border border-ct-border rounded-lg shadow-lg p-3 text-sm">
      <p className="font-semibold text-ct-navy mb-1.5">{label}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2 text-xs">
          <span
            className="inline-block size-2.5 rounded-sm shrink-0"
            style={{ backgroundColor: entry.color }}
          />
          <span className="capitalize text-ct-slate">{entry.name}:</span>
          <span className="font-medium text-ct-navy">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

function CustomLegend({
  payload,
}: {
  payload?: Array<{ value: string; color: string }>;
}) {
  if (!payload) return null;

  const labelMap: Record<string, string> = {
    overdue: "Overdue",
    pending: "Pending",
    safe: "On Track",
  };

  return (
    <div className="flex items-center justify-center gap-5 pt-2">
      {payload.map((entry) => (
        <div key={entry.value} className="flex items-center gap-1.5 text-xs">
          <span
            className="inline-block size-2.5 rounded-sm"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-ct-muted capitalize">
            {labelMap[entry.value] ?? entry.value}
          </span>
        </div>
      ))}
    </div>
  );
}

export function ComplianceChart({ data, className }: ComplianceChartProps) {
  return (
    <div className={`w-full ${className ?? ""}`}>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart
          data={data}
          margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
          barCategoryGap="20%"
          barGap={2}
        >
          <XAxis
            dataKey="name"
            tick={{ fontSize: 12, fill: "#718096" }}
            axisLine={{ stroke: "#E2E8F0" }}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 12, fill: "#718096" }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "#F0F4F8" }} />
          <Legend content={<CustomLegend />} />
          <Bar
            dataKey="overdue"
            name="overdue"
            stackId="a"
            fill={COLORS.overdue}
            radius={[0, 0, 0, 0]}
            maxBarSize={40}
          />
          <Bar
            dataKey="pending"
            name="pending"
            stackId="a"
            fill={COLORS.pending}
            radius={[0, 0, 0, 0]}
            maxBarSize={40}
          />
          <Bar
            dataKey="safe"
            name="safe"
            stackId="a"
            fill={COLORS.safe}
            radius={[4, 4, 0, 0]}
            maxBarSize={40}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}