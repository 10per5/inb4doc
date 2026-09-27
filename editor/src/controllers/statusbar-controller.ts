import { Controller } from "@hotwired/stimulus"
import type { EditorView } from "prosemirror-view"
import type { Node as PMNode } from "prosemirror-model"
import { appEvents, AppEvent } from "@/stores/app-events"
import { getCurrentPath } from "@/utils/url"
import { pendingOpsStore } from "@/stores/pending-ops-store"
import { PendingOpType } from "@/entities/PendingOps"
import { activeProviderId } from "@/stores/provider-store"
import type { EditorController } from "@/controllers/editor-controller"

export default class StatusBarController extends Controller {
  static targets = ["path", "stats", "dirty"]

  declare readonly pathTarget: HTMLElement
  declare readonly statsTarget: HTMLElement
  declare readonly dirtyTarget: HTMLElement

  // Provider-prefixed id (e.g. "0/blog/x"), matching AppEvent.DirtyChanged's
  // currentPath / dirtyPaths namespace and the sidebar's itemByPath keys.
  private currentPathId = ""
  private displayPath = ""
  private isDirty = false
  private unsubs: (() => void)[] = []

  connect(): void {
    this.displayPath = getCurrentPath()
    this.currentPathId = `${activeProviderId()}/${this.displayPath}`
    this.syncDirtyFromStore()
    this.showPath()

    this.unsubs.push(
      appEvents.on(AppEvent.EditorSelectionChanged, ({ from, to }) =>
        this.onSelectionChanged(from, to),
      ),
      appEvents.on(AppEvent.Navigate, ({ path }) => this.onPathChanged(path)),
      appEvents.on(AppEvent.SidebarActive, ({ path }) => this.onPathChanged(path)),
      appEvents.on(AppEvent.DirtyChanged, (payload) => {
        this.isDirty = payload.dirtyPaths.includes(payload.currentPath ?? "")
        if (this.pathTarget.hidden) return
        this.dirtyTarget.hidden = !this.isDirty
      }),
    )
  }

  disconnect(): void {
    this.unsubs.forEach((u) => u())
    this.unsubs = []
  }

  private onPathChanged(path: string): void {
    this.currentPathId = path
    const prefix = `${activeProviderId()}/`
    this.displayPath = path.startsWith(prefix) ? path.slice(prefix.length) : path
    this.syncDirtyFromStore()
    this.showPath()
  }

  private syncDirtyFromStore(): void {
    this.isDirty = pendingOpsStore
      .load()
      .some((op) => {
        if (op.type !== PendingOpType.Edit && op.type !== PendingOpType.Create) return false
        const opPath = "path" in op ? op.path : ""
        return `${activeProviderId()}/${opPath}` === this.currentPathId
      })
    this.dirtyTarget.hidden = !this.isDirty
  }

  private onSelectionChanged(from: number, to: number): void {
    const editor = this.getEditorView()
    if (!editor) {
      this.showPath()
      return
    }
    if (from === to) {
      this.showPath()
      return
    }
    const text = editor.state.doc.textBetween(from, to, "\n", "\n")
    const chars = text.length
    const lines = text.split("\n").length
    const { rows, cols, cells, tables } = this.countTable(
      from,
      to,
      editor.state.doc,
      editor.state.selection.constructor.name === "CellSelection",
    )
    this.showStats(chars, lines, rows, cols, cells, tables)
  }

  private countTable(
    from: number,
    to: number,
    doc: PMNode,
    isCellSelection: boolean,
  ): { rows: number; cols: number; cells: number; tables: number } {
    // Count only the table rows/cells that actually intersect the selection
    // range, so partial selections report partial dimensions.
    let found = false
    let rows = 0
    let cells = 0
    let cols = 0
    doc.nodesBetween(from, to, (node, pos) => {
      if (node.type.name === "table") {
        found = true
        return true
      }
      if (node.type.name === "tableRow") {
        rows++
        let c = 0
        let offset = pos + 1
        node.forEach((cell) => {
          const cellStart = offset
          const cellEnd = offset + cell.nodeSize
          offset = cellEnd
          const isCell = cell.type.name === "tableCell" || cell.type.name === "tableHeaderCell"
          // For a CellSelection, `to` sits before the head cell node, so the
          // cell starting exactly at `to` is selected (inclusive on that end).
          const overlaps = cellStart < to && cellEnd > from
          const isHeadCell = isCellSelection && cellStart === to
          if (isCell && (overlaps || isHeadCell)) {
            c++
            cells++
          }
        })
        if (c > cols) cols = c
        return false
      }
      return false
    })
    if (!found) return { rows: 0, cols: 0, cells: 0, tables: 0 }
    return { rows, cols, cells, tables: 1 }
  }

  private getEditorView(): EditorView | null {
    const el = document.querySelector("#editor-area")
    if (!el) return null
    const controller = this.application.getControllerForElementAndIdentifier(
      el,
      "editor",
    ) as EditorController | null
    return controller?.getEditor()?.view ?? null
  }

  private showPath(): void {
    this.statsTarget.hidden = true
    this.dirtyTarget.hidden = !this.isDirty
    this.pathTarget.hidden = false
    this.pathTarget.textContent = this.displayPath || "—"
  }

  private showStats(
    chars: number,
    lines: number,
    rows: number,
    cols: number,
    cells: number,
    tables: number,
  ): void {
    this.pathTarget.hidden = true
    this.dirtyTarget.hidden = true
    this.statsTarget.hidden = false
    const base = `${chars} characters, ${lines} lines`
    if (tables > 0) {
      const dims = `${cols} columns × ${rows} rows`
      const cellsLabel = rows !== 1 ? `, ${cells} cells` : ""
      this.statsTarget.textContent = `${base}, ${dims}${cellsLabel}`
    } else {
      this.statsTarget.textContent = `${base} selected`
    }
  }
}
