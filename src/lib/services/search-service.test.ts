/// <reference types="bun-types" />
// Tests the pure matching/filtering logic behind /api/search. searchAll()
// and searchProjectEntities() themselves go through a live VERIDIAN API call
// and searchTodos() through a live Supabase-scoped DB query -- per this
// repo's established convention (see search-service.test.ts in
// compliance-tracker), those aren't exercised here without a live backend.
import { describe, expect, test } from "bun:test";
import { matchesQuery, filterAndCap, searchProjects } from "./search-service";

describe("matchesQuery", () => {
  test("matches a case-insensitive substring in any field", () => {
    expect(matchesQuery(["Villa 21 - Whitefield"], "whitefield")).toBe(true);
    expect(matchesQuery([null, "Leaking pipe in unit 4B"], "leaking")).toBe(true);
  });

  test("returns false when no field matches", () => {
    expect(matchesQuery(["Villa 21 - Whitefield"], "meridian")).toBe(false);
  });

  test("skips null/undefined fields instead of throwing", () => {
    expect(matchesQuery([null, undefined], "anything")).toBe(false);
  });

  test("an empty query never matches", () => {
    expect(matchesQuery(["Villa 21"], "")).toBe(false);
    expect(matchesQuery(["Villa 21"], "   ")).toBe(false);
  });
});

describe("filterAndCap", () => {
  const items = [
    { id: "1", subject: "Foundation waterproofing query" },
    { id: "2", subject: "Roof drainage query" },
    { id: "3", subject: "Electrical layout" },
    { id: "4", subject: "Another query about tiles" },
  ];

  test("filters to only matching items", () => {
    const result = filterAndCap(items, (i) => [i.subject], "query", 10);
    expect(result.map((r) => r.id)).toEqual(["1", "2", "4"]);
  });

  test("caps results at the given limit", () => {
    const result = filterAndCap(items, (i) => [i.subject], "query", 2);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id)).toEqual(["1", "2"]);
  });
});

describe("searchProjects", () => {
  const projects = [
    { id: "p1", name: "Villa 21 - Whitefield" },
    { id: "p2", name: "Meridian Business Center" },
  ];

  test("maps matching projects to search result items", () => {
    const result = searchProjects(projects, "meridian", 8);
    expect(result).toEqual([{ type: "project", id: "p2", title: "Meridian Business Center" }]);
  });

  test("returns an empty array when nothing matches", () => {
    expect(searchProjects(projects, "no such project", 8)).toEqual([]);
  });
});
