import { editorSelfBase, liveUrlBase, isDev } from "@/config";
import { liveIcon } from "@/components/ui/icons";
import { confirmDialog } from "@/components/dialogs/dialog";
import { showNotification } from "@/components/notification/notification";
import { buildEditorUrl } from "@/utils/url";
import { pageRepository } from "@/repositories/pageRepository";
import { PendingOpType, type PendingOp, type TreeIndex, type ChildInfo } from "@/utils/tree";
import { SidebarAction, sidebarActions } from "@/config/enums";
import { setContextMenuActions } from "@/controllers/context-menu-controller";
import { ProviderType } from "@/providers/index";
import {
  isRootPath,
  isHomePageFilename,
  HOME_FILENAME,
  HOME_PATH,
} from "@/utils/hugo-compat";

export const fileIcon = `<svg class="sidebar-icon sidebar-icon-file" viewBox="0 0 24 24" aria-hidden="true">
  <path fill="currentColor" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/>
</svg>`;

export const folderIcon = `<svg class="sidebar-icon sidebar-icon-folder" viewBox="0 0 24 24" aria-hidden="true">
  <path fill="currentColor" d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
</svg>`;

export interface SidebarActions {
  onNavigate: (
    path: string,
    searchQuery?: string,
    matchIndex?: number,
    snippetText?: string,
  ) => void;
  onNewItem: (parentPath: string, isFolder?: boolean) => void;
  onDelete: (path: string) => void;
  onRename: (path: string) => void;
  onMove: (from: string, to: string) => void;
  onChangeProvider: () => void;
}

export interface PendingSets {
  pendingDeleteSet: Set<string>;
  pendingRenameFromSet: Set<string>;
  pendingRenameToMap: Map<string, string>;
  pendingCreateSet: Set<string>;
  pendingMoveToSet: Set<string>;
  dirtySet: Set<string>;
}

export interface RenderContext {
  current: string;
  basePath: string;
  collapsedSections: Map<string, boolean>;
  rawTree?: TreeIndex;
  pendingSets: PendingSets;
  pendingOps?: readonly PendingOp[];
}

const LINE_COLORS = [
  "#88c0d0",
  "#b48ead",
  "#a3be8c",
  "#ebcb8b",
  "#d08770",
  "#5e81ac",
  "#8fbcbb",
];

export function buildPendingSets(
  pendingOps?: readonly PendingOp[],
  dirtyPaths?: string[],
): PendingSets {
  return {
    pendingDeleteSet: new Set(
      pendingOps?.filter((o) => o.type === PendingOpType.Delete).map((o) => o.path) ?? [],
    ),
    pendingRenameFromSet: new Set(
      pendingOps?.filter((o) => o.type === PendingOpType.Rename).map((o) => o.from) ?? [],
    ),
    pendingRenameToMap: new Map(
      pendingOps?.filter((o) => o.type === PendingOpType.Rename).map((o) => [o.from, o.to]) ?? [],
    ),
    pendingCreateSet: new Set(
      pendingOps?.filter((o) => o.type === PendingOpType.Create).map((o) => o.path) ?? [],
    ),
    pendingMoveToSet: new Set(
      pendingOps
        ?.filter((o) => o.type === PendingOpType.Move || o.type === PendingOpType.Rename)
        .map((o) => o.to) ?? [],
    ),
    dirtySet: new Set(dirtyPaths ?? []),
  };
}

export function isPendingDelete(pagePath: string, ps: PendingSets): boolean {
  if (ps.pendingDeleteSet.has(pagePath)) return true;
  const parts = pagePath.split("/");
  for (let i = 1; i < parts.length; i++) {
    const ancestor = parts.slice(0, i).join("/");
    if (ps.pendingDeleteSet.has(ancestor)) return true;
  }
  return false;
}

export function pendingClass(name: string, prefix: string, ps: PendingSets): string {
  const parts = prefix ? `${prefix}/${name}` : name;
  const pagePath = parts.replace(/\.md$/, "");
  const classes: string[] = [];
  if (isPendingDelete(pagePath, ps)) classes.push("pending-delete");
  if (ps.pendingRenameFromSet.has(pagePath)) classes.push("pending-rename");
  if (ps.pendingCreateSet.has(pagePath)) classes.push("pending-create");
  if (ps.pendingMoveToSet.has(pagePath)) classes.push("pending-move");
  if (ps.dirtySet.has(pagePath)) classes.push("pending-unsaved");
  return classes.length > 0 ? " " + classes.join(" ") : "";
}

export function pendingLabelSuffix(
  name: string,
  prefix: string,
  ps: PendingSets,
  pendingOps?: readonly PendingOp[],
): string {
  const parts = prefix ? `${prefix}/${name}` : name;
  const pagePath = parts.replace(/\.md$/, "");
  const result: string[] = [];
  if (ps.pendingDeleteSet.has(pagePath)) {
    result.push(`<span class="pending-badge pending-badge-delete">delete</span>`);
  }
  if (ps.pendingRenameFromSet.has(pagePath)) {
    const to = ps.pendingRenameToMap.get(pagePath);
    if (to) {
      result.push(
        `<span class="pending-badge pending-badge-rename">→ ${to.split("/").pop()}</span>`,
      );
    }
  }
  if (ps.pendingCreateSet.has(pagePath)) {
    result.push(`<span class="pending-badge pending-badge-create">new</span>`);
  }
  if (ps.pendingMoveToSet.has(pagePath)) {
    const from = pendingOps?.find(
      (o) => (o.type === PendingOpType.Move || o.type === PendingOpType.Rename) && o.to === pagePath,
    );
    if (from && "from" in from) {
      result.push(
        `<span class="pending-badge pending-badge-move">from ${from.from.split("/").pop()}</span>`,
      );
    }
  }
  if (ps.dirtySet.has(pagePath)) {
    result.push(`<span class="pending-badge pending-badge-unsaved">unsaved</span>`);
  }
  return result.join("");
}

export function renderItems(
  tree: TreeIndex,
  prefix: string,
  depth: number,
  ctx: RenderContext,
): string {
  const children = tree.children.get(prefix) ?? []
  const lineColor = LINE_COLORS[depth % LINE_COLORS.length]

  // Build display list: merge tree children with rawTree pending deletes
  const displayChildren = [...children]
  if (ctx.rawTree && prefix !== undefined) {
    const rawChildren = ctx.rawTree.children.get(prefix) ?? []
    for (const rawChild of rawChildren) {
      if (isHomePageFilename(rawChild.name)) continue
      const pagePath = rawChild.path
      if (ctx.pendingSets.pendingDeleteSet.has(pagePath)) {
        if (!displayChildren.some(c => c.path === pagePath)) {
          displayChildren.push(rawChild)
        }
      }
    }
  }

  // Sort: home page first, then by weight, then name
  displayChildren.sort((a, b) => {
    if (isHomePageFilename(a.name)) return -1
    if (isHomePageFilename(b.name)) return 1
    if (a.weight !== b.weight) return a.weight - b.weight
    return a.name.localeCompare(b.name)
  })

  return displayChildren.map((child) => {
    const path = child.path

    if (!child.isDir) {
      // File (page)
      const active = path === ctx.current
      const label = pageRepository.getOrCreate(child.name).name
      return `
        <div class="nav-item${pendingClass(child.name, prefix, ctx.pendingSets)}" draggable="true" data-nav-path="${path}">
          <a href="${buildEditorUrl(ctx.basePath, path)}" class="nav-link ${active ? "active" : ""}${isHomePageFilename(child.name) && !prefix ? " nav-link-home" : ""}${pendingClass(child.name, prefix, ctx.pendingSets)}" data-action="click->sidebar#onNavigate">
            ${fileIcon}${label}${pendingLabelSuffix(child.name, prefix, ctx.pendingSets, ctx.pendingOps)}
          </a>
          <button class="nav-more" data-action="click->sidebar#onShowMenu" tabindex="-1">⋮</button>
        </div>`
    }

    // Directory
    const childrenDepth = depth + 1
    const dirPath = child.path

    // Filter out _index.md from children for rendering
    const dirChildren = tree.children.get(dirPath) ?? []
    const filteredDirChildren: ChildInfo[] = dirChildren.filter(
      (c) => !isHomePageFilename(c.name)
    )

    // Create a temporary TreeIndex for recursive rendering with filtered children
    const filteredTree: TreeIndex = {
      paths: tree.paths,
      children: new Map(tree.children),
      folderWeights: tree.folderWeights,
    }
    filteredTree.children.set(dirPath, filteredDirChildren)

    const childrenHtml = renderItems(
      filteredTree,
      dirPath,
      childrenDepth,
      ctx,
    )

    const indexPagePath = `${dirPath}/${HOME_PATH}`
    const hasIndex = dirChildren.some(
      (c) => isHomePageFilename(c.name)
    )
    const indexPage = hasIndex ? pageRepository.get(`${dirPath}/${HOME_FILENAME}`) : undefined
    const indexTitle = indexPage?.getFrontmatter?.()?.title
    const dirBaseName = child.name.replace(/-/g, " ").replace(/^\w/, (c: string) => c.toUpperCase())
    const label = indexTitle || dirBaseName
    const collapsed = ctx.collapsedSections.get(dirPath) ?? false
    const isActive = indexPagePath === ctx.current
    const dirLinkClasses = [
      "nav-link",
      isActive ? "active" : "",
      isActive ? "dir-active" : "",
      !hasIndex ? "dir-empty" : "",
    ].filter(Boolean).join(" ")
    const dirIcon = !hasIndex
      ? `<svg class="sidebar-icon sidebar-icon-folder-empty" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" opacity="0.6"/></svg>`
      : folderIcon
    const dirPendingDelete = isPendingDelete(dirPath, ctx.pendingSets)
    return `
      <div class="nav-section${collapsed ? " collapsed" : ""}${dirPendingDelete ? " pending-delete" : ""}" draggable="true" data-nav-path="${dirPath}">
        <span class="nav-section-title depth-${depth}">
          <span class="nav-section-toggle" data-action="click->sidebar#onToggleSection">
            <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
              <path fill="currentColor" d="M7 10l5 5 5-5z"/>
            </svg>
          </span>
          <a href="${buildEditorUrl(ctx.basePath, indexPagePath)}" class="${dirLinkClasses}" data-nav-path="${indexPagePath}" data-action="click->sidebar#onNavigate">
            ${dirIcon}${label}${dirPendingDelete ? '<span class="pending-badge pending-badge-delete">delete</span>' : ''}
          </a>
          <button class="nav-more" data-action="click->sidebar#onShowMenu" data-is-folder tabindex="-1">⋮</button>
        </span>
        <div class="nav-section-children" style="--line-color: ${lineColor}">
          ${childrenHtml}
        </div>
      </div>`
  }).join("")
}

export function highlightText(
  text: string,
  query: string,
): (string | { matched: string })[] {
  const parts: (string | { matched: string })[] = [];
  if (!query) {
    parts.push(text);
    return parts;
  }
  const lower = text.toLowerCase();
  let last = 0;
  let idx = lower.indexOf(query, last);
  while (idx >= 0) {
    if (idx > last) parts.push(text.slice(last, idx));
    parts.push({ matched: text.slice(idx, idx + query.length) });
    last = idx + query.length;
    idx = lower.indexOf(query, last);
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export interface ApplyResultsOpts {
  container: HTMLElement;
  q: string;
  filenameMatches: Set<string>;
  contentMatches: Map<string, string[]>;
  currentQuery: string;
  actions: SidebarActions;
}

export function applyResults(opts: ApplyResultsOpts): void {
  const { container, q, filenameMatches, contentMatches, currentQuery, actions } = opts;
  const items = container.querySelectorAll<HTMLElement>(".nav-item");
  const pathToItem = new Map<string, HTMLElement>();
  for (const item of items) {
    const path = item.getAttribute("data-nav-path") || "";
    pathToItem.set(path, item);
  }

  for (const [path, item] of pathToItem) {
    const matched =
      !q || filenameMatches.has(path) || contentMatches.has(path);
    item.style.display = matched ? "" : "none";

    const snippetEl = item.querySelector(".search-snippet") as HTMLElement;
    const ctx = contentMatches.get(path);
    if (q && ctx && ctx.length > 0) {
      if (!snippetEl) {
        const div = document.createElement("div");
        div.className = "search-snippet";
        const matchSkips: number[] = [];
        let cum = 0;
        for (const snippet of ctx) {
          matchSkips.push(cum);
          const lower = snippet.toLowerCase();
          let si = lower.indexOf(q);
          while (si >= 0) {
            cum++;
            si = lower.indexOf(q, si + q.length);
          }
        }
        for (let i = 0; i < ctx.length; i++) {
          if (i > 0) div.appendChild(document.createElement("hr"));
          const entry = document.createElement("div");
          entry.className = "snippet-entry";
          const parts = highlightText(ctx[i], q);
          for (const part of parts) {
            if (typeof part === "string") {
              entry.appendChild(document.createTextNode(part));
            } else {
              const span = document.createElement("span");
              span.className = "snippet-hl";
              span.textContent = part.matched;
              entry.appendChild(span);
            }
          }
          entry.addEventListener("click", (e) => {
            e.stopPropagation();
            e.preventDefault();
            actions.onNavigate(path, currentQuery, matchSkips[i], ctx[i]);
          });
          div.appendChild(entry);
        }
        item.appendChild(div);
      }
    } else if (snippetEl) {
      snippetEl.remove();
    }
  }

  const sections = container.querySelectorAll<HTMLElement>(".nav-section");
  for (const section of sections) {
    const children = section.querySelectorAll<HTMLElement>(".nav-item");
    const hasVisible = Array.from(children).some(
      (c) => c.style.display !== "none",
    );
    section.style.display = hasVisible || !q ? "" : "none";
  }
}

export function closeMenu(): void {
  document.querySelectorAll(".ctx-menu").forEach((el) => el.remove());
  document.querySelectorAll(".ctx-backdrop").forEach((el) => el.remove());
  document.querySelectorAll('[data-controller="context-menu"]').forEach((el) => el.remove());
}

export function showMenu(
  anchor: HTMLElement,
  pagePath: string,
  actions: SidebarActions,
  isFolder?: boolean,
): void {
  closeMenu();

  const rect = anchor.getBoundingClientRect();
  const el = document.createElement("div");
  el.dataset.controller = "context-menu";
  el.dataset.pagePath = pagePath;
  el.dataset.menuTop = `${rect.bottom + 4}px`;
  el.dataset.menuLeft = `${rect.left}px`;
  if (isFolder) el.dataset.isFolder = "";
  setContextMenuActions(el, actions);
  document.body.appendChild(el);
}

export function computeLiveUrl(providerType?: ProviderType, current?: string): string {
  const basePath = editorSelfBase;
  const page = (!current || isRootPath(current)) ? "" : `/${current}`;
  const baseUrl = liveUrlBase || (isDev ? "http://localhost:5000" : "");
  return baseUrl
    ? `${baseUrl}${providerType === ProviderType.LocalStorage ? "" : page}`
    : "";
}

export { liveIcon };
