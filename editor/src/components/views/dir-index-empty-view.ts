import renderDirIndexEmpty from "@/eta/views/dir-index-empty"

export function mountDirIndexEmptyView(container: HTMLElement, onActivate: () => void): void {
  const existing = container.querySelector(".dir-index-empty-view")
  if (existing) existing.remove()

  container.insertAdjacentHTML("beforeend", renderDirIndexEmpty({}))

  const el = container.querySelector(".dir-index-empty-view")
  if (el) {
    el.addEventListener("click", () => {
      el.remove()
      onActivate()
    })
  }
}
