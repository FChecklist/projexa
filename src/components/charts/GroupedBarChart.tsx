"use client";

// R67 E-02 (R-012), chart 1 (sumeet 5.png): "one group per project -- contract
// value, earned value and spend".
//
// WHY THIS IS A PROJEXA COMPONENT AND NOT THE KIT'S BarChart. The kit's
// BarChart is a single-series list of div bars: one value per label, no groups,
// no axis, no tooltip. This chart needs three bars per project side by side, an
// AED axis and a tooltip carrying all three numbers, so it is a genuinely
// different primitive rather than a variation on that one. Per programme
// decision D-09 there is no kit release in this programme, so it is FORKED
// here, in projexa, and the kit keeps serving every single-series chart
// unchanged.
//
// PLAIN SVG, no chart library. The whole drawing is under a hundred lines of
// arithmetic, it renders identically on the server and the client (no
// measurement, no animation, no locale-dependent default), and it adds nothing
// to the bundle. recharts is already here for the category charts; reaching for
// it again for three rectangles would cost more than it saves.
//
// A BAR THAT CANNOT BE DRAWN IS DRAWN AS A HATCH, not omitted and not zero: a
// missing bar reads as "nothing", a zero bar reads as "nothing yet", and "no
// BOQ" is neither.

import { formatCompactNumber, formatNumber } from "@/lib/format-number";

export type GroupedBarSeries = {
  key: string;
  label: string;
  /** A --color-chart-N token. Series colour is never the only carrier: the legend and the tooltip both name the series. */
  color: string;
};

export type GroupedBarGroup = {
  key: string;
  label: string;
  /** null = this figure genuinely does not exist for this group (no BOQ). Rendered hatched, never 0. */
  values: Record<string, number | null>;
};

const CHART_HEIGHT = 220;
const PLOT_HEIGHT = 168;
const GROUP_GAP = 18;
const BAR_WIDTH = 16;
const BAR_GAP = 3;
const AXIS_WIDTH = 56;
const TOP_PAD = 12;

/** The value axis: four gridlines including zero, at round-ish numbers. */
export function axisTicks(maxValue: number, count = 4): number[] {
  if (!Number.isFinite(maxValue) || maxValue <= 0) return [0];
  const step = maxValue / count;
  return Array.from({ length: count + 1 }, (_, i) => Math.round(step * i));
}

export function GroupedBarChart({
  groups,
  series,
  title,
  /** Prefixes every number in the tooltip, e.g. "AED ". Empty when the org has no currency -- never a guessed code. */
  moneyPrefix = "",
  onGroupClick,
  emptyLabel = "No BOQ",
}: {
  groups: GroupedBarGroup[];
  series: GroupedBarSeries[];
  title: string;
  moneyPrefix?: string;
  onGroupClick?: (groupKey: string) => void;
  emptyLabel?: string;
}) {
  const groupWidth = series.length * BAR_WIDTH + (series.length - 1) * BAR_GAP;
  const plotWidth = groups.length * groupWidth + Math.max(0, groups.length - 1) * GROUP_GAP;
  const width = AXIS_WIDTH + plotWidth + 12;
  const max = Math.max(
    1,
    ...groups.flatMap((g) => series.map((s) => g.values[s.key] ?? 0))
  );
  const ticks = axisTicks(max);
  const y = (value: number) => TOP_PAD + PLOT_HEIGHT - (value / max) * PLOT_HEIGHT;

  return (
    <figure className="space-y-2" data-testid="grouped-bar-chart">
      <figcaption className="text-[13px] font-medium text-px-ink">{title}</figcaption>
      {/* Wide charts scroll inside their own container -- the page body must
          never scroll sideways. */}
      <div className="overflow-x-auto">
        <svg
          role="img"
          aria-label={title}
          width={width}
          height={CHART_HEIGHT}
          viewBox={`0 0 ${width} ${CHART_HEIGHT}`}
          className="max-w-none"
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={AXIS_WIDTH} y1={y(t)} x2={width - 12} y2={y(t)} stroke="var(--color-ct-border)" strokeWidth={1} />
              <text x={AXIS_WIDTH - 6} y={y(t) + 4} textAnchor="end" fontSize={10} fill="var(--color-ct-muted)">
                {formatCompactNumber(t)}
              </text>
            </g>
          ))}

          {groups.map((group, gi) => {
            const groupX = AXIS_WIDTH + gi * (groupWidth + GROUP_GAP);
            // ONE tooltip per group, carrying all three numbers, so hovering
            // anywhere in the group answers the whole question rather than a
            // third of it. <title> is the SVG-native tooltip: it works with no
            // JavaScript, and screen readers announce it.
            //
            // The series words are lower-cased here on purpose: the tooltip is
            // one sentence about one project ("Cedar Heights · contract value
            // AED 2,120,500 · ..."), not a second copy of the legend, and
            // sentence case is what makes it read as a sentence.
            const tooltip = [
              group.label,
              ...series.map((s) => {
                const v = group.values[s.key];
                // R67 D-61 (second-merge fix): formatNumber(), not a direct toLocaleString().
                return `${s.label.toLowerCase()} ${v === null || v === undefined ? emptyLabel : `${moneyPrefix}${formatNumber(v)}`}`;
              }),
            ].join(" · ");
            return (
              <g
                key={group.key}
                onClick={onGroupClick ? () => onGroupClick(group.key) : undefined}
                style={onGroupClick ? { cursor: "pointer" } : undefined}
                data-testid="grouped-bar-group"
              >
                <title>{tooltip}</title>
                {series.map((s, si) => {
                  const value = group.values[s.key];
                  const x = groupX + si * (BAR_WIDTH + BAR_GAP);
                  if (value === null || value === undefined) {
                    // The hatch: this figure does not exist, which is not the
                    // same as it being zero.
                    return (
                      <rect
                        key={s.key}
                        x={x}
                        y={TOP_PAD}
                        width={BAR_WIDTH}
                        height={PLOT_HEIGHT}
                        fill="url(#grouped-bar-hatch)"
                        stroke="var(--color-ct-border)"
                        data-testid="grouped-bar-rect"
                      />
                    );
                  }
                  const height = Math.max(1, (value / max) * PLOT_HEIGHT);
                  return (
                    <rect
                      key={s.key}
                      x={x}
                      y={TOP_PAD + PLOT_HEIGHT - height}
                      width={BAR_WIDTH}
                      height={height}
                      fill={s.color}
                      data-testid="grouped-bar-rect"
                    />
                  );
                })}
                <text
                  x={groupX + groupWidth / 2}
                  y={CHART_HEIGHT - 10}
                  textAnchor="middle"
                  fontSize={10}
                  fill="var(--color-ct-muted)"
                >
                  {group.label.length > 14 ? `${group.label.slice(0, 13)}…` : group.label}
                </text>
              </g>
            );
          })}

          <defs>
            <pattern id="grouped-bar-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="transparent" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--color-ct-border)" strokeWidth="2" />
            </pattern>
          </defs>
        </svg>
      </div>
      {/* The legend names every series in words -- the fill is a second
          carrier of that fact, never the only one. */}
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-px-muted">
        {series.map((s) => (
          <li key={s.key} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block size-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
            {s.label}
          </li>
        ))}
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block size-2.5 rounded-sm border border-px-border" style={{ backgroundImage: "repeating-linear-gradient(45deg, var(--color-ct-border) 0 2px, transparent 2px 4px)" }} />
          {emptyLabel}
        </li>
      </ul>
    </figure>
  );
}
