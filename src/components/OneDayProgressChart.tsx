"use client";

// R67 E-40 (R-272 / R-297). ONE LOGGED DAY IS STILL WORTH DRAWING.
//
// WHAT WAS THERE BEFORE, and why each step was an improvement on the last:
//   * originally, the kit's LineChart with a single point -- which draws no
//     path at all (its own `series.length > 1` guard) and prints series[0]'s
//     label at BOTH ends of the axis, so the reader saw an empty frame
//     captioned with the same date twice;
//   * E-25 replaced that frame with a sentence, which was honest but showed
//     nothing;
//   * E-40 asks for both: the single point, drawn on an axis extended to
//     today, with the sentence under it. That is what this renders.
//
// A LOCAL COMPONENT, NOT A KIT CHANGE (D-09). The kit's LineChart draws no
// circles at all and has no notion of an axis that outruns its data, so this
// is a case the kit does not cover rather than one it covers wrongly -- there
// is nothing here to fork. The gridlines, the size and the axis-label row are
// deliberately the kit LineChart's own, so a one-point panel and a two-point
// panel look like the same chart.
import { oneDayAxis } from "@/lib/project-dashboard-charts";

const WIDTH = 320;
const HEIGHT = 120;
const GRID_LINES = [0, 0.25, 0.5, 0.75, 1];

export function OneDayProgressChart({
  day,
  today,
  value,
  valueLabel,
}: {
  /** The one day anything was logged, ISO yyyy-mm-dd. */
  day: string;
  /** Today, ISO yyyy-mm-dd -- passed in rather than read here, so this renders identically on the server and the client. */
  today: string;
  /** The cumulative quantity logged on that day. */
  value: number;
  /** That quantity, already formatted. */
  valueLabel: string;
}) {
  const axis = oneDayAxis(day, today);
  // A single point has no range to scale against, so it sits on the middle
  // gridline: any other height would imply a comparison with a second value
  // that does not exist.
  const cy = HEIGHT / 2;
  const cx = axis.pointFraction * (WIDTH - 12) + 6; // inset so the marker is never clipped

  return (
    <div>
      <svg
        width="100%"
        height={HEIGHT}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`One day of progress logged: ${valueLabel} on ${axis.leftLabel}`}
      >
        {GRID_LINES.map((g) => (
          <line key={g} x1={0} x2={WIDTH} y1={HEIGHT * g} y2={HEIGHT * g} stroke="var(--ct-border, #e5e7eb)" strokeWidth={1} />
        ))}
        <circle cx={cx} cy={cy} r={4} fill="var(--color-veri-status-context)" data-testid="one-day-point" data-value={value} />
      </svg>
      <div className="flex justify-between text-[11px] text-ct-muted mt-1">
        <span>{axis.leftLabel}</span>
        {/* The word, never today's date -- see oneDayAxis: printing the date at
            both ends is the very thing E-40 forbids. */}
        <span>{axis.rightLabel}</span>
      </div>
      <p className="mt-1 text-[11.5px] text-ct-muted">{valueLabel} logged</p>
    </div>
  );
}
