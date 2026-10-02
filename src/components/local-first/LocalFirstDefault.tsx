"use client";

import { useState } from "react";
import { applyLocalFirstDefault } from "@/lib/local-first/local-reader";

/**
 * Mount ONCE, first, in the signed-in layout (src/app/(app)/layout.tsx). It renders nothing.
 *
 * Why it exists: the local-first flag (`px-local-first`) was only ever read, never set, so after a deploy no real person would have been on the laptop-first
 * path (the owner's "the user never has to think" would have meant "the user has to know a hidden switch"). A signed-in browser that has not decided gets
 * the flag turned on (and a person who turned it off on purpose stays off: `px-local-first-off`). See applyLocalFirstDefault in local-reader.ts.
 *
 * Why it runs in the render phase (a lazy state initializer), not in an effect: every other component reads the flag in ITS OWN mount effect
 * (WorkspacePrepare, M24Shell, the outbox hooks) and React runs all render work of a commit before any effect, so the first page load of a person
 * already sees the flag on. On the server `localStorage` does not exist and nothing happens; the function is idempotent (React may call an initializer twice).
 * It lives in the signed-in layout only, so a visitor of a public page is untouched (no request, no storage write, no DOM).
 */
export function LocalFirstDefault() {
  useState(() => {
    applyLocalFirstDefault();
    return null;
  });
  return null;
}
