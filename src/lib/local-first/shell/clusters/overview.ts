// LOCAL-FIRST shell route cluster "overview": Overview: dashboard, reports, analysis.
// One engineer fills this file; the route table spreads it. Nothing else is shared, so clusters never conflict.
// Use nav orders 0 to 9 for the dashboard, 80 to 99 for the rest. See docs/local-first/ROUTE_TABLE.md for how to add a module.

import type { ShellRoute } from "../types";

export const ROUTES: readonly ShellRoute[] = [];
