import type { Metadata } from "next";
import { HowItWorksContent } from "@/components/marketing/how-it-works/HowItWorksContent";

export const metadata: Metadata = {
  title: "How PROJEXA Works — One Core, Every Module Connected | PROJEXA",
  description:
    "See exactly how PROJEXA's modules coordinate on a real example -- one change order moving through five modules, with nobody re-typing anything, on top of VERIDIAN AI OS.",
};

// R67 J-01 (audit R-246): this page reads nothing from the request itself,
// but the shared root layout does (next-intl's getLocale()/getMessages() ->
// the NEXT_LOCALE cookie), which was enough to make the whole route
// server-rendered on every request. `force-static` makes that cookie read
// return an empty store rather than bail to dynamic rendering, so the route
// is prerendered once and revalidated hourly.
//
// This is the ENGLISH document; src/app/hi/how-it-works/page.tsx is the same
// page prerendered in Hindi, and middleware.ts rewrites a Hindi visitor here
// to that one. See src/app/page.tsx's comment for the full reasoning.
export const dynamic = "force-static";
export const revalidate = 3600;

// New public marketing route -- unauthenticated, not gated by
// src/lib/authz/page-access.ts, and deliberately not redirect-gated by auth
// state the way the root "/" route is: it's a real, always-visible page, not
// a state-dependent landing.
export default function HowItWorksPage() {
  return <HowItWorksContent locale="en" />;
}
