# PROGRESS -- task-20260808-023754-ocid-020-cat17--find-why-webkit-fails-to

## Completed
- [x] Reproduced the failure with the real check: `python3 /opt/veridian/scripts/gtm_check_browser_compatibility.py`
  - Result: `fail`. chromium and firefox both `load_ok: true` (HTTP 200, no page errors) against `https://projexa-ai.com/login`.
  - webkit: `launch_ok: false` -- fails before ever requesting the page. Playwright's own error:
    `browserType.launch: Host system is missing dependencies to run browsers` listing ~39 missing `.so` libraries
    (libgtk-4.so.1, libwebkitgtk-6.0.so.4 [implied], libjavascriptcoregtk, libgraphene-1.0, libvulkan.so.1, gstreamer
    plugin libs, libflite* speech-synthesis libs, libmanette, libenchant, libsoup-3.0, libwayland-server, etc.)
  - Note: the script's own docstring is stale -- it claims firefox/webkit binaries are "confirmed absent" from
    `~/.cache/ms-playwright`. That is no longer true: `ls ~/.cache/ms-playwright` shows `firefox-1532` and
    `webkit-2311` both present (added 2026-08-06). The binaries exist; only webkit's OS-level shared-library
    dependencies are missing.
- [x] Found the real root cause (not a bug in the site or in webkit's rendering of the page -- webkit never gets
  far enough to request the page):
  - Ran `ldd` directly on the real webkit binary
    (`~/.cache/ms-playwright/webkit-2311/minibrowser-gtk/bin/MiniBrowser`): **50 unresolved shared libraries**,
    including the core engine libs themselves (`libwebkitgtk-6.0.so.4`, `libjavascriptcoregtk-6.0.so.1`,
    `libgtk-4.so.1`) plus their transitive deps (libgraphene, libvulkan, gstreamer plugin libs, libflite* TTS
    libs, libavif/libjxl/libwebp codec libs, libmanette, libenchant, libsoup-3.0, libwayland-server, etc.) -- this
    matches exactly the list Playwright's launch error reports.
  - This Ubuntu 24.04 host has a GTK3-era shared-lib shim at
    `/opt/veridian/workspace/browser-tools/local-libs` (used via `LD_LIBRARY_PATH` to make **chromium** launch, per
    the check script's own header comment). Re-running `ldd` with that dir on `LD_LIBRARY_PATH` only resolves
    10/50 of webkit's missing libs -- the remaining 40, including the core `libwebkitgtk-6.0`/`libgtk-4` engine
    libs, are not in that shim at all, because it was built for chromium's (older GTK3) dependency chain, not
    webkit's (GTK4 / WebKitGTK 6.0) chain.
  - `apt list --installed` confirms none of `gtk-4`, `webkitgtk`, `graphene` are installed on the host.
    `npx playwright install-deps webkit --dry-run` (dry-run only, nothing installed) reports **282** missing apt
    packages needed to satisfy webkit's full runtime (GTK4, gstreamer plugin sets, fonts, spellcheck dictionaries,
    speech-synthesis data, icon themes, etc.).
  - No pre-extracted "GTK4/WebKitGTK" lib bundle exists anywhere under
    `/opt/veridian/workspace/browser-tools/` (only the chromium-oriented `local-libs`). `sudo` is not available
    (`sudo -n true` fails, password required), so even a manual/partial install of the missing packages isn't
    possible from this session.
  - **Root cause: webkit fails to load the page purely because this host's OS is missing the entire
    GTK4/WebKitGTK-6.0 native runtime stack (~282 apt packages) that Playwright's Linux webkit build requires to
    even launch. It is an environment/packaging gap, not a defect in projexa-ai.com/login, not a defect in the
    webkit engine itself, and not something the existing chromium-oriented `local-libs` shim covers.** Chromium
    and firefox succeed because their respective dependency chains (GTK3, mostly-bundled-by-Mozilla) are already
    satisfied on this host.
- [x] Evaluated whether a fix is small/clearly-correct: no. The real fix is installing 282 system packages
  (root required, large footprint, no network/sudo access confirmed from this session) -- explicitly out of scope
  per the "don't install new tooling" convention this same check script already follows for the
  firefox/webkit-binary-absent case. No code or fix applied; this is a genuine environment limitation, reported
  with evidence above.
- [x] Recorded completion via `agent_work_briefing.py record-completion`.

## Remaining
- [ ] (Optional, out of scope for this task) If cross-browser webkit testing is required going forward, someone
  with sudo/root would need to run `npx playwright install-deps webkit` (or extract an equivalent GTK4/WebKitGTK
  lib bundle the way `local-libs` was built for chromium) on this host.
