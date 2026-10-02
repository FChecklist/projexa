import { createBrowserClient } from "@supabase/ssr";
import { browserIsOffline, createDurableAuthFetch } from "./durable-auth";

// LOCAL-FIRST R9: the browser's session is durable. The auth client's fetch is wrapped so a token refresh that fails
// because the laptop is offline, our server or Supabase is down, or any answer other than "this refresh token is
// revoked" can never end the session (see durable-auth.ts for the full reasoning). The wrapper only touches the
// refresh-token request; every other call goes through exactly as before. createBrowserClient returns one shared
// client per tab, so this is set up once.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        fetch: createDurableAuthFetch((input, init) => fetch(input, init), {
          isOffline: browserIsOffline,
          // A refresh that failed while the browser HAS a network says our auth service is struggling: tell the connectivity
          // state (a few in a row make it 'server_down'; the tiny "working on this laptop" marker, never a dialog).
          onTransientFailure: (info) => {
            if (info.reason === "offline") return;
            void import("@/lib/local-first/connectivity").then((m) => m.reportServerFailure()).catch(() => {});
          },
        }),
      },
    }
  );
}
