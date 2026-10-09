"use client";

// "Traditional View | Modern View" -- the switch in the upper right of the top rail.
// Two real buttons, the current one marked with aria-pressed; a word on each,
// never an icon alone. See src/lib/view-mode.ts for what each view means.
import { useViewMode, type ViewMode } from "@/lib/view-mode";

const OPTIONS: { mode: ViewMode; label: string }[] = [
  { mode: "traditional", label: "Traditional View" },
  { mode: "modern", label: "Modern View" },
];

export default function ViewModeToggle() {
  const [mode, setMode] = useViewMode();
  return (
    <div
      role="group"
      aria-label="View"
      className="mr-2 inline-flex overflow-hidden rounded-md border"
      style={{ borderColor: "var(--color-ct-border2)" }}
    >
      {OPTIONS.map((o, i) => {
        const on = mode === o.mode;
        return (
          <button
            key={o.mode}
            type="button"
            aria-pressed={on}
            onClick={() => setMode(o.mode)}
            className="px-2.5 py-1 text-[12px] transition-colors"
            style={{
              minHeight: 28,
              background: on ? "var(--color-ct-navy)" : "#fff",
              color: on ? "#fff" : "var(--color-ct-navy)",
              borderLeft: i === 0 ? undefined : "1px solid var(--color-ct-border2)",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
