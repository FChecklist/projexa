/// <reference types="bun-types" />
// A project save that ends in a 500/503 may still have reached the database (the timeout is on OUR side of the answer), so the panel must not tell the
// person "Nothing was saved" -- that sent people to press Save again and create the project twice. Found by the live Sumeet audit 2026-10-20/21.
import { describe, expect, test } from "bun:test";
import { projectGuides } from "./project";

describe("project-create-failed wording", () => {
  const g = projectGuides.find((x) => x.id === "project-create-failed");
  test("exists", () => expect(g).toBeDefined());
  test("does not promise that nothing was saved", () => {
    expect(String(g?.what)).not.toMatch(/nothing was saved/i);
    expect(String(g?.what)).toMatch(/may or may not|may not have been saved|could not confirm/i);
  });
  test("still tells the person to check Projects before pressing Save again", () => {
    expect((g?.steps ?? []).join(" ")).toMatch(/Projects/);
  });
});
