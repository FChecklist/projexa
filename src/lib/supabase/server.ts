import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch (err) {
            // cookies().set() throws when called from a Server Component,
            // which genuinely cannot set cookies -- that specific case is
            // safe to ignore since middleware already refreshed the session
            // for this request. But this same catch used to also silently
            // swallow *real* failures from Route Handlers (which CAN set
            // cookies), making a corrupted/failed session write
            // indistinguishable from the harmless Server Component case.
            // Log it so that class of bug (a refreshed session that never
            // actually got persisted back to the browser) is diagnosable
            // instead of surfacing later as an unexplained logout.
            console.error("[supabase/server] cookies().set() failed -- if this came from a Route Handler or Server Action, the refreshed session was NOT persisted to the browser:", err);
          }
        },
      },
    }
  );
}
