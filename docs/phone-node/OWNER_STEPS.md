# Phone node: steps only the owner can do

Everything else is scripted in `ops/phone-node/`. These steps involve a
password, a token, DNS or money, so an agent must not do them.

## 1. Wi-Fi (per phone, 20 seconds)
Settings > Wi-Fi > `JioFiber-W72xs` > enter the password > Connect. Forget every
other network on the phone so it cannot hop to a stronger one. Put each phone
where `W72xs` shows at least 2 bars: at -78 dBm (a weak signal) the first phone
saw 350 ms average ping and occasional 1 s spikes.

## 2. Router (JioFiber admin page)
- Reserve a fixed IP for each phone (DHCP reservation by MAC). Current lease of
  phone 1 (32 GB M02s): `192.168.29.191`. Do not port-forward anything.
- Confirm "AP / client isolation" is OFF (laptop <-> phone traffic already works).

## 3. Cloudflare tunnel (needs the domain's DNS on Cloudflare)
`projexa-ai.com` DNS lives on Vercel today, so a named tunnel hostname cannot work
until the owner moves the zone to Cloudflare (free). Until then test with a quick
tunnel: `cloudflared tunnel --url http://127.0.0.1:3100` (temporary
`*.trycloudflare.com` URL, no account needed).

When the owner decides to move DNS:
1. Cloudflare Zero Trust > Networks > Tunnels > Create tunnel (Cloudflared) >
   name it `projexa-phones`. Copy the tunnel token. Never paste it in chat or git.
2. On EACH phone (via `ssh -p 8022 <phone-ip>`), run one line, pasting the token
   yourself:  `read -rs T && printf %s "$T" > ~/.projexa.tunnel && chmod 600 ~/.projexa.tunnel`
   Both phones use the SAME token, so Cloudflare treats them as two replicas of one
   tunnel and fails over between them.
3. In the tunnel's Public Hostname tab: `projexa-ai.com` -> `http://localhost:3100`.
4. Only then change the DNS (Vercel keeps serving the old records until you do).

## 4. App secrets (per phone)
Create `~/.projexa.env` on the phone yourself (`chmod 600`). It holds the server
env values from `.env.local` (e.g. `NEXT_PUBLIC_SUPABASE_URL`, the anon key,
`VERIDIAN_API_KEY`, `VERIDIAN_API_BASE_URL`). If the server needs a Supabase
service-role key, stop and decide whether a narrower key is possible first.

## 5. GitHub repository variables (for the build)
Settings > Secrets and variables > Actions > **Variables**:
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (public values, baked
into the bundle at build time). If the repo is private, also create a read-only
fine-grained token and save it on each phone as `~/.projexa.gh_token` (`chmod 600`)
so `deploy.sh` can download the release.

## 6. Battery
A phone on a charger 24/7 swells its battery over time. Use a smart plug on a
schedule (charge roughly 40-80%) or Samsung Settings > Battery > "Protect battery"
if present. Keep the phone out of a case, upright, ventilated.

## 7. Second phone
Plug in the 64 GB M02s, enable USB debugging, and run the same
`ops/phone-node/bootstrap-termux.sh` (see `RUNBOOK.md`).
