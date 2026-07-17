import { NextRequest, NextResponse } from "next/server";
import { submitContactRequest, ContactRequestError } from "@/lib/services/contact-service";

// Public, unauthenticated -- the marketing site's "Talk to an Engineer" form
// (src/components/marketing/ContactForm.tsx) posts here from both the
// homepage and /how-it-works. No auth guard on purpose: this is a
// prospective-customer contact form, not an authenticated app route.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    await submitContactRequest(body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ContactRequestError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    console.error("Contact submit error:", error);
    return NextResponse.json({ ok: false, error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
