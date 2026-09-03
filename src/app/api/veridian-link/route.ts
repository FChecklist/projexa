import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { VERIDIAN_ORIGIN } from "@/lib/veridian-client";

// R67 WS-A (A-17) -- THE ONE LINK OUT OF PROJEXA.
//
// A-17 asks the composer to offer, for a name that has no PROJEXA screen at
// all (Email, Teams), the band-2 line "Not part of PROJEXA — open VERIDIAN"
// WITH THE PLATFORM LINK. The composer is a client component and cannot know
// where VERIDIAN is: the origin comes from VERIDIAN_API_BASE_URL, read in
// src/lib/veridian-client.ts, which imports the database and therefore can
// never be bundled for the browser.
//
// The alternatives were both worse. Hard-coding the production hostname into a
// client file makes the link silently wrong on any deployment that configures
// its own; inventing a NEXT_PUBLIC_* variable ships a link that is broken until
// somebody sets it, in every environment, with nothing to say so. A redirect
// resolves the CONFIGURED origin at request time and cannot go stale.
//
// IT TAKES NO DESTINATION PARAMETER. A route that redirected to a
// caller-supplied URL would be an open redirect, and a per-area path table
// would have to invent VERIDIAN routes this repo cannot verify. It opens
// VERIDIAN's own front door and stops there.
export async function GET() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  return NextResponse.redirect(VERIDIAN_ORIGIN, { status: 307 });
}
