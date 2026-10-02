// LOCAL-FIRST shell route cluster "documents": Documents: permits, drawings, documents, minutes of meetings (moms).
// One engineer fills this file; the route table spreads it. Nothing else is shared, so clusters never conflict.
// Use nav orders 40 to 59. See docs/local-first/ROUTE_TABLE.md for how to add a module.

import type { ShellRoute } from "../types";

export const ROUTES: readonly ShellRoute[] = [];
