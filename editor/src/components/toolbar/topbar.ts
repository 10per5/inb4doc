import { html, render } from "lit-html"
import { unsafeHTML } from "lit-html/directives/unsafe-html.js"
import { colors } from "../../theme"
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
import { mountLinkDialog } from "../dialogs/link-dialog"
import type { ViewType } from "../views/view"
import {
  boldIcon, italicIcon, strikethroughIcon, codeIcon, linkIcon, dividerIcon,
} from "../icons"
import { mountFileMenu } from "./file-menu"
import { pressTwiceButton } from "../dialogs/press-twice-button"
import { formatBytes } from "../../utils/format"

export interface TopbarAPI {
  updateCounter(count: number, totalBytes: number, pendingCount?: number): void
  showSingleDiscard(path: string, bytes: number): void
  hideSingleDiscard(): void
  setDirtyState(hasDirty: boolean): void
  setProviderBadge(icon: string, label: string): void
  setProviderType(type: string): void
  setView(view: ViewType): void
}

export function mountTopbar(
  container: HTMLElement,
  getEditor: () => Editor | null,
  callbacks: {
    onPrefs: () => void
    onDirtyClick?: () => void
    onSingleDiscard?: (path: string) => void
    onChangeProvider: () => void
    onViewChange: (view: ViewType) => void
    onSave?: () => void
    onLoad?: () => void
    onImageManager?: () => void
    onToggleSidebar?: () => void
    onToggleMetaPanel?: () => void
  },
): TopbarAPI {
  const counterId = "dirty-counter-" + Math.random().toString(36).slice(2)
  const flushId = "flush-btn-" + Math.random().toString(36).slice(2)
  const fileMenuMountId = "file-menu-" + Math.random().toString(36).slice(2)

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
      callbacks.onDirtyClick?.()
    }
  })

  const tmpl = html`
      <div class="toolbar-section toolbar-section-left">
        <button @click=${() => callbacks.onToggleSidebar?.()} title="Toggle Sidebar" class="mobile-only" style="display:none">☰</button>
        <span class="toolbar-sep mobile-only" style="display:none"></span>
        <div id="${fileMenuMountId}"></div>
      </div>
      <span class="toolbar-sep"></span>
      <div class="toolbar-section toolbar-section-center">
        <span class="toolbar-heading-wrap">
          <button class="toolbar-heading-btn" @click=${() => {
            const el = container.querySelector(".toolbar-heading-dropdown") as HTMLElement
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
        <button @click=${() => callbacks.onToggleMetaPanel?.()} title="Meta Panel" class="mobile-only" style="display:none">⚙</button>
      </div>
      <div class="toolbar-spacer"></div>
      <div class="toolbar-section toolbar-section-right">
        <span class="dirty-counter" id="${counterId}"></span>
        <button id="${flushId}" class="flush-btn" data-action="editor#flush" disabled>Flush</button>
        <button @click=${callbacks.onPrefs} title="Preferences">⚙</button>
      </div>
  `

  render(tmpl, container)

  const fileMenuMount = document.getElementById(fileMenuMountId)
  const fileMenu = fileMenuMount
    ? mountFileMenu(fileMenuMount, {
        onChangeProvider: callbacks.onChangeProvider,
        onViewChange: callbacks.onViewChange,
        onSave: callbacks.onSave,
        onLoad: callbacks.onLoad,
        onImageManager: callbacks.onImageManager,
      })
    : null

  return {
    updateCounter(count: number, totalBytes: number, pendingCount: number = 0) {
      const el = document.getElementById(counterId)
      if (!el) return
      el.style.display = ""
      if (count === 0 && pendingCount === 0) {
        el.textContent = ""
        el.classList.toggle("clickable", false)
        return
      }
      const parts: string[] = []
      if (count > 0) {
        const color = totalBytes > 0 ? colors.green : totalBytes < 0 ? colors.danger : 'inherit'
        parts.push(`<span>${count} unsaved</span><span style="color:${color};font-size:0.7rem;margin-left:4px">${formatBytes(totalBytes)}</span>`)
      }
      if (pendingCount > 0) {
        parts.push(`<span style="color:#856404;font-size:0.7rem">${pendingCount} pending</span>`)
      }
      el.innerHTML = `<div style="display:flex;gap:6px;align-items:center">${parts.join('<span style="color:#ccc">|</span>')}</div>`
      el.classList.toggle("clickable", true)
    },
    showSingleDiscard(path: string, bytes: number) {
      const el = document.getElementById(counterId)
      if (!el) return
      el.style.display = ""
      el.innerHTML = ""
      el.classList.toggle("clickable", false)
      const btn = pressTwiceButton({
        idleText: "Discard",
        pendingText: "Press again",
        variant: "danger",
        small: true,
        idleBadge: `(${formatBytes(bytes)})`,
        onConfirm: () => callbacks.onSingleDiscard?.(path),
      })
      el.appendChild(btn)
    },
    hideSingleDiscard() {
      const el = document.getElementById(counterId)
      if (!el) return
      el.textContent = ""
      el.classList.toggle("clickable", false)
    },
    setDirtyState(hasDirty: boolean) {
      const flush = document.getElementById(flushId) as HTMLButtonElement
      if (flush) flush.disabled = !hasDirty
    },
    setProviderBadge(icon: string, label: string) {
      fileMenu?.setProviderBadge(icon, label)
    },
    setProviderType(_type: string) {
      // no-op: save/load are always visible in the File menu
    },
    setView(view: ViewType) {
      fileMenu?.setView(view)
    },
  }
}
