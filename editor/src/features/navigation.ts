// Part D event-bus hygiene: setupNavListeners returns an unsubscribe so a hot
// swap that re-imports this module can tear the previous bindings down instead
// of stacking click handlers (the caller re-binds per sidebar load).
//
// URL-driven navigation (browser Back/Forward between documents) is owned by
// `services/ui-history-service.ts`, which distinguishes it from a Back press
// that is unwinding a menu/dialog/window/fullview layer. Do not add a second
// `popstate` listener here — it would navigate away from the layer the shell
// is still unwinding.
export function setupNavListeners(handler: (path: string) => void): () => void {
  const els = document.querySelectorAll<HTMLElement>("[data-nav]")
  const onClick = (e: Event) => {
    e.preventDefault()
    const link = (e.currentTarget as HTMLElement).getAttribute("data-nav")!
    handler(link)
  }
  els.forEach((el) => el.addEventListener("click", onClick))
  return () => {
    els.forEach((el) => el.removeEventListener("click", onClick))
  }
}
