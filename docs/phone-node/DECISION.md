# Phone node: decision record and acceptance table

Status 2026-09-26. **Partially measured**: one phone, no secrets on it, 20-second
runs. Every "not yet" below is unmeasured, not passed.

## Measured (phone 1, Galaxy M02s 32 GB, `JioFiber-W72xs` at about -78 dBm)
Real PROJEXA standalone build (Next 16.3.4, Turbopack), Node 24.18 (32-bit ARM,
Termux), load from the laptop over Wi-Fi with autocannon, 5 connections, 20 s.

| Route | req/s | p50 | p97.5 | p99 | errors |
|---|---|---|---|---|---|
| `/api/health` | 53 | 78 ms | 189 ms | 222 ms | 0 / 1059 |
| `/login` (server-rendered page) | 13.7 | 348 ms | 632 ms | 663 ms | 0 / 274 |

Single requests: landing page 3.3 s cold (192 KB), a static chunk 0.31 s.
Battery temperature 33.0 C after the runs. MemAvailable about 1.47 GB (includes
page cache) with 2.6 GB of swap free. Reboot to serving: about 50 s, unattended.

Measured limitation: the app's middleware throws "Supabase URL and Key are
required" because the phone has no `~/.projexa.env`. So authenticated routes
(project list, BOQ, work-progress) were NOT tested; only the public pages were.

## Decisions
| Question | Decision | Evidence |
|---|---|---|
| Native Termux vs proot Debian | **Native Termux** | Runtime deps have no native addons (checked `package.json`); the bundle runs; proot would add 10-30 % CPU cost on a slow CPU for no benefit |
| `sharp` / image optimisation | Off (`images.unoptimized`, only when `PHONE_NODE_BUILD=1`) | Bionic Node cannot load sharp's glibc binary; also no 32-bit ARM build exists |
| Web on both replicas vs split roles | **Both replicas** of the web app (proposed) | One phone renders `/login` at 14 req/s. Not measured with two phones. The compliance API is a much larger app: not attempted |
| 32-bit userland | Accepted | Samsung ships this phone with a 32-bit Android build. Node 24 arm and cloudflared exist for it and both ran |

## Acceptance table
| Criterion (owner's thresholds) | Result | Evidence |
|---|---|---|
| p95 render under 1.5 s at 5 users | **PASS for `/login`** (p97.5 632 ms); other routes not tested | autocannon above |
| Zero process kills in 24 h | **NOT YET** | needs a 24 h soak |
| Free RAM never below 250 MB | **PASS so far** (1.47 GB available during load); not over 24 h | `/proc/meminfo` |
| Battery under 42 C | **PASS so far** (33 C after a 40 s load); not a 30 min run | `dumpsys battery` |
| 24 h soak | **NOT YET** | |
| Failover with one phone unplugged under 10 s | **NOT YET** (needs phone 2 and the tunnel) | |
| Cloudflare caches `/_next/static/*` | **NOT YET** (needs the tunnel and DNS: owner step) | |
| Auto-recovery after power loss | **PASS** | reboot test, about 50 s |
| Survives internet outages (flaky Wi-Fi) | **PASS for a 46 s outage**; a 15-minute outage not yet run | Wi-Fi cycled off/on via adb: `net.log` shows `INTERNET DOWN` then `INTERNET BACK after 46s`; web node uptime unbroken (2177 s), no restart |
| Deploy is atomic, verified, rollback-able | **PASS** (checksum verified, spare-port health check, symlink flip); rollback command exists but was not exercised with two releases | `deploy.sh` log |

## Honest limits
Single home internet line, power cuts, ISP outage, a 32-bit phone CPU, a weak Wi-Fi
signal (about 350 ms average ping before moving the phone), and no SLA. Fine for
pre-launch and a small pilot; not for paying customers without a paid fallback.
If the 24 h soak or the authenticated-route tests miss the thresholds, the
recommendation is the fallback (Vercel Pro at go-live, or a small VPS), not tuning.
