"use client";

// R67 D-67 -- the receipt an object page shows after a create.
//
// R-257: "After Save, router.replace to /module/[id] in display mode with the
// footer message 'Created {object} {id}' — never back to an empty form or a
// list." Every create screen in PROJEXA used toast.success() instead, which
// is gone in four seconds; a user who blinked, or who was reading the record
// rather than the corner of the screen, had no way to tell a save that landed
// from one that did not.
//
// The identifier travels in the URL (?created=<what the user would recognise>)
// so it survives a refresh and a shared link, and it is read from
// window.location.search rather than useSearchParams() -- the same choice
// M24Shell makes, because useSearchParams() puts its whole subtree behind a
// Suspense boundary these pages do not otherwise need.

import { useEffect, useState } from "react";
import { createdMessage } from "@/lib/create-screen";

export const CREATED_PARAM = "created";

/** The href a create screen navigates to after a successful save. */
export function createdHref(moduleHref: string, id: string, identifier?: string | null): string {
  const readable = (identifier ?? "").trim();
  const suffix = readable ? `?${CREATED_PARAM}=${encodeURIComponent(readable)}` : `?${CREATED_PARAM}=`;
  return `${moduleHref}/${id}${suffix}`;
}

/**
 * Reads ?created= and renders the persistent line. Returns null when the page
 * was not arrived at from a save, so an object page opened normally shows
 * nothing extra.
 */
export function useCreatedMessage(objectLabel: string): string | null {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has(CREATED_PARAM)) return;
    setMessage(createdMessage(objectLabel, params.get(CREATED_PARAM)));
  }, [objectLabel]);
  return message;
}

export function CreatedReceipt({ objectLabel }: { objectLabel: string }) {
  const message = useCreatedMessage(objectLabel);
  if (!message) return null;
  return (
    <div
      role="status"
      className="rounded-md border border-px-border bg-white px-3 py-2 text-[12px] text-px-muted"
    >
      {message}
    </div>
  );
}

export default CreatedReceipt;
