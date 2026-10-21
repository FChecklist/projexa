/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { createReportShareLink, isShareableReport, shareRangeFor } from "./report-share-link";

const NOW = new Date("2026-10-22T10:00:00Z");

describe("report share link (R-C15)", () => {
  test("only reports with a public page are shareable", () => {
    expect(isShareableReport("work-progress")).toBe(true);
    expect(isShareableReport("project-status")).toBe(true);
    expect(isShareableReport("kpi")).toBe(false);
  });
  test("range: the report's own from/to when present, else the last 30 days", () => {
    expect(shareRangeFor("/api/x?from=2026-01-01&to=2026-01-31", NOW)).toEqual({ from: "2026-01-01", to: "2026-01-31" });
    expect(shareRangeFor("/api/x", NOW)).toEqual({ from: "2026-09-23", to: "2026-10-22" });
  });
  test("posts projectId/from/to to the share route and returns the url", async () => {
    let seen: { url: string; body: unknown } | null = null;
    const fetchImpl = (async (u: RequestInfo | URL, init?: RequestInit) => { seen = { url: String(u), body: JSON.parse(String(init?.body)) }; return new Response(JSON.stringify({ url: "https://x/share/report/t", expiresAt: "e" }), { status: 201 }); }) as typeof fetch;
    const r = await createReportShareLink({ report: "work-progress", projectId: "p1", reportUrl: "/api/y", fetchImpl, now: NOW });
    expect(r.url).toBe("https://x/share/report/t");
    expect(seen!.url).toBe("/api/reports/work-progress/share");
    expect(seen!.body).toEqual({ projectId: "p1", from: "2026-09-23", to: "2026-10-22" });
  });
  test("a refusal throws the server's words; an unshareable report never reaches the network", async () => {
    const bad = (async () => new Response(JSON.stringify({ error: "nope" }), { status: 400 })) as typeof fetch;
    await expect(createReportShareLink({ report: "project-status", projectId: "p", reportUrl: "", fetchImpl: bad })).rejects.toThrow("nope");
    let called = false;
    const spy = (async () => { called = true; return new Response("{}"); }) as typeof fetch;
    await expect(createReportShareLink({ report: "kpi", projectId: "p", reportUrl: "", fetchImpl: spy })).rejects.toThrow("no public view");
    expect(called).toBe(false);
  });
});
