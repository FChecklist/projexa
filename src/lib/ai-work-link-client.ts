// The browser side of the AI work link client: everything in ./ai-work-link-core (the contract, the typed calls, the parsers), plus the
// signed-in browser session of this app and the one shared client the screens use. Server code imports ./ai-work-link-core instead: this
// file pulls in the browser Supabase client (AUDIT-100 B55).
import { createClient } from "@/lib/supabase/client"
import { createAwlClient, type AwlClient, type AwlSession } from "./ai-work-link-core"

export * from "./ai-work-link-core"

/** The signed-in browser session of this app (cookies, through @supabase/ssr). */
export function browserSession(): AwlSession {
  return {
    accessToken: async () => {
      const { data } = await createClient().auth.getSession()
      return data.session?.access_token ?? null
    },
    refresh: async () => {
      const { data } = await createClient().auth.refreshSession()
      return data.session?.access_token ?? null
    },
  }
}

let shared: AwlClient | null = null

/** The client the screens use. Made on first use, so importing this file never touches the session. */
export function getAwlClient(): AwlClient {
  if (!shared) shared = createAwlClient({ session: browserSession() })
  return shared
}
