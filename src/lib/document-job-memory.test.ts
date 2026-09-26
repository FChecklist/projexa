/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-10. The list of files this browser sent: what it keeps, what it drops, and that it works without storage.
import { describe, expect, test } from "bun:test";
import { forgetJob, listRememberedJobs, MAX_REMEMBERED_JOBS, rememberJob } from "./document-job-memory";

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}
const sha = (c: string) => c.repeat(64);
const NOW = () => new Date("2026-09-27T10:00:00.000Z");

describe("remembered jobs", () => {
  test("keeps the hash, the name and the time, newest first, and nothing else", () => {
    const storage = memoryStorage();
    rememberJob({ sha256: sha("a"), fileName: "one.xlsx" }, storage, NOW);
    rememberJob({ sha256: sha("b"), fileName: "two.xlsx" }, storage, NOW);
    expect(listRememberedJobs(storage)).toEqual([
      { sha256: sha("b"), fileName: "two.xlsx", sentAt: "2026-09-27T10:00:00.000Z" },
      { sha256: sha("a"), fileName: "one.xlsx", sentAt: "2026-09-27T10:00:00.000Z" },
    ]);
    const raw = [...storage.map.values()].join("");
    expect(Object.keys(JSON.parse(raw)[0]).sort()).toEqual(["fileName", "sentAt", "sha256"]);
  });

  test("sending the same file again moves it to the front instead of listing it twice", () => {
    const storage = memoryStorage();
    rememberJob({ sha256: sha("a"), fileName: "one.xlsx" }, storage, NOW);
    rememberJob({ sha256: sha("b"), fileName: "two.xlsx" }, storage, NOW);
    rememberJob({ sha256: sha("a"), fileName: "one.xlsx" }, storage, NOW);
    expect(listRememberedJobs(storage).map((j) => j.sha256)).toEqual([sha("a"), sha("b")]);
  });

  test("holds at most MAX_REMEMBERED_JOBS, oldest dropped", () => {
    const storage = memoryStorage();
    for (let i = 0; i < MAX_REMEMBERED_JOBS + 5; i++) rememberJob({ sha256: i.toString(16).padStart(64, "0"), fileName: `f${i}` }, storage, NOW);
    const list = listRememberedJobs(storage);
    expect(list).toHaveLength(MAX_REMEMBERED_JOBS);
    expect(list[0].fileName).toBe(`f${MAX_REMEMBERED_JOBS + 4}`);
  });

  test("forgetJob drops a finished job and leaves the rest", () => {
    const storage = memoryStorage();
    rememberJob({ sha256: sha("a"), fileName: "one.xlsx" }, storage, NOW);
    rememberJob({ sha256: sha("b"), fileName: "two.xlsx" }, storage, NOW);
    forgetJob(sha("a"), storage);
    expect(listRememberedJobs(storage).map((j) => j.sha256)).toEqual([sha("b")]);
  });

  test("a hash that is not 64 hex characters is never stored", () => {
    const storage = memoryStorage();
    rememberJob({ sha256: "not-a-hash", fileName: "x.xlsx" }, storage, NOW);
    expect(listRememberedJobs(storage)).toEqual([]);
  });

  test("damaged storage reads as an empty list and never throws", () => {
    expect(listRememberedJobs(memoryStorage({ "projexa.documentJobs.v1": "{not json" }))).toEqual([]);
    expect(listRememberedJobs(memoryStorage({ "projexa.documentJobs.v1": JSON.stringify([{ sha256: 5 }, null, "x"]) }))).toEqual([]);
  });

  test("works with no storage at all (private window, blocked site data)", () => {
    expect(listRememberedJobs(null)).toEqual([]);
    expect(() => rememberJob({ sha256: sha("a"), fileName: "x" }, null, NOW)).not.toThrow();
    expect(() => forgetJob(sha("a"), null)).not.toThrow();
    const blocked = { getItem: () => { throw new Error("blocked") }, setItem: () => { throw new Error("blocked") } };
    expect(listRememberedJobs(blocked)).toEqual([]);
    expect(() => rememberJob({ sha256: sha("a"), fileName: "x" }, blocked, NOW)).not.toThrow();
  });
});
