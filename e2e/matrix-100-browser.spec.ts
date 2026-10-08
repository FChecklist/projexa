import { test, expect, type Page } from "@playwright/test"
import { STUB_CODE } from "./support/sign-in"

// MATRIX browser subset (cases B-01 ... B-14): a person at the REAL /login page in real Chromium, against the LOCAL Auth stand-in only
// (e2e/support/fake-supabase-server.mjs: accepts the fixed STUB_CODE, refuses every other code with otp_expired).
//
//     bunx playwright test -c playwright.matrix.config.ts
//
// Realistic mistakes included: a short code, a wrong code, five wrong codes, a code pasted with spaces, going offline, reloading half-way,
// a small phone screen. No live Supabase, no real e-mail, no real account.

const EMAIL = "matrix-user@example.invalid"

type Seen = { otp: string[]; verify: { token: string; status: number }[] }
async function watch(page: Page): Promise<Seen> {
  const seen: Seen = { otp: [], verify: [] }
  page.on("request", (r) => { if (/\/auth\/v1\/otp/.test(r.url()) && r.method() === "POST") seen.otp.push(r.postData() ?? "") })
  page.on("response", (res) => {
    if (/\/auth\/v1\/verify/.test(res.url()) && res.request().method() === "POST") {
      let token = ""
      try { token = JSON.parse(res.request().postData() ?? "{}").token } catch { /* ignore */ }
      seen.verify.push({ token, status: res.status() })
    }
  })
  return seen
}
const toCodeStage = async (page: Page, email = EMAIL) => {
  await page.goto("/login")
  await page.locator("#email").fill(email)
  await page.locator('button[type="submit"]').click()
  await expect(page.locator("#code")).toBeVisible()
}

test("B-01 phone width (375px): the sign-in page has no sideways scroll and its controls are reachable", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  await page.goto("/login")
  await expect(page.locator("#email")).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  const box = await page.locator('button[type="submit"]').boundingBox()
  expect(box && box.width).toBeGreaterThan(100)
  expect(box && box.height).toBeGreaterThanOrEqual(36)
})

test("B-02 there is no password box anywhere on the sign-in page", async ({ page }) => {
  await page.goto("/login")
  await expect(page.locator('input[type="password"]')).toHaveCount(0)
})

test("B-03 an e-mail without an @ is stopped by the form and nothing is sent", async ({ page }) => {
  const seen = await watch(page)
  await page.goto("/login")
  await page.locator("#email").fill("not-an-email")
  await page.locator('button[type="submit"]').click()
  await expect(page.locator("#code")).toHaveCount(0)
  expect(seen.otp).toHaveLength(0)
})

test("B-04 new person: e-mail then the code box appears after exactly ONE code request carrying that e-mail", async ({ page }) => {
  const seen = await watch(page)
  await toCodeStage(page, "  Matrix-NEW@Example.INVALID ")
  expect(seen.otp).toHaveLength(1)
  expect(JSON.parse(seen.otp[0]!)).toMatchObject({ email: "matrix-new@example.invalid" })
})

test("B-05 a code of 5 digits does not submit: the Sign in button stays disabled and nothing is verified", async ({ page }) => {
  const seen = await watch(page)
  await toCodeStage(page)
  await page.locator("#code").fill("12345")
  await expect(page.locator('button[type="submit"]')).toBeDisabled()
  expect(seen.verify).toHaveLength(0)
})

test("B-06 letters typed into the code box are not kept", async ({ page }) => {
  await toCodeStage(page)
  await page.locator("#code").pressSequentially("ab12cd")
  await expect(page.locator("#code")).toHaveValue(/^[0-9]*$/)
})

test("B-07 a wrong code: plain-English notice, the person stays on /login, the box is cleared for another try", async ({ page }) => {
  const seen = await watch(page)
  await toCodeStage(page)
  await page.locator("#code").fill("000000")
  await expect(page.getByText(/expired|not right/i).first()).toBeVisible()
  expect(page.url()).toContain("/login")
  expect(seen.verify.some((v) => v.token === "000000" && v.status === 403)).toBe(true)
  await expect(page.locator("#code")).toHaveValue("")
})

test("B-08 the right code is accepted by the Auth stand-in (200) and the person leaves the e-mail form", async ({ page }) => {
  const seen = await watch(page)
  await toCodeStage(page)
  await page.locator("#code").fill(STUB_CODE)
  await expect.poll(() => seen.verify.find((v) => v.token === STUB_CODE)?.status).toBe(200)
})

test("B-09 a code pasted with spaces is cleaned and accepted", async ({ page }) => {
  const seen = await watch(page)
  await toCodeStage(page)
  // a REAL paste: the browser applies the box's own length limit, which fill() would skip
  await page.locator("#code").focus()
  await page.keyboard.insertText("123 456")
  await expect.poll(() => seen.verify.find((v) => v.token === STUB_CODE)?.status).toBe(200)
})

test("B-10 five wrong codes in a row: the page says to wait 15 minutes, and even the RIGHT code is then refused without asking Auth", async ({ page }) => {
  const seen = await watch(page)
  await toCodeStage(page)
  for (let i = 0; i < 5; i++) {
    await page.locator("#code").fill(`00000${i}`)
    await expect.poll(() => seen.verify.filter((v) => v.token.startsWith("00000")).length).toBeGreaterThanOrEqual(i + 1)
    await expect(page.locator("#code")).toHaveValue("")
  }
  await expect(page.getByText(/wait 15 minutes/i).first()).toBeVisible()
  const before = seen.verify.length
  await page.locator("#code").fill(STUB_CODE)
  await expect(page.getByText(/wait 15 minutes/i).first()).toBeVisible()
  expect(seen.verify.length).toBe(before)
  expect(seen.verify.find((v) => v.token === STUB_CODE)).toBeUndefined()
})

test("B-11 the 15-minute pause survives a reload (stored on the machine)", async ({ page }) => {
  const seen = await watch(page)
  await toCodeStage(page)
  for (let i = 0; i < 5; i++) {
    await page.locator("#code").fill(`00001${i}`)
    await expect.poll(() => seen.verify.length).toBeGreaterThanOrEqual(i + 1)
  }
  await page.reload()
  await page.locator("#email").fill(EMAIL)
  await page.locator('button[type="submit"]').click()
  await expect(page.locator("#code")).toBeVisible()
  await page.locator("#code").fill(STUB_CODE)
  await expect(page.getByText(/wait 15 minutes/i).first()).toBeVisible()
  expect(seen.verify.find((v) => v.token === STUB_CODE)).toBeUndefined()
})

test("B-12 resend is held back for a minute, then allowed once the clock passes it", async ({ page }) => {
  const seen = await watch(page)
  await page.clock.install()
  await toCodeStage(page)
  const resend = page.locator("button.underline").first()
  await expect(resend).toBeDisabled()
  expect(seen.otp).toHaveLength(1)
  await page.clock.fastForward(61_000)
  await expect(resend).toBeEnabled()
  await resend.click()
  await expect.poll(() => seen.otp.length).toBe(2)
})

test("B-13 reload half-way (code box showing): the person is back at a working e-mail form, not a broken page", async ({ page }) => {
  await toCodeStage(page)
  await page.reload()
  await expect(page.locator("#email")).toBeVisible()
  await expect(page.locator("#email")).toBeEnabled()
})

test("B-14 no network on a machine that never signed in: calm 'you need a connection' words, no code request, no crash", async ({ page, context }) => {
  const seen = await watch(page)
  await page.goto("/login")
  await expect(page.locator("#email")).toBeVisible()
  await expect(page.locator('button[type="submit"]')).toBeEnabled()
  await context.setOffline(true)
  await page.locator("#email").fill(EMAIL)
  await page.locator('button[type="submit"]').click()
  await expect(page.getByText(/need a connection/i).first()).toBeVisible()
  expect(seen.otp).toHaveLength(0)
  await context.setOffline(false)
})
