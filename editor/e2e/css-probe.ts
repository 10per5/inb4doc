/**
 * e2e/css-probe.ts — "which stylesheet rule paints this element" probes.
 *
 * Walks every stylesheet reachable from the page and reports:
 *
 * - the computed style of the first element matching a selector
 *   (`computedStyle`);
 * - the CSS rules whose selector matches that element, optionally filtered to
 *   the declarations of interest (`matchingRules`).
 *
 * This answers the recurring "where does the dropline / cell outline get its
 * color from" question from the page side, instead of grepping node_modules.
 */

import type { Page } from "@playwright/test"

export interface MatchingRule {
  selector: string
  css: string
  sheet: string
}

export class CssProbe {
  private readonly page: Page

  constructor(page: Page) {
    this.page = page
  }

  /**
   * Computed style of the first element matching `selector`, or null when no
   * element matches. `props` restricts the returned map to those properties.
   */
  async computedStyle(
    selector: string,
    props?: string[],
  ): Promise<Record<string, string> | null> {
    return this.page.evaluate(
      ({ selector, props }) => {
        const el = document.querySelector(selector)
        if (!el) return null
        const cs = getComputedStyle(el)
        const out: Record<string, string> = {}
        for (const p of props ?? [
          "outline",
          "outlineColor",
          "outlineStyle",
          "outlineWidth",
          "background",
          "backgroundColor",
        ]) {
          out[p] = cs.getPropertyValue(p)
        }
        return out
      },
      { selector, props },
    )
  }

  /**
   * CSS rules whose selector matches the first element matching `selector`.
   * When `props` is given, only rules declaring at least one of those
   * properties are returned (e.g. `["outline", "background-color"]`).
   */
  async matchingRules(
    selector: string,
    props?: string[],
  ): Promise<MatchingRule[]> {
    return this.page.evaluate(
      ({ selector, props }) => {
        const el = document.querySelector(selector)
        if (!el) return []
        const out: MatchingRule[] = []
        for (const sheet of Array.from(document.styleSheets)) {
          let list: CSSRuleList | null = null
          try {
            list = (sheet as CSSStyleSheet).cssRules
          } catch {
            continue
          }
          if (!list) continue
          const name = sheet.href ?? "inline"
          for (const rule of Array.from(list)) {
            if (!("selectorText" in rule) || !("style" in rule)) continue
            const sr = rule as CSSStyleRule
            if (!el.matches(sr.selectorText)) continue
            if (props && !props.some((p) => sr.style.getPropertyValue(p))) {
              continue
            }
            out.push({ selector: sr.selectorText, css: sr.style.cssText, sheet: name })
          }
        }
        return out
      },
      { selector, props },
    )
  }
}
