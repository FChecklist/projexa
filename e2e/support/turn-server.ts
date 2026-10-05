// AUDIT-100 B22 (TEST ONLY): a tiny TURN relay (RFC 5766 / RFC 8656 over UDP, long-term credentials) written for e2e/lf-peer-relay.spec.ts,
// so two real browser contexts can be forced through a relay with NO internet, no Docker and no extra package. It implements exactly what
// a WebRTC client needs: Allocate (401 challenge -> authenticated), Refresh, CreatePermission, ChannelBind, Send/Data indications and
// ChannelData, plus a plain Binding answer. Every authenticated request's MESSAGE-INTEGRITY is checked against the configured password,
// and every authenticated answer carries its own, as browsers require. It counts what it relays so the test can prove the data went
// THROUGH it. Not for production: one realm, one user, no quotas.
// Written for this repository (no third-party code copied); same licence as the rest of PROJEXA.

import { createHash, createHmac, randomBytes } from "node:crypto";
import dgram, { type RemoteInfo, type Socket } from "node:dgram";
import os from "node:os";

const MAGIC = 0x2112a442;
const M = { binding: 0x001, allocate: 0x003, refresh: 0x004, send: 0x006, data: 0x007, createPermission: 0x008, channelBind: 0x009 } as const;
const A = {
  username: 0x0006, messageIntegrity: 0x0008, errorCode: 0x0009, channelNumber: 0x000c, lifetime: 0x000d, xorPeerAddress: 0x0012,
  data: 0x0013, realm: 0x0014, nonce: 0x0015, xorRelayedAddress: 0x0016, requestedTransport: 0x0019, xorMappedAddress: 0x0020,
  software: 0x8022, fingerprint: 0x8028,
} as const;

type Attr = { type: number; value: Buffer };
type Msg = { method: number; cls: number; tid: Buffer; attrs: Attr[]; raw: Buffer; miOffset: number };

const typeOf = (method: number, cls: number) => (method & 0x000f) | ((method & 0x0070) << 1) | ((method & 0x0f80) << 2) | ((cls & 1) << 4) | ((cls & 2) << 7);

function parse(buf: Buffer): Msg | null {
  if (buf.length < 20 || (buf[0] & 0xc0) !== 0 || buf.readUInt32BE(4) !== MAGIC) return null;
  const t = buf.readUInt16BE(0);
  const method = (t & 0x000f) | ((t & 0x00e0) >> 1) | ((t & 0x3e00) >> 2);
  const cls = ((t & 0x0010) >> 4) | ((t & 0x0100) >> 7);
  const len = buf.readUInt16BE(2);
  if (20 + len > buf.length) return null;
  const attrs: Attr[] = [];
  let miOffset = -1;
  for (let off = 20; off + 4 <= 20 + len; ) {
    const type = buf.readUInt16BE(off);
    const l = buf.readUInt16BE(off + 2);
    if (type === A.messageIntegrity) miOffset = off;
    attrs.push({ type, value: buf.subarray(off + 4, off + 4 + l) });
    off += 4 + ((l + 3) & ~3);
  }
  return { method, cls, tid: buf.subarray(8, 20), attrs, raw: buf.subarray(0, 20 + len), miOffset };
}

const get = (m: Msg, type: number) => m.attrs.find((a) => a.type === type)?.value;

function xorAddr(ip: string, port: number): Buffer {
  const b = Buffer.alloc(8);
  b[1] = 0x01;
  b.writeUInt16BE(port ^ (MAGIC >>> 16), 2);
  const parts = ip.split(".").map(Number);
  b.writeUInt32BE((((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) ^ MAGIC) >>> 0, 4);
  return b;
}

function readXorAddr(v: Buffer): { ip: string; port: number } | null {
  if (v.length < 8 || v[1] !== 0x01) return null; // IPv4 only
  const port = v.readUInt16BE(2) ^ (MAGIC >>> 16);
  const n = (v.readUInt32BE(4) ^ MAGIC) >>> 0;
  return { ip: [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join("."), port };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Encodes a message; with `key`, adds MESSAGE-INTEGRITY; always adds FINGERPRINT. */
function encode(method: number, cls: number, tid: Buffer, attrs: Attr[], key?: Buffer): Buffer {
  const parts: Buffer[] = [];
  for (const a of attrs) {
    const h = Buffer.alloc(4);
    h.writeUInt16BE(a.type, 0);
    h.writeUInt16BE(a.value.length, 2);
    parts.push(h, a.value, Buffer.alloc((4 - (a.value.length % 4)) % 4));
  }
  let body = Buffer.concat(parts);
  const header = (extra: number) => {
    const h = Buffer.alloc(20);
    h.writeUInt16BE(typeOf(method, cls), 0);
    h.writeUInt16BE(body.length + extra, 2);
    h.writeUInt32BE(MAGIC, 4);
    tid.copy(h, 8);
    return h;
  };
  if (key) {
    const mac = createHmac("sha1", key).update(Buffer.concat([header(24), body])).digest();
    const h = Buffer.alloc(4);
    h.writeUInt16BE(A.messageIntegrity, 0);
    h.writeUInt16BE(20, 2);
    body = Buffer.concat([body, h, mac]);
  }
  const fp = Buffer.alloc(8);
  fp.writeUInt16BE(A.fingerprint, 0);
  fp.writeUInt16BE(4, 2);
  fp.writeUInt32BE((crc32(Buffer.concat([header(8), body])) ^ 0x5354554e) >>> 0, 4);
  body = Buffer.concat([body, fp]);
  return Buffer.concat([header(0), body]);
}

function integrityOk(m: Msg, key: Buffer): boolean {
  if (m.miOffset < 0) return false;
  const copy = Buffer.from(m.raw.subarray(0, m.miOffset));
  copy.writeUInt16BE(m.miOffset - 20 + 24, 2);
  const mac = createHmac("sha1", key).update(copy).digest();
  return mac.equals(m.raw.subarray(m.miOffset + 4, m.miOffset + 24));
}

const str = (s: string) => Buffer.from(s, "utf8");
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
function errorCode(code: number, reason: string): Attr {
  const b = Buffer.concat([Buffer.from([0, 0, Math.floor(code / 100), code % 100]), str(reason)]);
  return { type: A.errorCode, value: b };
}

type Allocation = {
  client: { ip: string; port: number };
  relay: Socket;
  relayPort: number;
  permissions: Set<string>;
  channels: Map<number, { ip: string; port: number }>;
  byPeer: Map<string, number>;
};

/** A non-loopback IPv4 of this machine (a browser's TURN socket is bound to a real interface), else 127.0.0.1. */
export function localIPv4(): string {
  for (const list of Object.values(os.networkInterfaces())) for (const i of list ?? []) if (i.family === "IPv4" && !i.internal) return i.address;
  return "127.0.0.1";
}

export type TurnStats = { challenges: number; allocations: number; authFailures: number; permissions: number; channelBinds: number; toPeer: number; fromPeer: number; bytes: number };

export async function startTurnServer(o: { username: string; password: string; realm?: string; host?: string }) {
  const realm = o.realm ?? "projexa.test";
  const host = o.host ?? localIPv4();
  const key = createHash("md5").update(`${o.username}:${realm}:${o.password}`).digest();
  const nonce = randomBytes(12).toString("hex");
  const stats: TurnStats = { challenges: 0, allocations: 0, authFailures: 0, permissions: 0, channelBinds: 0, toPeer: 0, fromPeer: 0, bytes: 0 };
  const allocations = new Map<string, Allocation>();
  const server = dgram.createSocket("udp4");
  const k5 = (r: { address?: string; ip?: string; port: number }) => `${r.address ?? r.ip}:${r.port}`;

  const reply = (r: RemoteInfo, b: Buffer) => server.send(b, r.port, r.address);
  const fail = (r: RemoteInfo, m: Msg, code: number, reason: string, auth: boolean, extra: Attr[] = []) =>
    reply(r, encode(m.method, 3, m.tid, [errorCode(code, reason), ...extra], auth ? key : undefined));

  function authenticated(r: RemoteInfo, m: Msg): boolean {
    const user = get(m, A.username)?.toString("utf8");
    if (!user || m.miOffset < 0) {
      stats.challenges += 1;
      fail(r, m, 401, "Unauthorized", false, [{ type: A.realm, value: str(realm) }, { type: A.nonce, value: str(nonce) }]);
      return false;
    }
    if (user !== o.username || !integrityOk(m, key)) {
      stats.authFailures += 1;
      fail(r, m, 401, "Unauthorized", false, [{ type: A.realm, value: str(realm) }, { type: A.nonce, value: str(nonce) }]);
      return false;
    }
    return true;
  }

  async function allocate(r: RemoteInfo, m: Msg) {
    const existing = allocations.get(k5(r));
    if (existing) {
      reply(r, encode(M.allocate, 2, m.tid, [{ type: A.xorRelayedAddress, value: xorAddr(host, existing.relayPort) }, { type: A.xorMappedAddress, value: xorAddr(r.address, r.port) }, { type: A.lifetime, value: u32(600) }], key));
      return;
    }
    const transport = get(m, A.requestedTransport);
    if (!transport || transport[0] !== 17) { fail(r, m, 442, "Unsupported Transport Protocol", true); return; }
    const relay = dgram.createSocket("udp4");
    await new Promise<void>((res) => relay.bind(0, host, () => res()));
    const a: Allocation = { client: { ip: r.address, port: r.port }, relay, relayPort: relay.address().port, permissions: new Set(), channels: new Map(), byPeer: new Map() };
    relay.on("message", (data, peer) => {
      if (!a.permissions.has(peer.address)) return; // no permission: dropped, as RFC 5766 says
      stats.fromPeer += 1;
      stats.bytes += data.length;
      const ch = a.byPeer.get(k5(peer));
      if (ch !== undefined) {
        const h = Buffer.alloc(4);
        h.writeUInt16BE(ch, 0);
        h.writeUInt16BE(data.length, 2);
        server.send(Buffer.concat([h, data]), a.client.port, a.client.ip);
      } else {
        server.send(encode(M.data, 1, randomBytes(12), [{ type: A.xorPeerAddress, value: xorAddr(peer.address, peer.port) }, { type: A.data, value: data }]), a.client.port, a.client.ip);
      }
    });
    allocations.set(k5(r), a);
    stats.allocations += 1;
    reply(r, encode(M.allocate, 2, m.tid, [{ type: A.xorRelayedAddress, value: xorAddr(host, a.relayPort) }, { type: A.xorMappedAddress, value: xorAddr(r.address, r.port) }, { type: A.lifetime, value: u32(600) }], key));
  }

  function toPeer(a: Allocation, peer: { ip: string; port: number }, data: Buffer) {
    if (!a.permissions.has(peer.ip)) return;
    stats.toPeer += 1;
    stats.bytes += data.length;
    a.relay.send(data, peer.port, peer.ip);
  }

  server.on("message", (buf, r) => {
    // ChannelData: 0b01 in the first two bits
    if (buf.length >= 4 && buf[0] >= 0x40 && buf[0] <= 0x7f) {
      const a = allocations.get(k5(r));
      const peer = a?.channels.get(buf.readUInt16BE(0));
      if (a && peer) toPeer(a, peer, buf.subarray(4, 4 + buf.readUInt16BE(2)));
      return;
    }
    const m = parse(buf);
    if (!m) return;
    if (m.method === M.binding && m.cls === 0) {
      reply(r, encode(M.binding, 2, m.tid, [{ type: A.xorMappedAddress, value: xorAddr(r.address, r.port) }]));
      return;
    }
    if (m.method === M.send && m.cls === 1) {
      const a = allocations.get(k5(r));
      const peer = get(m, A.xorPeerAddress);
      const data = get(m, A.data);
      const p = peer && readXorAddr(peer);
      if (a && p && data) toPeer(a, p, data);
      return;
    }
    if (m.cls !== 0) return;
    if (!authenticated(r, m)) return;
    if (m.method === M.allocate) { void allocate(r, m); return; }
    const a = allocations.get(k5(r));
    if (!a) { fail(r, m, 437, "Allocation Mismatch", true); return; }
    if (m.method === M.refresh) {
      const life = get(m, A.lifetime);
      const seconds = life ? life.readUInt32BE(0) : 600;
      if (seconds === 0) { a.relay.close(); allocations.delete(k5(r)); }
      reply(r, encode(M.refresh, 2, m.tid, [{ type: A.lifetime, value: u32(Math.min(seconds, 600)) }], key));
      return;
    }
    if (m.method === M.createPermission) {
      for (const at of m.attrs) if (at.type === A.xorPeerAddress) { const p = readXorAddr(at.value); if (p) { a.permissions.add(p.ip); stats.permissions += 1; } }
      reply(r, encode(M.createPermission, 2, m.tid, [], key));
      return;
    }
    if (m.method === M.channelBind) {
      const ch = get(m, A.channelNumber);
      const peer = get(m, A.xorPeerAddress);
      const p = peer && readXorAddr(peer);
      const n = ch ? ch.readUInt16BE(0) : 0;
      if (!p || n < 0x4000 || n > 0x7fff) { fail(r, m, 400, "Bad Request", true); return; }
      a.channels.set(n, p);
      a.byPeer.set(k5(p), n);
      a.permissions.add(p.ip);
      stats.channelBinds += 1;
      reply(r, encode(M.channelBind, 2, m.tid, [], key));
      return;
    }
    fail(r, m, 400, "Bad Request", true);
  });

  await new Promise<void>((res) => server.bind(0, host, () => res()));
  const port = server.address().port;
  return {
    host,
    port,
    url: `turn:${host}:${port}?transport=udp`,
    stats,
    close: async () => {
      for (const a of allocations.values()) { try { a.relay.close(); } catch { /* gone */ } }
      allocations.clear();
      await new Promise<void>((res) => server.close(() => res()));
    },
  };
}
