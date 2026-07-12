import { html, render } from "lit-html"
import { unsafeHTML } from "lit-html/directives/unsafe-html.js"
import { colors } from "@/config/theme"
import type { Editor } from "@milkdown/kit/core"
import { commandsCtx, editorViewCtx } from "@milkdown/kit/core"
import {
  toggleStrongCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  wrapInHeadingCommand,
  insertHrCommand,
} from "@milkdown/kit/preset/commonmark"
import { toggleStrikethroughCommand } from "@milkdown/kit/preset/gfm"
import { mountLinkDialog } from "@/components/dialogs/link-dialog"
import {
  boldIcon, italicIcon, strikethroughIcon, codeIcon, linkIcon, dividerIcon,
} from "@/components/ui/icons"
import { mountFileMenu } from "@/components/toolbar/file-menu"
import { mountViewMenu } from "@/components/toolbar/view-menu"
import { pressTwiceButton } from "@/components/ui/press-twice-button"
import { formatBytes } from "@/utils/format"
import { appEvents, AppEvent } from "@/stores/app-events"

export function mountTopbar(
  container: HTMLElement,
  getEditor: () => Editor | null,
): void {
  const counterId = "dirty-counter-" + Math.random().toString(36).slice(2)
  const flushId = "flush-btn-" + Math.random().toString(36).slice(2)
  const fileMenuMountId = "file-menu-" + Math.random().toString(36).slice(2)
  const viewMenuMountId = "view-menu-" + Math.random().toString(36).slice(2)

  const exec = (cmd: string, ...args: unknown[]) => {
    const milkdown = getEditor()
    if (!milkdown) return
    milkdown.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.focus()
      const commands = ctx.get(commandsCtx)
      switch (cmd) {
        case "bold":
          commands.call(toggleStrongCommand.key)
          break
        case "italic":
          commands.call(toggleEmphasisCommand.key)
          break
        case "strike":
          commands.call(toggleStrikethroughCommand.key)
          break
        case "code":
          commands.call(toggleInlineCodeCommand.key)
          break
        case "link":
          mountLinkDialog(getEditor)
          break
        case "heading":
          commands.call(wrapInHeadingCommand.key, ...args)
          break
        case "hr":
          commands.call(insertHrCommand.key)
          break
      }
    })
  }

  container.classList.add("app-toolbar")

  container.addEventListener("click", (e) => {
    const target = e.target as HTMLElement
    if (target.closest(".dirty-counter")?.classList.contains("clickable")) {
      appEvents.emit(AppEvent.DirtyClicked)
    }
  })

  const tmpl = html`
      <div class="toolbar-section toolbar-section-left">
        <button @click=${() => appEvents.emit(AppEvent.SidebarToggle)} title="Toggle Sidebar" class="mobile-only" style="display:none">☰</button>
        <span class="toolbar-sep mobile-only" style="display:none"></span>
        <div id="${fileMenuMountId}"></div>
        <div id="${viewMenuMountId}"></div>
      </div>
      <span class="toolbar-sep"></span>
      <div class="toolbar-section toolbar-section-center">
        <span class="toolbar-heading-wrap">
          <button class="toolbar-heading-btn" @click=${() => {
            const el = container.querySelector(".toolbar-heading-dropdown") as HTMLElement
            const opening = !el?.classList.contains("open")
            if (opening) {
              document.querySelectorAll(".toolbar-menu.open").forEach((m) => m.classList.remove("open"))
            }
            el?.classList.toggle("open")
          }} title="Heading">
            <span class="heading-label">H</span>
          </button>
          <div class="toolbar-heading-dropdown">
            <button @click=${() => exec("heading", 1)} data-h="1">H1</button>
            <button @click=${() => exec("heading", 2)} data-h="2">H2</button>
            <button @click=${() => exec("heading", 3)} data-h="3">H3</button>
          </div>
        </span>
        <button @click=${() => exec("bold")} title="Bold (Ctrl+B)">${unsafeHTML(boldIcon)}</button>
        <button @click=${() => exec("italic")} title="Italic (Ctrl+I)">${unsafeHTML(italicIcon)}</button>
        <button @click=${() => exec("strike")} title="Strikethrough">${unsafeHTML(strikethroughIcon)}</button>
        <button @click=${() => exec("code")} title="Inline Code">${unsafeHTML(codeIcon)}</button>
        <button @click=${() => exec("hr")} title="Insert Horizontal Rule">${unsafeHTML(dividerIcon)}</button>
        <span class="toolbar-sep"></span>
        <button @click=${() => exec("link")} title="Insert Link">${unsafeHTML(linkIcon)}</button>
        <span class="toolbar-sep"></span>
        <button data-action="editor#toggleSource" title="Source Mode">{ }</button>
        <span class="toolbar-sep"></span>
        <button @click=${() => appEvents.emit(AppEvent.MetaPanelToggle)} title="Meta Panel" class="mobile-only" style="display:none">⚙</button>
      </div>
      <div class="toolbar-spacer"></div>
      <div class="toolbar-section toolbar-section-right">
        <span class="dirty-counter" id="${counterId}"></span>
        <button id="${flushId}" class="flush-btn" @click=${() => appEvents.emit(AppEvent.FlushAll)} disabled>Flush</button>
        <button @click=${() => appEvents.emit(AppEvent.PrefsOpened)} title="Preferences">⚙</button>
      </div>
  `

  render(tmpl, container)

  const headingDropdown = container.querySelector(".toolbar-heading-dropdown") as HTMLElement | null
  const headingBtn = container.querySelector(".toolbar-heading-btn") as HTMLElement | null
  if (headingDropdown && headingBtn) {
    document.addEventListener("click", (e) => {
      if (!headingDropdown.classList.contains("open")) return
      const target = e.target as HTMLElement
      if (!target.closest(".toolbar-heading-wrap")) {
        headingDropdown.classList.remove("open")
      }
    })
  }

  const fileMenuMount = document.getElementById(fileMenuMountId)
  const fileMenu = fileMenuMount ? mountFileMenu(fileMenuMount) : null

  const viewMenuMount = document.getElementById(viewMenuMountId)
  const viewMenu = viewMenuMount ? mountViewMenu(viewMenuMount) : null

  // ── Subscribe to state-change events ──

  const unsubs = [
    appEvents.on(AppEvent.DirtyChanged, ({ count, bytes, pendingCount, singleDirtyPath }) => {
      const el = document.getElementById(counterId)
      if (!el) return

      el.style.display = ""
      el.textContent = ""
      el.classList.toggle("clickable", false)

      if (count === 1 && pendingCount === 0 && singleDirtyPath) {
        const btn = pressTwiceButton({
          idleText: "Discard",
          pendingText: "Press again",
          variant: "danger",
          small: true,
          idleBadge: `(${formatBytes(bytes)})`,
          onConfirm: () => appEvents.emit(AppEvent.SingleDiscardRequested, { path: singleDirtyPath }),
        })
        el.appendChild(btn)
      } else if (count > 0 || pendingCount > 0) {
        const parts: string[] = []
        if (count > 0) {
          const color = bytes > 0 ? colors.green : bytes < 0 ? colors.danger : 'inherit'
          parts.push(`<span>${count} unsaved</span><span style="color:${color};font-size:0.7rem;margin-left:4px">${formatBytes(bytes)}</span>`)
        }
        if (pendingCount > 0) {
          parts.push(`<span style="color:#856404;font-size:0.7rem">${pendingCount} pending</span>`)
        }
        el.innerHTML = `<div style="display:flex;gap:6px;align-items:center">${parts.join('<span style="color:#ccc">|</span>')}</div>`
        el.classList.toggle("clickable", true)
      }

      const flush = document.getElementById(flushId) as HTMLButtonElement
      if (flush) flush.disabled = count === 0 && pendingCount === 0
    }),

    appEvents.on(AppEvent.ViewChanged, ({ view }) => {
      viewMenu?.setView(view)
    }),
  ]

  // Cleanup (if container is removed from DOM)
  const observer = new MutationObserver(() => {
    if (!document.contains(container)) {
      unsubs.forEach(u => u())
      observer.disconnect()
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })
}
