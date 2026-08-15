/**
 * e2e/session.ts — a page opened against the e2e server, with console/page
 * errors captured and the remote connection pre-seeded to :32600.
 *
 * Does not import `@playwright/test` at runtime — takes the browser as an
 * argument (inject from `e2e/launch`).
 */

import type { Browser, BrowserContext, Page } from "@playwright/test"

export const PORT = 32600
export const BASE = `http://localhost:${PORT}`

/**
 * A page opened against the e2e server. Boots the app wired to :32600
 * (localStorage seeded before the bundle runs), waits for a real selector,
 * and collects console/page errors into {@link EditorSession.errors}.
 */
export class EditorSession {
  readonly context: BrowserContext
  readonly page: Page
  readonly errors: string[]

  constructor(context: BrowserContext, page: Page, errors: string[]) {
    this.context = context
    this.page = page
    this.errors = errors
  }

  /** Quick readiness check for the e2e server (404 counts as "up"). */
  static async status(): Promise<number> {
    try {
      const res = await fetch(`${BASE}/`)
      return res.status
    } catch {
      return 0
    }
  }

  /**
   * Open `docs/<slug>` on the e2e server.
   */
  static async open(
    browser: Browser,
    slug: string,
    opts: { viewport?: { width: number; height: number }; waitFor?: string } = {},
  ): Promise<EditorSession> {
    const context = await browser.newContext({
      viewport: opts.viewport ?? { width: 1400, height: 900 },
    })
    const page = await context.newPage()
    const errors: string[] = []
    page.on("console", (m) => {
      if (m.type() === "error") errors.push("console: " + m.text())
    })
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message))
    await page.addInitScript((port) => {
      localStorage.setItem(
        "inb4doc:connections:0",
        JSON.stringify({ host: "localhost", port }),
      )
    }, PORT)
    await page.goto(`${BASE}/docs/${slug}`, { waitUntil: "load" })
    await page.waitForSelector(opts.waitFor ?? ".milkdown-table-block", {
      timeout: 20000,
    })
    await page.waitForTimeout(1500) // app boot + controllers connect
    return new EditorSession(context, page, errors)
  }

  async close(): Promise<void> {
    await this.context.close()
  }

  /** Bounding box of the nth `.milkdown-table-block`. */
  async tableBox(index = 0) {
    return (await this.page
      .locator(".milkdown-table-block")
      .nth(index)
      .boundingBox())!
  }

  /** What the served content repo actually has on disk for a doc (body only). */
  async contentOnDisk(slug: string): Promise<string> {
    const res = await this.page.request.get(`${BASE}/content/docs/${slug}.md`)
    return res.text()
  }

  /** Number of unflushed pending ops for the session (from localStorage). */
  async pendingOps(): Promise<number> {
    return this.page.evaluate(
      () =>
        Object.keys(localStorage).filter((k) => k.includes("pending-ops")).length,
    )
  }
}
