/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-33. The two browser-first switches read from the server environment: both default off, only the exact text
// "true" or "1" turns one on, and the second does nothing without the first.
import { describe, expect, test } from "bun:test"
import { BOQ_READ_FLAGS_OFF, readBoqReadFlags } from "./boq-read-flags"

describe("readBoqReadFlags", () => {
  test("an empty environment leaves both switches off", () => {
    expect(readBoqReadFlags({})).toEqual({ viaGateway: false, browserFirst: false })
    expect(BOQ_READ_FLAGS_OFF).toEqual({ viaGateway: false, browserFirst: false })
  })

  test("the gateway switch alone turns on only the gateway read", () => {
    expect(readBoqReadFlags({ BUILD001_BOQ_READ_VIA_GATEWAY: "true" })).toEqual({ viaGateway: true, browserFirst: false })
  })

  test("both switches on turn both on, and 1 counts as on", () => {
    expect(readBoqReadFlags({ BUILD001_BOQ_READ_VIA_GATEWAY: "true", BUILD001_BOQ_BROWSER_FIRST: "true" })).toEqual({ viaGateway: true, browserFirst: true })
    expect(readBoqReadFlags({ BUILD001_BOQ_READ_VIA_GATEWAY: "1", BUILD001_BOQ_BROWSER_FIRST: "1" })).toEqual({ viaGateway: true, browserFirst: true })
    expect(readBoqReadFlags({ BUILD001_BOQ_READ_VIA_GATEWAY: " TRUE ", BUILD001_BOQ_BROWSER_FIRST: "True" })).toEqual({ viaGateway: true, browserFirst: true })
  })

  test("browser-first without the gateway switch stays off", () => {
    expect(readBoqReadFlags({ BUILD001_BOQ_BROWSER_FIRST: "true" })).toEqual({ viaGateway: false, browserFirst: false })
  })

  test("anything but true or 1 is off, so a typo cannot turn a read path on", () => {
    for (const v of ["yes", "on", "false", "0", "", "truee", "enabled", "2"]) {
      expect(readBoqReadFlags({ BUILD001_BOQ_READ_VIA_GATEWAY: v, BUILD001_BOQ_BROWSER_FIRST: v })).toEqual({ viaGateway: false, browserFirst: false })
    }
  })
})
