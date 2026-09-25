/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-33 (E-10). The project line index and the message protocol the Web Worker speaks: the same code the worker runs.
import { describe, expect, test } from "bun:test"
import { BOQ_FILTER_MAX_ROWS, BoqLineIndex, answerBoqFilterMessage, normalizeForSearch } from "./boq-filter-engine"
import type { GatewayBoqLine } from "./boq-gateway-client"

function line(id: string, over: Partial<GatewayBoqLine> = {}): GatewayBoqLine {
  return {
    id, boqId: "boq-a", boqTitle: "Villa 21", boqVersion: 1, boqStatus: "approved", parentLineItemId: null, activityId: null,
    itemCode: null, category: null, description: "Plain concrete", unit: "m3", quantity: "1", rate: "1", amount: "1", ...over,
  }
}

function project(): BoqLineIndex {
  const index = new BoqLineIndex()
  index.append([
    line("l1", { description: "Reinforced concrete slab", itemCode: "C-101", category: "Civil", boqId: "boq-a" }),
    line("l2", { description: "Concrète de propreté", itemCode: "C-102", category: "Civil", boqId: "boq-a" }),
    line("l3", { description: "Steel bar bending", itemCode: "S-201", category: "Steel", unit: "kg", boqId: "boq-b", boqTitle: "Villa 21 Rev1", boqVersion: 2 }),
    line("l4", { description: "Painting two coats", itemCode: "P-301", category: "Finishes", unit: "m2", boqId: "boq-b", boqTitle: "Villa 21 Rev1", boqVersion: 2 }),
  ])
  return index
}

describe("normalizeForSearch", () => {
  test("lower-cases and strips accents", () => {
    expect(normalizeForSearch("Concrète ÉLEVÉ")).toBe("concrete eleve")
  })
})

describe("BoqLineIndex.search", () => {
  test("an empty query matches every line in the scope", () => {
    const index = project()
    expect(index.search({ query: "", boqId: null, limit: 10 })).toMatchObject({ total: 4, matched: 4 })
    expect(index.search({ query: "   ", boqId: "boq-a", limit: 10 })).toMatchObject({ total: 2, matched: 2 })
  })

  test("every term must match, in any field and any order", () => {
    const index = project()
    expect(index.search({ query: "concrete slab", boqId: null, limit: 10 }).rows.map((r) => r.id)).toEqual(["l1"])
    expect(index.search({ query: "slab reinforced", boqId: null, limit: 10 }).rows.map((r) => r.id)).toEqual(["l1"])
    expect(index.search({ query: "concrete steel", boqId: null, limit: 10 }).matched).toBe(0)
  })

  test("matches the item code, the category, the unit and the BOQ title as well as the description", () => {
    const index = project()
    expect(index.search({ query: "s-201", boqId: null, limit: 10 }).rows.map((r) => r.id)).toEqual(["l3"])
    expect(index.search({ query: "finishes", boqId: null, limit: 10 }).rows.map((r) => r.id)).toEqual(["l4"])
    expect(index.search({ query: "kg", boqId: null, limit: 10 }).rows.map((r) => r.id)).toEqual(["l3"])
    expect(index.search({ query: "rev1", boqId: null, limit: 10 }).rows.map((r) => r.id)).toEqual(["l3", "l4"])
  })

  test("is blind to case and accents", () => {
    const index = project()
    expect(index.search({ query: "CONCRETE", boqId: null, limit: 10 }).matched).toBe(2)
    expect(index.search({ query: "concrete de propreté", boqId: null, limit: 10 }).rows.map((r) => r.id)).toEqual(["l2"])
  })

  test("a BOQ id narrows the scope: total counts that BOQ only, and other BOQs' lines never match", () => {
    const index = project()
    const result = index.search({ query: "steel", boqId: "boq-a", limit: 10 })
    expect(result).toEqual({ total: 2, matched: 0, rows: [] })
    expect(index.search({ query: "steel", boqId: "boq-b", limit: 10 })).toMatchObject({ total: 2, matched: 1 })
  })

  test("returns at most `limit` rows in index order but counts every match", () => {
    const index = new BoqLineIndex()
    index.append(Array.from({ length: 250 }, (_, i) => line(`x${String(i).padStart(3, "0")}`, { description: "Excavation" })))
    const result = index.search({ query: "excavation", boqId: null, limit: 100 })
    expect(result.matched).toBe(250)
    expect(result.rows.length).toBe(100)
    expect(result.rows[0].id).toBe("x000")
    expect(result.rows[99].id).toBe("x099")
  })

  test("a window is never larger than BOQ_FILTER_MAX_ROWS, and a bad limit gives no rows", () => {
    const index = new BoqLineIndex()
    index.append(Array.from({ length: BOQ_FILTER_MAX_ROWS + 50 }, (_, i) => line(`y${i}`)))
    expect(index.search({ query: "", boqId: null, limit: 1_000_000 }).rows.length).toBe(BOQ_FILTER_MAX_ROWS)
    expect(index.search({ query: "", boqId: null, limit: -5 }).rows.length).toBe(0)
    expect(index.search({ query: "", boqId: null, limit: Number.NaN }).rows.length).toBe(0)
  })

  test("reset empties the index", () => {
    const index = project()
    expect(index.size).toBe(4)
    index.reset()
    expect(index.size).toBe(0)
    expect(index.search({ query: "", boqId: null, limit: 10 }).total).toBe(0)
  })

  test("matches across 10,907 lines and returns only the window", () => {
    const index = new BoqLineIndex()
    index.append(Array.from({ length: 10_907 }, (_, i) => line(`z${i}`, { description: i % 7 === 0 ? `Formwork item ${i}` : `Concrete item ${i}` })))
    const result = index.search({ query: "formwork", boqId: null, limit: 100 })
    expect(result.total).toBe(10_907)
    expect(result.matched).toBe(1_559)
    expect(result.rows.length).toBe(100)
  })
})

describe("answerBoqFilterMessage", () => {
  test("reset, append and filter answer with the request's own id", () => {
    const index = new BoqLineIndex()
    expect(answerBoqFilterMessage(index, { type: "reset", id: 1 })).toEqual({ type: "ok", id: 1, indexed: 0 })
    expect(answerBoqFilterMessage(index, { type: "append", id: 2, lines: [line("a"), line("b")] })).toEqual({ type: "ok", id: 2, indexed: 2 })
    const reply = answerBoqFilterMessage(index, { type: "filter", id: 3, query: "concrete", boqId: null, limit: 1 })
    expect(reply).toMatchObject({ type: "result", id: 3, indexed: 2, total: 2, matched: 2 })
    expect((reply as { rows: GatewayBoqLine[] }).rows.length).toBe(1)
  })

  test("a malformed message is answered with an error reply, never thrown", () => {
    const index = new BoqLineIndex()
    expect(answerBoqFilterMessage(index, null)).toMatchObject({ type: "error", id: -1 })
    expect(answerBoqFilterMessage(index, { type: "nope", id: 4 })).toMatchObject({ type: "error", id: 4 })
    expect(answerBoqFilterMessage(index, { type: "append", id: 5, lines: "x" })).toMatchObject({ type: "error", id: 5 })
    expect(answerBoqFilterMessage(index, { type: "filter", id: 6, query: 3, boqId: null, limit: 1 })).toMatchObject({ type: "error", id: 6 })
    expect(answerBoqFilterMessage(index, { type: "filter", id: 7, query: "a", boqId: undefined, limit: 1 })).toMatchObject({ type: "error", id: 7 })
  })
})
