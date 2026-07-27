import type { MetadataRoute } from "next"

// PROJEXA_ERP_END_TO_END_REQUIREMENT_ANALYSIS_GAP_FILL_AND_IMPLEMENTATION:
// PROJEXA had zero PWA infrastructure before this (confirmed by Phase 0
// investigation -- no manifest.ts/manifest.json, no service worker anywhere
// in src/ or public/). Uses the same Next.js native manifest route
// compliance-tracker's src/app/manifest.ts already uses successfully, with
// PROJEXA's own branding -- not a copy of that app's VERI-Chat-specific
// share_target (PROJEXA has no equivalent share-into-app feature).
// display: "standalone" + start_url below are what let a site worker
// actually "install" PROJEXA to a home screen and open full-screen, the
// real precondition for the offline work-progress capture flow (see
// src/lib/offline/) being usable in the field.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PROJEXA — Construction Intelligence AI OS",
    short_name: "PROJEXA",
    description:
      "PROJEXA digitizes the full construction execution lifecycle -- scope, drawings, budgets, vendors, manpower, daily site progress, and reporting -- with AI-native decision support, built on VERIDIAN AI OS.",
    start_url: "/",
    display: "standalone",
    background_color: "#FFFDF9",
    theme_color: "#1C2B3A",
    icons: [{ src: "/logo-mark.svg", sizes: "any", type: "image/svg+xml" }],
  }
}
