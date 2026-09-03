"use client";

// R67 E-17 (R-175). A SORTED HORIZONTAL BAR LIST, and never a pie.
//
// The item's words are "a sorted horizontal bar per group with click-to-filter
// (no pie)". Every part of that is a decision, not a preference:
//
//   * HORIZONTAL, because the labels are category names, trades and vendor
//     names -- text that has to be readable, which a rotated x-axis tick is
//     not.
//   * SORTED BY VALUE, because a reader looking at "amount done by category"
//     came to find the biggest and the smallest. Alphabetical order hides both.
//   * NO PIE, because the comparison is between magnitudes in a ranked list --
//     the one thing a pie is worst at. (The dashboard rules this product
//     follows allow a pie only at five or fewer slices; here the count is the
//     BOQ's, which is routinely twenty.)
//   * THE FIGURE IS PRINTED BESIDE THE BAR, so the bar's LENGTH is never the
//     only way to read the number -- which is also what makes a muted fill
//     acceptable against the non-text contrast floor.
//
// Plain divs, no chart library: the whole drawing is one width percentage, it
// renders identically on server and client, and it adds nothing to the bundle.

export type SortedBar = {
  key: string;
  label: string;
  /** The magnitude the bar's length encodes. Negative values are clamped to an empty bar, never drawn backwards. */
  value: number;
  /** Already formatted -- money through the org formatter, quantities as quantities. */
  display: string;
};

/** Sorted by value, largest first; ties fall back to the label so the order is stable across renders. */
export function sortBars(bars: readonly SortedBar[]): SortedBar[] {
  return [...bars].sort((a, b) => (b.value !== a.value ? b.value - a.value : a.label.localeCompare(b.label)));
}

export function barWidth(value: number, max: number): number {
  if (!Number.isFinite(value) || max <= 0) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}

export function SortedBarList({
  bars,
  title,
  emptyMessage = "Nothing to chart for this period.",
  onSelect,
  selectedKey = null,
}: {
  bars: SortedBar[];
  title: string;
  emptyMessage?: string;
  /** Click-to-filter. Omitted where there is nothing to filter to, rather than offering a dead click. */
  onSelect?: (key: string) => void;
  selectedKey?: string | null;
}) {
  const sorted = sortBars(bars);
  const max = sorted.reduce((m, b) => (b.value > m ? b.value : m), 0);

  if (sorted.length === 0) {
    return <p className="py-10 text-center text-sm text-px-muted" data-testid="sorted-bar-empty">{emptyMessage}</p>;
  }

  return (
    <figure className="space-y-2" data-testid="sorted-bar-list">
      <figcaption className="text-[13px] font-medium text-px-ink">{title}</figcaption>
      <ul className="space-y-1.5">
        {sorted.map((bar) => {
          const body = (
            <>
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-[12.5px] text-px-ink">{bar.label}</span>
                {/* Printed, not only encoded: the length is a second carrier of
                    the figure, never the only one. */}
                <span className="shrink-0 text-[12.5px] tabular-nums text-px-ink">{bar.display}</span>
              </div>
              <div className="h-2 rounded-sm bg-px-cloud">
                <div
                  className="h-2 rounded-sm"
                  data-testid="sorted-bar-fill"
                  style={{ width: `${barWidth(bar.value, max)}%`, backgroundColor: "var(--color-chart-1)" }}
                />
              </div>
            </>
          );
          return (
            <li key={bar.key}>
              {onSelect ? (
                <button
                  type="button"
                  onClick={() => onSelect(bar.key)}
                  aria-pressed={selectedKey === bar.key}
                  data-testid="sorted-bar-row"
                  className={`block w-full cursor-pointer space-y-1 rounded-md border p-2 text-left transition-colors hover:bg-px-cloud/40 ${
                    selectedKey === bar.key ? "border-px-teal" : "border-transparent"
                  }`}
                >
                  {body}
                </button>
              ) : (
                <div className="space-y-1 p-2">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </figure>
  );
}
