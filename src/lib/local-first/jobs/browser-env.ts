// The real browser's answers for the claim loop's RunnerEnv. Not unit-tested against a real browser (no DOM here);
// every probe is wrapped so a missing API means "assume fine", except visibility/online which default to the safe side.
import type { RunnerEnv } from "./runner";

type BatteryLike = { level: number; charging: boolean; addEventListener(t: string, cb: () => void): void };

export function createBrowserEnv(onChange: () => void): RunnerEnv & { dispose(): void } {
  let lastActivity = Date.now();
  let low = false;
  const touch = () => { lastActivity = Date.now(); };
  const events = ["pointerdown", "keydown", "scroll"] as const;
  const win = typeof window !== "undefined" ? window : null;
  const doc = typeof document !== "undefined" ? document : null;
  events.forEach((e) => win?.addEventListener(e, touch, { passive: true }));
  doc?.addEventListener("visibilitychange", onChange);
  win?.addEventListener("online", onChange);
  win?.addEventListener("offline", onChange);
  const nav = (typeof navigator !== "undefined" ? navigator : null) as (Navigator & { getBattery?: () => Promise<BatteryLike>; connection?: { saveData?: boolean } }) | null;
  void nav?.getBattery?.().then((b) => {
    const update = () => { low = !b.charging && b.level < 0.2; onChange(); };
    update();
    b.addEventListener("levelchange", update);
    b.addEventListener("chargingchange", update);
  }).catch(() => undefined);
  return {
    now: () => Date.now(),
    isVisible: () => doc?.visibilityState === "visible",
    isOnline: () => nav?.onLine !== false,
    isLowBattery: () => low,
    saveData: () => nav?.connection?.saveData === true,
    lastActivityAt: () => lastActivity,
    dispose() {
      events.forEach((e) => win?.removeEventListener(e, touch));
      doc?.removeEventListener("visibilitychange", onChange);
      win?.removeEventListener("online", onChange);
      win?.removeEventListener("offline", onChange);
    },
  };
}
