# Phone node runbook: rebuild a phone from scratch

Measured on phone 1: Samsung Galaxy M02s (SM-M025F, 32 GB), Android 12, **32-bit
userland** (`ro.product.cpu.abilist=armeabi-v7a`, `zygote32`, Termux reports
`armv8l`). Total time from a wiped phone: about 20 minutes.

## What runs
Termux (32-bit build) with Node 24 LTS, `sshd` (key-only, port 8022), the PROJEXA
standalone bundle on port 3100, a watchdog, and optionally `cloudflared`. All
started by Termux:Boot at power-on. The phone holds no state: data is in Supabase.

**Flaky internet:** `netwatch.sh` checks the internet every 60 s (every 20 s once it
thinks it is down, so a blip of a few seconds is noticed fast and a 15-minute outage
is followed until it ends). The web node keeps answering on the LAN during an outage.
When the internet returns it restarts cloudflared (fresh tunnel connections), and
restarts the web node only if `/api/health` fails. History: `~/logs/net.log`,
current state: `~/logs/net.state`.

## Steps
1. **Wi-Fi** (owner, manual): join `JioFiber-W72xs`, forget other networks
   (`OWNER_STEPS.md` 1). USB debugging on, accept the RSA prompt.
2. **Wipe / debloat** (adb, optional): `pm uninstall --user 0` the user apps;
   `pm disable-user --user 0` Samsung/Google bloat (list in "Disabled packages").
3. **Keep-alive settings** (adb):
   ```
   settings put global wifi_sleep_policy 2
   settings put global stay_on_while_plugged_in 7
   settings put global adaptive_battery_management_enabled 0
   settings put global app_standby_enabled 0
   settings put global settings_enable_monitor_phantom_procs false      # Android 12+
   device_config put activity_manager max_phantom_processes 2147483647  # Android 12+
   for p in com.termux com.termux.boot com.termux.api; do
     dumpsys deviceidle whitelist +$p
     cmd appops set $p RUN_ANY_IN_BACKGROUND allow
   done
   ```
   Leave the screen lock OFF: Termux:Boot only fires after the device is unlocked,
   so a PIN would stop the node coming back after a power cut. The phone holds no
   personal data; keep the secrets file (`~/.projexa.env`) minimal.
4. **Install Termux** from the official GitHub releases (not the Play Store),
   matching the phone's ABI: `termux-app_*_armeabi-v7a.apk`, `termux-boot-app`,
   `termux-api-app`. Verify against the published `sha256sums`, then
   `adb install -r -g <apk>`. Launch Termux once so it unpacks its bootstrap, and
   open Termux:Boot once so it registers.
5. **Bootstrap** (the Termux build is debuggable, so adb `run-as com.termux` works):
   ```
   adb push ops/phone-node /data/local/tmp/pn ; adb push <laptop pubkey> /data/local/tmp/pn/key.pub
   adb shell run-as com.termux sh /data/local/tmp/pn/bootstrap-termux.sh /data/local/tmp/pn/key.pub
   ```
   (env for `run-as`: `HOME=/data/data/com.termux/files/home PREFIX=$HOME/../usr
   PATH=$PREFIX/bin LD_LIBRARY_PATH=$PREFIX/lib TMPDIR=$PREFIX/tmp`.)
6. **Start it** in Termux's own session so Termux supervises it: type
   `bash ~/.termux/boot/00-start.sh` in the Termux terminal (or just reboot).
   `RUN_COMMAND` from adb is refused (needs a permission adb does not hold).
7. **Deploy** the app: build with `PHONE_NODE_BUILD=1` (CI does this,
   `.github/workflows/phone-node-artifact.yml`), then on the phone
   `sh ~/deploy.sh <tag>` (or `--local <tarball>` after `adb push`). Rollback:
   `sh ~/deploy.sh --rollback`.
8. **Owner steps** (secrets, tunnel, DNS): `OWNER_STEPS.md`.

## Verify
```
cat ~/logs/net.log                              # INTERNET DOWN / BACK after Ns
curl http://<phone-ip>:3100/api/health          # {"ok":true,...}
ssh -i <key> -p 8022 <phone-ip> 'uptime; free -m'
adb reboot   # node answers again about 50 s later, no touch
```

## Disabled packages (all reversible: `pm enable <pkg>`)
Samsung: bixby settings, visualars, theme store/center helper, Galaxy Store,
edge panel, maps agent, rubin, people stripe, story service, smart mirroring,
easy setup, scloud, Find My Mobile, DA agent, aware, weather, FM radio, magnifier,
one-hand, quick tool, sound alive, wallpaper packs, handwriting SDK, TalkBack,
SMT TTS, call background, SPP push, billing, Samsung account, MDX kit/quickboard,
Device Care (sdhms, devicesecurity), smart call, attribution, setup-wizard leftovers.
Google: Photos, Gmail, Restore, Device Health (turbo), feedback, one-time init,
print recommendation, TTS, location history, Calendar sync.
Removed with data: WhatsApp, Photos. `themecenter` and `wallpapermulti` refuse to
disable (Samsung-protected).
