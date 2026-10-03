// LOCAL-FIRST shell, "platform and knowledge" group: small pure display helpers shared by its screens.

import { formatDate, formatDateTimeMedium } from "@/lib/format-date";

/** A date-time the way the online meetings list shows it, or a dash when the laptop has none (or it is not a date). */
export const whenText = (iso: string | null): string => (iso && Number.isFinite(Date.parse(iso)) ? formatDateTimeMedium(iso) : "-");

/** A date the way the online screens show it, or a dash. */
export const dayText = (iso: string | null): string => (iso && Number.isFinite(Date.parse(iso)) ? formatDate(iso) : "-");
