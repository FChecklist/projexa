// LOCAL-FIRST mode: the one switch (localStorage `px-local-first` = "1", read by local-reader.ts's isLocalFirstEnabled()) that makes
// the laptop serve the on-laptop shell FIRST for every app navigation once a release is installed. The service worker cannot read
// localStorage, so turning the switch also tells the worker (SET_MODE), and the boot code repeats it at every start.

import { LOCAL_FIRST_FLAG, LOCAL_FIRST_OPT_OUT, applyLocalFirstDefault, isLocalFirstEnabled } from "./local-reader";
import { createSwClient, type SwClient } from "./release/sw-client";

export { LOCAL_FIRST_FLAG, LOCAL_FIRST_OPT_OUT, applyLocalFirstDefault, isLocalFirstEnabled };

/** Turns local-first mode on or off for this laptop (and remembers an "off" as the person's own choice) and tells the service worker. Returns whether the flag was stored. */
export async function setLocalFirstEnabled(enabled: boolean, deps: { storage?: Pick<Storage, "setItem" | "removeItem"> | null; sw?: Pick<SwClient, "setMode"> } = {}): Promise<boolean> {
  const storage = deps.storage === undefined ? (typeof localStorage === "undefined" ? null : localStorage) : deps.storage;
  let stored = false;
  try {
    if (storage) {
      // The person's (or support's) own choice is remembered: turning it OFF writes an opt-out so the signed-in default (applyLocalFirstDefault) does not
      // quietly turn it back on at the next page load; turning it ON clears the opt-out.
      if (enabled) {
        storage.setItem(LOCAL_FIRST_FLAG, "1");
        storage.removeItem(LOCAL_FIRST_OPT_OUT);
      } else {
        storage.removeItem(LOCAL_FIRST_FLAG);
        storage.setItem(LOCAL_FIRST_OPT_OUT, "1");
      }
      stored = true;
    }
  } catch {
    stored = false;
  }
  try {
    await (deps.sw ?? createSwClient()).setMode(enabled);
  } catch {
    /* no worker yet: the boot code tells it at the next start */
  }
  return stored;
}
