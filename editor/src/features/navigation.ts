import type { TreeIndex } from "@/utils/tree"
import { getCurrentPath } from "@/utils/url"

let popstateRegistered = false;

export function setupNavListeners(handler: (path: string) => void) {
  document.querySelectorAll("[data-nav]").forEach((el) =>
    el.addEventListener("click", (e) => {
      e.preventDefault()
      const link = el.getAttribute("data-nav")!
      handler(link)
    }),
  )
  if (!popstateRegistered) {
    window.addEventListener("popstate", () => {
      handler(getCurrentPath())
    })
    popstateRegistered = true
  }
}
