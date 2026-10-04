"use client";

import { useEffect } from "react";
import { installClientErrorReporting } from "@/lib/local-first/client-error-report";

/** Audit 37 point 33: mounts the global error reporter once for the whole app. Renders nothing. */
export function ClientErrorReporting() {
  useEffect(() => installClientErrorReporting(), []);
  return null;
}
