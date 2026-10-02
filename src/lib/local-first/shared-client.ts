// LOCAL-FIRST: the one place that wires the sync client to the person's own Supabase session and to the app's
// release version. Kept apart from replica.ts / outbox.ts so those engines stay free of the browser client (and
// so their tests need no environment variables).

import { createClient } from "@/lib/supabase/client";
import { createSyncClient, type SyncClient } from "./sync-client";
import { createRequestPacer, type RequestPacer } from "./rate-pacer";

/**
 * The release of the downloaded app, sent as X-Px-Client. The release bundle (CONTRACT.md section 3) sets
 * NEXT_PUBLIC_PX_RELEASE at build time; a deployment build falls back to its commit; a dev server is "dev".
 */
export function getReleaseVersion(): string {
  return process.env.NEXT_PUBLIC_PX_RELEASE || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || "dev";
}

export async function accessToken(): Promise<string | null> {
  const { data } = await createClient().auth.getSession();
  return data.session?.access_token ?? null;
}

let pacer: RequestPacer | null = null;
/** The one request pacer of this browser tab (rate-pacer.ts): every replica of the tab shares it, so their sum stays under the cap. */
export function sharedPacer(): RequestPacer {
  return (pacer ??= createRequestPacer());
}

export function createSharedSyncClient(options: { timeoutMs?: number; maxRetries?: number } = {}): SyncClient {
  return createSyncClient({ getAccessToken: accessToken, getReleaseVersion, timeoutMs: options.timeoutMs, maxRetries: options.maxRetries });
}
