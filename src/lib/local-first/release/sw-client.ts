// LOCAL-FIRST release: the page's side of the conversation with the service worker (see sw-core.ts for the messages). Every
// call is best effort and bounded in time: a browser without a service worker, a worker that is not running yet, or one that never
// answers is "no answer" (null), never an exception and never a hang.

export type SwTarget = { postMessage(message: unknown, transfer: Transferable[]): void };

export type SwContainerLike = {
  controller: SwTarget | null;
  getRegistration(): Promise<{ active: SwTarget | null } | undefined>;
  register(url: string): Promise<unknown>;
  ready: Promise<unknown>;
};

export type SwReply = { ok: boolean; type?: string; error?: string; [key: string]: unknown };

type ChannelFactory = () => { port1: { onmessage: ((e: { data: unknown }) => void) | null; close(): void }; port2: Transferable };

const defaultChannel: ChannelFactory = () => new MessageChannel() as unknown as ReturnType<ChannelFactory>;

function browserContainer(): SwContainerLike | null {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker as unknown as SwContainerLike;
}

/** Sends one message and waits (up to timeoutMs) for the worker's reply on a private channel. null = nobody answered. */
export async function postToServiceWorker(
  message: Record<string, unknown>,
  options: { container?: SwContainerLike | null; timeoutMs?: number; channel?: ChannelFactory } = {}
): Promise<SwReply | null> {
  const container = options.container === undefined ? browserContainer() : options.container;
  if (!container) return null;
  let target: SwTarget | null = container.controller;
  if (!target) {
    try {
      target = (await container.getRegistration())?.active ?? null;
    } catch {
      target = null;
    }
  }
  if (!target) return null;

  const channel = (options.channel ?? defaultChannel)();
  return new Promise<SwReply | null>((resolve) => {
    const timer = setTimeout(() => {
      channel.port1.close();
      resolve(null);
    }, options.timeoutMs ?? 5_000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve((event.data ?? null) as SwReply | null);
    };
    try {
      target!.postMessage(message, [channel.port2]);
    } catch {
      clearTimeout(timer);
      channel.port1.close();
      resolve(null);
    }
  });
}

export type SwClient = {
  /** Make `version` the active release (its cache must already exist). */
  useRelease(version: string, personId?: string | null, localFirst?: boolean): Promise<SwReply | null>;
  setMode(localFirst: boolean): Promise<SwReply | null>;
  setPerson(personId: string): Promise<SwReply | null>;
  /**
   * Sign-out: this person's release stops being served. With keepRelease (the default sign-out, AUDIT-100 A3) the release cache stays on the
   * laptop for the same person's next sign-in; without it the release caches and the pointer are deleted.
   */
  clearPerson(personId: string | null, options?: { keepRelease?: boolean }): Promise<SwReply | null>;
  /** Take control of the open pages (clients.claim()): for a page that loaded while the worker was activating. */
  claim?(): Promise<SwReply | null>;
  status(): Promise<SwReply | null>;
};

export function createSwClient(options: { container?: SwContainerLike | null; timeoutMs?: number; channel?: ChannelFactory } = {}): SwClient {
  const send = (message: Record<string, unknown>) => postToServiceWorker(message, options);
  return {
    useRelease: (version, personId, localFirst) =>
      send({ type: "USE_RELEASE", version, ...(personId ? { personId } : {}), ...(typeof localFirst === "boolean" ? { localFirst } : {}) }),
    setMode: (localFirst) => send({ type: "SET_MODE", localFirst }),
    setPerson: (personId) => send({ type: "SET_PERSON", personId }),
    clearPerson: (personId, options) => send({ type: "CLEAR_PERSON", ...(personId ? { personId } : {}), ...(options?.keepRelease && personId ? { keepRelease: true } : {}) }),
    claim: () => send({ type: "CLAIM" }),
    status: () => send({ type: "STATUS" }),
  };
}

/** Registers /sw.js (idempotent) and waits until a worker is active. false when the browser has none or it did not start in time. */
export async function ensureServiceWorker(options: { container?: SwContainerLike | null; url?: string; timeoutMs?: number } = {}): Promise<boolean> {
  const container = options.container === undefined ? browserContainer() : options.container;
  if (!container) return false;
  try {
    await container.register(options.url ?? "/sw.js");
    const started = await Promise.race([
      container.ready.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), options.timeoutMs ?? 20_000)),
    ]);
    if (!started) return false;
    return Boolean(container.controller) || Boolean((await container.getRegistration())?.active);
  } catch {
    return false;
  }
}

/**
 * A release that a signed-out person KEPT on this laptop (sw-core.ts CLEAR_PERSON keepRelease) is dropped before ANOTHER person installs:
 * SET_PERSON for someone else deletes it, so the installer sees the cache gone and downloads this person's own. Returns true when it was dropped.
 * Called by both install paths (boot's quiet install, the prepare screen's verified install) before installRelease.
 */
export async function dropReleaseKeptForAnother(sw: Pick<SwClient, "status" | "setPerson">, personId: string | null): Promise<boolean> {
  if (!personId) return false;
  const status = await sw.status().catch(() => null);
  if (!status || status.signedOut !== true || typeof status.personId !== "string" || status.personId === personId) return false;
  const reply = await sw.setPerson(personId).catch(() => null);
  return Boolean(reply && reply.ok && reply.cleared);
}
