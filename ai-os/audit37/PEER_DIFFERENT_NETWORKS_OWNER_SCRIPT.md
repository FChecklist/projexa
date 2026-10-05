# Laptop-to-laptop sync across two different networks: owner script (AUDIT-100 B22)

## What is already built and proven (no action needed)

- Two laptops on the same network, or on most home networks, already connect directly: free public STUN only, nothing billed.
- When no direct path exists (a phone hotspot, a carrier-grade NAT, a strict office firewall), the laptop now **keeps working**. The small peer
  marker shows one sentence, "Another laptop was found but could not be reached directly; your work is safe on this laptop.", and the
  laptop keeps syncing through the server. There is no dialog and no error.
- The app can now use a **TURN relay** for that case. The relay credentials are short-lived. Each signed-in person fetches their own from
  one address set at build time (`NEXT_PUBLIC_PEER_ICE_URL`). No relay secret is ever put in the browser code.
  Code: `src/lib/local-first/peer/ice.ts` (+ `ice.test.ts`) and `peer-shared.ts`.
- Proven in a real browser with no internet: `e2e/lf-peer-relay.spec.ts` runs a local relay and forces both laptops to "relay only", so
  no direct path can exist. With the relay configured, both laptops' databases end up holding both signed rows, and the browser's own
  statistics show a relay-to-relay path. With the relay left out, the same laptops never connect, and they show the sentence above.
  Run it with `bunx playwright test -c playwright.peer.config.ts lf-peer-relay`.

Until step 2 below is done, `NEXT_PUBLIC_PEER_ICE_URL` is not set. The app then behaves exactly as before: STUN only, with no extra
request.

## Owner steps (3)

### Step 1: create the relay account (owner only: an account and a secret)

Recommended: **Cloudflare Realtime TURN**, on the Cloudflare account that already hosts the company sites.
Dashboard > Realtime > TURN Server > Create. Keep the **Turn Token ID** and the **API token** it shows. Both are secrets: do not put them
in chat or in git.

Cost: the free tier covers 1,000 GB of relayed data a month, and this app only relays when two laptops cannot reach each other directly.
Above the free tier Cloudflare bills per GB, so turn on a usage alert. Per the no-paid-steps rule, decide this yourself.

Then set the two values as Supabase Edge Function secrets on project `pcrjmlpuqsbocqfwoxod` (Dashboard > Edge Functions > Secrets):
`PEER_TURN_KEY_ID` and `PEER_TURN_API_TOKEN`.

### Step 2: switch the relay on (needs one small server change + a deploy, then one Vercel value)

a. Server change (Claude can write it on request, then you approve the deploy): add `POST /ice` to the `projexa-sync` Edge function.
   It checks the person's bearer token exactly as `POST /attest` does (signed-in and a member of an organisation, or 401). Then it calls

   ```
   POST https://rtc.live.cloudflare.com/v1/turn/keys/$PEER_TURN_KEY_ID/credentials/generate-ice-servers
   Authorization: Bearer $PEER_TURN_API_TOKEN
   Content-Type: application/json
   {"ttl": 3600}
   ```

   and returns `{ "iceServers": <Cloudflare's iceServers>, "ttl": 3600 }`. It stores nothing. Add a per-person daily cap, the same as
   other routes, so one person cannot mint credentials in a loop. The browser accepts exactly this shape (`ice.ts parseIceAnswer`).

b. In Vercel (project `projexa`), set
   `NEXT_PUBLIC_PEER_ICE_URL = https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/projexa-sync/ice`
   for Production, then redeploy. This address is not a secret.

Not recommended: metered.ca's "fetch credentials" link. It carries its API key in the address, so anyone who opens the app could use up
the quota.

### Step 3: the real two-laptop run (two real networks)

1. Laptop A on the office or home Wi-Fi. Laptop B on a **phone hotspot**: mobile carriers use carrier-grade NAT, which is the hard case.
   Sign in on both as two people of the same organisation and open the same project.
2. Within about a minute, both peer markers should say **"Synced with 1 laptop"**. To see the path, open `edge://webrtc-internals`
   (or `chrome://webrtc-internals`) on laptop B. The connected candidate pair should show `relay` when the hotspot blocked a direct path.
   Before step 2 is live, the same setup shows "Another laptop was found but could not be reached directly; ...".
3. On laptop A, change one RFI's subject. Laptop B should show the change.

   Then report three things: what each marker said, the candidate type from `webrtc-internals`, and whether the change arrived.

Until step 3 is run, AUDIT-100 B22 "two real laptops on different networks" stays **owner-only**. The relay path itself is VERIFIED in a
real browser by `e2e/lf-peer-relay.spec.ts`.
