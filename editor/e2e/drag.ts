/**
 * e2e/drag.ts — native drag simulation against a built editor page.
 *
 * A real drag is started with mouse events (`startNativeDrag`) — the only
 * thing that fires `dragstart` and lets PM seed `view.dragging`. Once
 * dragging, the drag is moved ONLY via CDP `Input.dispatchDragEvent`
 * (`dispatch`) — `page.mouse.move` alone does not fire `dragover` during a
 * native drag.
 *
 * Does not import `@playwright/test` at runtime — takes the session (and a
 * CDP session) as arguments, injected from `e2e/launch`.
 */

import type { CDPSession } from "@playwright/test"
import type { EditorSession } from "./session"

export { EditorSession } from "./session"

/**
 * Native drag simulation against an {@link EditorSession}. Attach with
 * {@link DragHarness.attach}, which opens the CDP session used for moving the
 * drag.
 */
export class DragHarness {
  readonly session: EditorSession
  readonly cdp: CDPSession

  constructor(session: EditorSession, cdp: CDPSession) {
    this.session = session
    this.cdp = cdp
  }

  static async attach(session: EditorSession): Promise<DragHarness> {
    const cdp = await session.context.newCDPSession(session.page)
    return new DragHarness(session, cdp)
  }

  /**
   * Record every drag event that reaches the document, along with the element
   * under the pointer (computed in-page via `elementFromPoint` — the only
   * reliable "where is the pointer really" during a CDP drag). Read with
   * {@link DragHarness.dragLog}.
   */
  async installDragLog(): Promise<void> {
    const { page } = this.session
    await page.evaluate(() => {
      const log: any[] = []
      ;(window as any).__dragLog = log
      const push = (o: any) => log.push({ t: Date.now() % 100000, ...o })
      for (const ev of [
        "dragstart",
        "dragenter",
        "dragover",
        "dragleave",
        "drop",
        "dragend",
      ]) {
        document.addEventListener(ev, (e) => {
          const de = e as DragEvent
          const el = document.elementFromPoint(de.clientX, de.clientY)
          const target = (e.target as HTMLElement) || null
          push({
            ev,
            x: de.clientX,
            y: de.clientY,
            defaultPrevented: e.defaultPrevented,
            target:
              (target?.tagName || "") + "." + (target?.className || ""),
            related: de.relatedTarget
              ? (de.relatedTarget as HTMLElement).tagName
              : null,
            under: el
              ? el.tagName + "." + String(el.className).slice(0, 30)
              : null,
          })
        })
      }
    })
  }

  /** The drag-event log recorded by {@link DragHarness.installDragLog}. */
  async dragLog(): Promise<any[]> {
    return this.session.page.evaluate(() => (window as any).__dragLog ?? [])
  }

  /**
   * Click a draggable block node (e.g. the `<video>` in `.video-wrapper`) to
   * select it. A NodeSelection must be active for PM's `dragstart` to seed
   * `view.dragging` — without it the app treats the drag as an OS file drag.
   */
  async selectBlockNode(selector: string): Promise<void> {
    await this.session.page
      .locator(selector)
      .click({ position: { x: 80, y: 40 } })
    await this.session.page.waitForTimeout(300)
  }

  /**
   * Start a native drag from the given element's center. Real mouse events are
   * required: this is what fires `dragstart` and lets PM seed `view.dragging`.
   */
  async startNativeDrag(selector: string, offset = 8): Promise<void> {
    const { page } = this.session
    const box = (await page.locator(selector).boundingBox())!
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx + offset, cy + offset, { steps: 2 })
    await page.waitForTimeout(150)
  }

  /**
   * Dispatch a single CDP drag event at viewport coords. `settle` lets the page
   * process the event (default 60 ms). CDP drag events carry a synthetic
   * DataTransfer — they only move an ALREADY-STARTED native drag; they never
   * fire `dragstart`.
   */
  async dispatch(
    type: "dragEnter" | "dragOver" | "dragLeave" | "drop" | "dragEnd",
    x: number,
    y: number,
    settle = 60,
  ): Promise<void> {
    const { page } = this.session
    await this.cdp.send("Input.dispatchDragEvent", {
      type,
      x: Math.round(x),
      y: Math.round(y),
      data: {
        items: [{ mimeType: "text/plain", data: "" }],
        files: [],
        dragOperationsMask: 1, // copy; use 2 for move
      },
    })
    await page.waitForTimeout(settle)
  }
}
