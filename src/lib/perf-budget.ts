// R67 F-28 (audit recommendation R-249) -- THE LATENCY BUDGET, AS A FUNCTION.
//
// The measurement half of the harness needs a real browser and a running
// server. The DECISION half -- is this row inside its budget, and what exactly
// do we tell the reader when it is not -- is pure, so it lives here where it
// can be tested without either, and the harness imports it. That split is
// deliberate: the old harness's numbers were untrustworthy (`ms = -1` rows,
// selectors that matched nothing) and there was no way to tell a broken
// measurement from a slow screen, because nothing about it was testable.
//
// perf/budgets.json holds the figures. This file holds the rules.

export type RouteBudget = {
  route: string;
  label: string;
  ttfbMs: number;
  fcpMs: number;
  usableMs: number;
  networkIdleMs: number;
  apiCalls: number;
  slowestCallMs: number;
};

export type RouteMeasurement = {
  route: string;
  /** null when the browser reported nothing for this metric. */
  ttfbMs: number | null;
  fcpMs: number | null;
  /**
   * When [data-state='ready'|'empty'] appeared on the list region (F-31).
   * null means the screen NEVER became usable inside the wait -- the single
   * most important failure this table can report, and the one the old harness
   * recorded as `ms = -1` and then ignored.
   */
  usableMs: number | null;
  networkIdleMs: number | null;
  apiCount: number;
  slowestCallMs: number | null;
  slowestCallUrl: string | null;
};

export type BudgetViolation = {
  route: string;
  metric: keyof Pick<RouteBudget, "ttfbMs" | "fcpMs" | "usableMs" | "networkIdleMs" | "apiCalls" | "slowestCallMs">;
  budget: number;
  /** null when the metric was never observed at all. */
  measured: number | null;
  /** The budget after tolerance -- what the row was actually judged against. */
  allowed: number;
  detail?: string;
};

/** Metrics where a 10 % overshoot is runner noise rather than a regression. */
const TOLERANT_METRICS = new Set(["ttfbMs", "fcpMs", "usableMs", "networkIdleMs", "slowestCallMs"]);

export function allowedFor(metric: string, budget: number, toleranceFraction: number): number {
  // apiCalls deliberately has NO tolerance: a screen making 22 requests where
  // 10 are budgeted is a design fact, not jitter, and catching exactly that
  // regression is why this budget exists.
  return TOLERANT_METRICS.has(metric) ? Math.round(budget * (1 + toleranceFraction)) : budget;
}

/**
 * Merges perf/budgets.json's `defaults` with a route's own overrides.
 * A route may tighten or relax any single figure without restating the rest.
 */
export function resolveBudget(
  defaults: Omit<RouteBudget, "route" | "label">,
  route: Partial<RouteBudget> & { route: string; label: string }
): RouteBudget {
  return {
    route: route.route,
    label: route.label,
    ttfbMs: route.ttfbMs ?? defaults.ttfbMs,
    fcpMs: route.fcpMs ?? defaults.fcpMs,
    usableMs: route.usableMs ?? defaults.usableMs,
    networkIdleMs: route.networkIdleMs ?? defaults.networkIdleMs,
    apiCalls: route.apiCalls ?? defaults.apiCalls,
    slowestCallMs: route.slowestCallMs ?? defaults.slowestCallMs,
  };
}

/**
 * Every way one route can be outside its budget.
 *
 * A metric that was never observed is only a violation for `usable`: a screen
 * that never reaches a usable state has failed in the way that matters most,
 * whereas a missing FCP is a measurement gap and must not be reported as a
 * performance regression -- reporting a broken measurement as a slow screen is
 * what made the previous harness's output unusable.
 */
export function evaluateRoute(budget: RouteBudget, measured: RouteMeasurement, toleranceFraction: number): BudgetViolation[] {
  const violations: BudgetViolation[] = [];

  const check = (metric: BudgetViolation["metric"], value: number | null, budgetValue: number) => {
    const allowed = allowedFor(metric, budgetValue, toleranceFraction);
    if (value === null) return;
    if (value > allowed) violations.push({ route: budget.route, metric, budget: budgetValue, measured: value, allowed });
  };

  check("ttfbMs", measured.ttfbMs, budget.ttfbMs);
  check("fcpMs", measured.fcpMs, budget.fcpMs);
  check("networkIdleMs", measured.networkIdleMs, budget.networkIdleMs);
  check("apiCalls", measured.apiCount, budget.apiCalls);

  if (measured.usableMs === null) {
    violations.push({
      route: budget.route,
      metric: "usableMs",
      budget: budget.usableMs,
      measured: null,
      allowed: allowedFor("usableMs", budget.usableMs, toleranceFraction),
      detail: "never reached [data-state='ready'] or [data-state='empty']",
    });
  } else {
    check("usableMs", measured.usableMs, budget.usableMs);
  }

  if (measured.slowestCallMs !== null && measured.slowestCallMs > allowedFor("slowestCallMs", budget.slowestCallMs, toleranceFraction)) {
    violations.push({
      route: budget.route,
      metric: "slowestCallMs",
      budget: budget.slowestCallMs,
      measured: measured.slowestCallMs,
      allowed: allowedFor("slowestCallMs", budget.slowestCallMs, toleranceFraction),
      detail: measured.slowestCallUrl ?? undefined,
    });
  }

  return violations;
}

/**
 * One line per violation, naming the route, the metric and both numbers.
 *
 * The route name is the FIRST thing on the line: the whole point of the CI
 * job's output is that a reader knows which screen regressed without opening
 * an artifact.
 */
export function violationLine(v: BudgetViolation): string {
  const measured = v.measured === null ? "not measured" : String(v.measured);
  const tail = v.detail ? ` -- ${v.detail}` : "";
  return `FAIL ${v.route}  ${v.metric}=${measured} (budget ${v.budget}, allowed ${v.allowed})${tail}`;
}

export type PerfRow = { budget: RouteBudget; measured: RouteMeasurement; violations: BudgetViolation[] };

export function evaluateAll(
  rows: { budget: RouteBudget; measured: RouteMeasurement }[],
  toleranceFraction: number
): { rows: PerfRow[]; violations: BudgetViolation[] } {
  const evaluated = rows.map(({ budget, measured }) => ({
    budget,
    measured,
    violations: evaluateRoute(budget, measured, toleranceFraction),
  }));
  return { rows: evaluated, violations: evaluated.flatMap((r) => r.violations) };
}

function cell(value: number | null): string {
  return value === null ? "—" : String(Math.round(value));
}

/** The per-module table, as Markdown. Emitted alongside the JSON. */
export function toMarkdown(rows: PerfRow[]): string {
  const head = [
    "| Screen | Route | TTFB | FCP | Usable | Idle | API calls | Slowest call | Verdict |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
  ];
  const body = rows.map((r) => {
    const verdict = r.violations.length === 0 ? "PASS" : r.violations.map((v) => v.metric).join(", ");
    return `| ${r.budget.label} | \`${r.budget.route}\` | ${cell(r.measured.ttfbMs)} | ${cell(r.measured.fcpMs)} | ${cell(r.measured.usableMs)} | ${cell(r.measured.networkIdleMs)} | ${r.measured.apiCount} | ${cell(r.measured.slowestCallMs)} | ${verdict} |`;
  });
  return [...head, ...body].join("\n") + "\n";
}

/**
 * Reads the Server-Timing header this item puts on every /api response.
 * Returns nulls rather than guessing when a field is absent -- a missing
 * measurement must never be reported as a zero-cost call.
 */
export function parseServerTiming(header: string | null | undefined): { upstreamMs: number | null; appMs: number | null } {
  const out: { upstreamMs: number | null; appMs: number | null } = { upstreamMs: null, appMs: null };
  for (const part of (header ?? "").split(",")) {
    const [rawName, rawDur] = part.trim().split(";dur=");
    if (!rawName || rawDur === undefined) continue;
    const value = Number(rawDur);
    if (!Number.isFinite(value)) continue;
    if (rawName === "upstream") out.upstreamMs = value;
    if (rawName === "app") out.appMs = value;
  }
  return out;
}
