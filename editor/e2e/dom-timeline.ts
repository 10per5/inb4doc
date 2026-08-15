/**
 * e2e/dom-timeline.ts — a unified-clock DOM mutation timeline.
 *
 * Installs a single MutationObserver that records, on one clock:
 *
 * - `class` attribute mutations on any element matching the `watch`
 *   selectors (with a stable per-element id so replacement is detectable);
 * - childList removals/additions of elements matching the `watch` selectors
 *   (the "the highlighted cell's element was REPLACED by a re-render" case,
 *   where the class vanishes without a class mutation).
 *
 * Read the timeline with {@link DomTimeline.entries}. Dispose with
 * {@link DomTimeline.dispose}.
 */

import type { Page } from "@playwright/test"

export interface DomTimelineEntry {
  ms: number
  ev: "attr" | "childRemoved" | "childAdded"
  id?: string
  el: string
  connected?: boolean
  hit?: string
}

export interface DomTimelineOptions {
  /** Selectors whose class mutations / add-remove should be logged. */
  watch?: string[]
  /** Tag every matching element with a stable `data-timeline-id` on install. */
  tag?: boolean
}

/**
 * A unified-clock MutationObserver over `document.body` for a page. Create with
 * {@link DomTimeline.install}, read with {@link DomTimeline.entries}, stop with
 * {@link DomTimeline.dispose}.
 */
export class DomTimeline {
  private readonly page: Page
  private readonly handle: (() => Promise<void>) | null

  private constructor(page: Page, handle: (() => Promise<void>) | null) {
    this.page = page
    this.handle = handle
  }

  /**
   * Install the observer on `page`. `watch` selects the elements whose class
   * mutations and add/remove are logged; the default watches table blocks and
   * video wrappers (the editor's drag-sensitive content).
   */
  static async install(
    page: Page,
    opts: DomTimelineOptions = {},
  ): Promise<DomTimeline> {
    const watch = opts.watch ?? [
      ".milkdown-table-block",
      ".video-wrapper",
      ".text-drag-ghost",
    ]
    const tag = opts.tag ?? true
    await page.evaluate(
      ({ watch, tag }) => {
        const t0 = performance.now()
        const log: DomTimelineEntry[] = []
        ;(window as any).__timeline = log
        const rec = (o: DomTimelineEntry) =>
          log.push({ ms: Math.round(performance.now() - t0), ...o })
        const seen = new Set<Element>()
        const id = (el: Element): string => {
          if (!seen.has(el)) {
            seen.add(el)
            ;(el as HTMLElement).dataset.timelineId = String(seen.size)
          }
          return (el as HTMLElement).dataset.timelineId!
        }
        const matches = (el: Element) =>
          watch.some((sel) => el.matches(sel))

        if (tag) {
          document
            .querySelectorAll(watch.join(","))
            .forEach((el) => id(el))
        }

        const observer = new MutationObserver((recs) => {
          for (const r of recs) {
            if (r.type === "attributes" && r.attributeName === "class") {
              const el = r.target as HTMLElement
              if (matches(el)) {
                rec({
                  ev: "attr",
                  id: id(el),
                  el: el.tagName + "." + el.className,
                  connected: el.isConnected,
                })
              }
            } else if (r.type === "childList") {
              for (const n of r.removedNodes) {
                if (n instanceof HTMLElement && matches(n)) {
                  rec({
                    ev: "childRemoved",
                    id: id(n),
                    el: n.tagName + "." + String(n.className).slice(0, 30),
                  })
                }
              }
              for (const n of r.addedNodes) {
                if (n instanceof HTMLElement && matches(n)) {
                  rec({
                    ev: "childAdded",
                    id: id(n),
                    el: n.tagName + "." + String(n.className).slice(0, 30),
                  })
                }
              }
            }
          }
        })
        observer.observe(document.body, {
          subtree: true,
          attributes: true,
          childList: true,
          attributeFilter: ["class"],
        })
        ;(window as any).__timelineDispose = () => observer.disconnect()
      },
      { watch, tag },
    )
    return new DomTimeline(page, async () => {
      await page.evaluate(() => {
        ;(window as any).__timelineDispose?.()
      })
    })
  }

  /** The timeline recorded so far (ms on the install clock). */
  async entries(): Promise<DomTimelineEntry[]> {
    return this.page.evaluate(() => (window as any).__timeline ?? [])
  }

  /** Stop observing (safe to call multiple times). */
  async dispose(): Promise<void> {
    if (this.handle) await this.handle()
  }
}
