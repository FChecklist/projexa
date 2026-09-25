import { test, expect } from "@playwright/test";
import { buildProjectFixture } from "./support/boq-fixture";
import { GATEWAY_URL, readDeviceCopyMeta, signInLocally, stubAppApis, stubGateway } from "./support/boq-local";

// PROJEXA-BUILD-001 U-33, register row BR-420 (E-09): the BOQ screen renders its line items with the network offline after one online
// load. Runs ONLY through playwright.boq-local.config.ts (see that file): a local PROJEXA server, a synthetic signed-in browser, the Edge
// gateway and the page's /api calls answered from synthetic fixture data. No real session is minted, nothing reaches Vercel.
//
// One test on purpose: the register row expects the runner to print "1 passed".
//
// WHAT "OFFLINE" MEANS HERE. The screen is opened once online and reads the project's lines through the gateway (22 pages of a 10,907-line
// project) into the device copy. Then the browser is put offline (context.setOffline) and the stubs refuse every request too, because a
// fulfilled route can answer even while the browser thinks it is offline. The screen is asked to read its lines again (Refresh lines, the
// same load a fresh visit does) and must show them from the device. A reload of the page is not the check: a reload needs the app's own
// files from the server, and the app shell's offline caching (sw.js) is a separate feature this unit does not change.

test("the BOQ screen renders its line items with the network offline after one online load", async ({ page, context }) => {
  const fixture = buildProjectFixture();
  const session = await signInLocally(context);
  const gateway = await stubGateway(page, fixture, session.accessToken);
  const app = await stubAppApis(page, fixture, session);

  const legacyGrid = page.getByTestId("boq-legacy-detail-grid");
  // A description cell also holds the item code, so a line is found by the start of its text, not by the whole of it.
  const ownLine = (n: number) => legacyGrid.getByText(new RegExp(`^Own slab item ${n}(?!\\d)`));

  await test.step("online: the screen reads the project's lines through the gateway with the person's token and nothing else", async () => {
    await page.goto(`/scope/${fixture.boqId}`);
    await expect(page.getByTestId("boq-line-explorer")).toBeVisible({ timeout: 120_000 });
    await expect(ownLine(1)).toBeVisible();
    await expect(ownLine(fixture.expected.own)).toBeVisible();
    // The gateway's lines, not the proxy's: the proxy's own line is not in the lines table. (The money grid above it still reads the
    // proxy on purpose, because the gateway never carries the project-side cost columns.)
    await expect(legacyGrid.getByText("REST proxy line")).toHaveCount(0);

    // 10,907 lines at the gateway's largest page (500) are 22 pages, each asking for the previous page's cursor.
    const pages = Math.ceil(fixture.expected.total / 500);
    expect(gateway.served.length).toBeGreaterThanOrEqual(pages);
    const firstDownload = gateway.served.slice(0, pages);
    expect(firstDownload[0].after).toBeNull();
    expect(firstDownload.slice(1).every((s, i) => s.after === fixture.lines[(i + 1) * 500 - 1].id)).toBe(true);
    for (const call of gateway.served) {
      expect(call.authorization).toBe(`Bearer ${session.accessToken}`);
      expect(call.cookie).toBeUndefined();
      expect(call.keys).toEqual(["fn", "limit", "projectId"]);
      expect(call.limit).toBe(500);
    }
    expect(GATEWAY_URL).toContain("/functions/v1/projexa-read");
    await expect(page.getByTestId("boq-line-explorer")).toHaveAttribute("data-indexed-lines", String(fixture.expected.total));
  });

  await test.step("the device copy holds the whole project, read back from IndexedDB", async () => {
    const meta = await readDeviceCopyMeta(page, session.userId, fixture.projectId);
    expect(meta).toEqual({ total: fixture.expected.total, chunks: Math.ceil(fixture.expected.total / 500) });
  });

  const gatewayCallsOnline = gateway.served.length;

  await test.step("offline: the network is really gone", async () => {
    gateway.setOffline(true);
    app.setOffline(true);
    await context.setOffline(true);
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    // Non-vacuity: a read of the gateway from this page fails now, so a screen that still shows lines is not being served by it.
    const reach = await page.evaluate(async (url) => {
      try {
        await fetch(`${url}?fn=boq_lines&projectId=fixture-project&limit=1`, { headers: { Authorization: "Bearer x" } });
        return "reached";
      } catch {
        return "failed";
      }
    }, GATEWAY_URL);
    expect(reach).toBe("failed");
  });

  await test.step("offline: Refresh lines shows this BOQ's lines from the device copy", async () => {
    const before = gateway.served.length;
    await page.getByRole("button", { name: "Refresh lines" }).click();
    await expect(page.getByText(new RegExp(`Offline: showing the ${fixture.expected.own} lines of this BOQ saved on this device`))).toBeVisible();
    await expect(ownLine(1)).toBeVisible();
    await expect(ownLine(fixture.expected.own)).toBeVisible();
    await expect(legacyGrid.getByRole("row")).toHaveCount(fixture.expected.own + 1); // the lines and the header row
    // The project search works from the device too.
    await expect(page.getByTestId("boq-line-explorer")).toHaveAttribute("data-indexed-lines", String(fixture.expected.total));
    await expect(page.getByTestId("boq-explorer-row")).toHaveCount(Math.min(100, fixture.expected.own));
    // The screen did not ask the gateway while offline, and no error is shown.
    expect(gateway.served.length).toBe(before);
    expect(gateway.served.length).toBe(gatewayCallsOnline);
    await expect(page.getByRole("alert").filter({ hasText: /Couldn't load/ })).toHaveCount(0);
  });
});
