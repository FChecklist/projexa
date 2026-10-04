// LOCAL-FIRST offline sign-in (Audit 37 points 16, 19-25). A laptop that signed out can still hold its local copy (IndexedDB
// projexa-local:<userId>) but could not get back in without a network. After every successful ONLINE sign-in this keeps, on this laptop
// only, a salted PBKDF2 hash of the passcode (the password the person just typed) keyed by lowercase email, plus the profile needed to
// rebuild the identity. Offline, a matching passcode re-creates the identity through the SAME identity store the shell already reads
// (identity.ts), so the /local shell opens as usual. The plain passcode is never stored. Nothing here is sent anywhere.

import type { DurableIdentity, IdentityStore } from "./identity";

export const OFFLINE_PIN_KEY = "px-offline-pin-v1";
const ITERATIONS = 120_000;

export type PinRecord = {
  userId: string;
  salt: string; // base64
  hash: string; // base64
  iterations: number;
  name: string | null;
  orgId: string | null;
  role: string | null;
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export const OFFLINE_NO_RECORD_NOTICE = "You are offline. Sign in once while online first, then this laptop can open without internet.";
export const OFFLINE_WRONG_PIN_NOTICE = "That passcode does not match. You are offline, so check the password you normally use.";

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const normaliseEmail = (email: string) => email.trim().toLowerCase();

export async function hashPin(pin: string, salt: Uint8Array, iterations = ITERATIONS): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, key, 256);
  return b64(new Uint8Array(bits));
}

export async function createPinRecord(
  pin: string,
  profile: { userId: string; name?: string | null; orgId?: string | null; role?: string | null },
): Promise<PinRecord> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return {
    userId: profile.userId,
    salt: b64(salt),
    hash: await hashPin(pin, salt),
    iterations: ITERATIONS,
    name: profile.name ?? null,
    orgId: profile.orgId ?? null,
    role: profile.role ?? null,
  };
}

export async function verifyPin(pin: string, record: PinRecord): Promise<boolean> {
  try {
    const hash = await hashPin(pin, unb64(record.salt), record.iterations);
    if (hash.length !== record.hash.length) return false;
    let diff = 0;
    for (let i = 0; i < hash.length; i += 1) diff |= hash.charCodeAt(i) ^ record.hash.charCodeAt(i);
    return diff === 0;
  } catch {
    return false;
  }
}

function readAll(storage: StorageLike | null | undefined): Record<string, PinRecord> {
  try {
    const v = JSON.parse(storage?.getItem(OFFLINE_PIN_KEY) ?? "{}");
    return v && typeof v === "object" ? (v as Record<string, PinRecord>) : {};
  } catch {
    return {};
  }
}

/** After a successful online sign-in. Best effort: never throws, never blocks the sign-in. */
export async function rememberPinAfterOnlineLogin(
  storage: StorageLike | null | undefined,
  email: string,
  pin: string,
  profile: { userId: string; name?: string | null; orgId?: string | null; role?: string | null },
): Promise<void> {
  try {
    if (!storage || !pin) return;
    const all = readAll(storage);
    all[normaliseEmail(email)] = await createPinRecord(pin, profile);
    storage.setItem(OFFLINE_PIN_KEY, JSON.stringify(all));
  } catch {
    /* storage blocked or no WebCrypto: offline sign-in just stays unavailable */
  }
}

export type OfflineUnlock = { ok: true; identity: DurableIdentity } | { ok: false; reason: "no_record" | "wrong_pin"; notice: string };

/** Offline sign-in: checks the passcode and, if right, re-creates the identity in the store the offline shell reads. */
export async function unlockOffline(
  deps: { storage: StorageLike | null | undefined; identityStore: IdentityStore; now?: () => number },
  email: string,
  pin: string,
): Promise<OfflineUnlock> {
  const record = readAll(deps.storage)[normaliseEmail(email)];
  if (!record) return { ok: false, reason: "no_record", notice: OFFLINE_NO_RECORD_NOTICE };
  if (!(await verifyPin(pin, record))) return { ok: false, reason: "wrong_pin", notice: OFFLINE_WRONG_PIN_NOTICE };
  const now = (deps.now ?? Date.now)();
  const existing = await deps.identityStore.read().catch(() => null);
  const same = existing && existing.userId === record.userId ? existing : null;
  const identity: DurableIdentity = {
    userId: record.userId,
    email: normaliseEmail(email),
    name: same?.name ?? record.name,
    orgId: same?.orgId ?? record.orgId,
    role: same?.role ?? record.role,
    lastRefreshAt: now,
    signedInAt: same?.signedInAt ?? now,
    // No session tokens: this laptop is offline. The Supabase session is rebuilt the next time it signs in online.
    session: same?.session ?? null,
  };
  await deps.identityStore.write(identity);
  return { ok: true, identity };
}
