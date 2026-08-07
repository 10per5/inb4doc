import type { TreeIndex } from "@/utils/tree"
import { getCurrentPath } from "@/utils/url"

// Part D event-bus hygiene: setupNavListeners returns an unsubscribe so a hot
// swap that re-imports this module can tear the previous bindings down instead
// of stacking click/popstate handlers (the caller re-binds per sidebar load).
export function setupNavListeners(handler: (path: string) => void): () => void {
  const els = document.querySelectorAll<HTMLElement>("[data-nav]")
  const onClick = (e: Event) => {
    e.preventDefault()
    const link = (e.currentTarget as HTMLElement).getAttribute("data-nav")!
    handler(link)
  }
  els.forEach((el) => el.addEventListener("click", onClick))
  const onPop = () => handler(getCurrentPath())
  window.addEventListener("popstate", onPop)
  return () => {
    els.forEach((el) => el.removeEventListener("click", onClick))
    window.removeEventListener("popstate", onPop)
  }
}
