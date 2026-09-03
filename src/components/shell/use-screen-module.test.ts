/// <reference types="bun-types" />
// R67 WS-A (A-06). The hook itself is two lines over usePathname(); the part
// worth asserting is screenModuleFor(), because it is the single derivation
// that decides what the strip says on every one of the app's routes. These
// assertions are the pure half of A-06's acceptance -- the pathname in, the
// four answers out -- and they run with no browser and no dev server.
import { describe, test, expect } from "bun:test";
import { screenModuleFor } from "./use-screen-module";
import { SHIPPED_ROUTES } from "@/lib/nav-routes";

describe("screenModuleFor", () => {
  test("a module list route: the strip already names the module", () => {
    const screen = screenModuleFor("/permits");
    expect(screen.module?.id).toBe("permits");
    expect(screen.chainModule?.label).toBe("Permits");
    expect(screen.createSegment).toBeNull();
    expect(screen.shipped).toBe(true);
  });

  test("a create route: the module stays, and the create word is added", () => {
    const screen = screenModuleFor("/permits/new");
    expect(screen.chainModule?.label).toBe("Permits");
    expect(screen.createSegment?.label).toBe("New permit");
  });

  test("the query string is not part of the sentence", () => {
    // ?tab= and ?withinDays= change what the PAGE shows, never which module
    // the user is standing in -- so they must not reset the chain either.
    expect(screenModuleFor("/work-progress?tab=report&run=1").chainModule?.id).toBe("work-progress");
    expect(screenModuleFor("/work-progress?tab=report").pathname).toBe("/work-progress");
    expect(screenModuleFor("/permits/").pathname).toBe("/permits");
  });

  test("the Dashboard is a module for pills but not for the strip", () => {
    const screen = screenModuleFor("/dashboard");
    expect(screen.module?.id).toBe("dashboard");
    expect(screen.chainModule).toBeNull();
  });

  test("a real page outside the catalogue is shipped but has no module", () => {
    // /settings renders; it simply is not one of Sumeet's modules. The strip
    // must not invent a sentence for it, and must not call it a 404 either.
    const route = SHIPPED_ROUTES.find((r) => r === "/settings") ?? "/";
    const screen = screenModuleFor(route);
    expect(screen.shipped).toBe(true);
    expect(screen.chainModule).toBeNull();
  });

  test("an unshipped URL is reported as such rather than guessed at", () => {
    const screen = screenModuleFor("/permits/expiring-soon-typo/deep");
    expect(screen.shipped).toBe(false);
  });

  test("every shipped route resolves without throwing", () => {
    // The shell runs this on every navigation in the product, including the
    // dynamic [id] routes, so a pathname it cannot handle would be a shell
    // crash rather than a wrong label.
    for (const route of SHIPPED_ROUTES) {
      expect(() => screenModuleFor(route)).not.toThrow();
    }
  });
});
