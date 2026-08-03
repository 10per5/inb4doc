import { editorSelfBase, liveUrlBase, isDev } from "@/config";
import { eye, page, folder, folderMinus, menuScale, navArrowDown, folderOpen, folderMinusOpen } from "@/eta/icons";
import { confirmDialog } from "@/controllers/dialog/dialog";
import { showNotification } from "@/components/notification/notification";
import { buildEditorUrl } from "@/utils/url";
import { pagesStore } from "@/stores/page-store";
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

export const fileIcon = `<span class="sidebar-icon sidebar-icon-file">${page}</span>`;

export const folderIcon = `<span class="sidebar-icon sidebar-icon-folder">${folder}</span>`;

export interface SidebarActions {
  onNavigate: (
    path: string,
    searchQuery?: string,
    matchIndex?: number,
    snippetText?: string,
  ) => void;
  onNewItem: (parentPath: string, isFolder?: boolean) => void;
  onDelete: (paths: string[]) => void;
  onSelect: (path: string, isFolder?: boolean) => void;
  onRename: (path: string) => void;
  onMove: (from: string, to: string) => void;
  onReorderWeights: (weights: { path: string; weight: number }[]) => void;
  onChangeProvider: () => void;
}

export interface PendingSets {
  pendingDeleteSet: Set<string>;
  pendingRenameFromSet: Set<string>;
  pendingRenameToMap: Map<string, string>;
  pendingCreateSet: Set<string>;
  pendingMoveToSet: Set<string>;
  pendingMoveFromSet: Set<string>;
  dirtySet: Set<string>;
}

export interface RenderContext {
  current: string;
  basePath: string;
  collapsedSections: Map<string, boolean>;
  rawTree?: TreeIndex;
  pendingSets: PendingSets;
  pendingOps?: readonly PendingOp[];
  hideEmptyFolders?: boolean;
  selectionMode?: boolean;
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
    pendingMoveFromSet: new Set(
      pendingOps
        ?.filter((o) => o.type === PendingOpType.Move)
        .map((o) => o.from) ?? [],
    ),
    dirtySet: new Set(
      pendingOps?.filter((o) => o.type === PendingOpType.Edit).map((o) => o.path) ?? [],
    ),
  };
}

export function isPendingDelete(pagePath: string, ps: PendingSets): boolean {
  if (ps.pendingDeleteSet.has(pagePath)) return true;
  const parts = pagePath.split("/");
  for (let i = 1; i < parts.length; i++) {
    const ancestor = parts.slice(0, i).join("/");
    if (ps.pendingDeleteSet.has(ancestor)) return true;
  }
  const indexPath = `${pagePath}/${HOME_PATH}`;
  if (ps.pendingDeleteSet.has(indexPath)) return true;
  return false;
}

export function isDirPendingCreate(dirPath: string, ps: PendingSets): boolean {
  const indexPath = `${dirPath}/${HOME_PATH.replace(/\.md$/, "")}`;
  return ps.pendingCreateSet.has(indexPath);
}

export function isDirPendingMove(dirPath: string, ps: PendingSets): boolean {
  const indexPath = `${dirPath}/${HOME_PATH.replace(/\.md$/, "")}`;
  return ps.pendingMoveToSet.has(indexPath);
}

export function isFileConvertToDir(pagePath: string, ps: PendingSets, ops?: readonly PendingOp[]): boolean {
  if (!ps.pendingMoveFromSet.has(pagePath)) return false;
  if (!ops) return false;
  const moveOp = ops.find(
    (o): o is Extract<PendingOp, { type: PendingOpType.Move }> => o.type === PendingOpType.Move && o.from === pagePath,
  );
  if (!moveOp) return false;
  const toBase = moveOp.to.replace(/\.md$/, "");
  return toBase.endsWith(`/${HOME_PATH}`) || toBase === HOME_PATH;
}

export function pendingClass(name: string, prefix: string, ps: PendingSets): string {
  const parts = prefix ? `${prefix}/${name}` : name;
  const pagePath = parts.replace(/\.md$/, "");
  const classes: string[] = [];
  if (isPendingDelete(pagePath, ps)) classes.push("pending-delete");
  if (ps.pendingRenameFromSet.has(pagePath)) classes.push("pending-rename");
  if (ps.pendingCreateSet.has(pagePath)) classes.push("pending-create");
  if (ps.pendingMoveToSet.has(pagePath)) classes.push("pending-move");
  if (ps.pendingMoveFromSet.has(pagePath)) classes.push("pending-move");
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

  if (isPendingDelete(pagePath, ps)) {
    result.push(`<span class="pending-badge pending-badge-delete">delete</span>`);
  }
  if (ps.pendingMoveFromSet.has(pagePath)) {
    if (isFileConvertToDir(pagePath, ps, pendingOps)) {
      result.push(`<span class="pending-badge pending-badge-move">→ DIRECTORY</span>`);
    } else {
      const moveOp = pendingOps?.find(
        (o): o is Extract<PendingOp, { type: PendingOpType.Move }> => o.type === PendingOpType.Move && o.from === pagePath,
      );
      if (moveOp) {
        result.push(
          `<span class="pending-badge pending-badge-move">→ ${moveOp.to.split("/").pop()}</span>`,
        );
      }
    }
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

function isFolderEmpty(tree: TreeIndex, dirPath: string): boolean {
  const children = tree.children.get(dirPath) ?? []
  const hasFiles = children.some(c => !c.isDir && !isHomePageFilename(c.name))
  if (hasFiles) return false
  const hasIndex = children.some(c => isHomePageFilename(c.name))
  if (hasIndex) return false
  const dirs = children.filter(c => c.isDir)
  return dirs.every(dir => isFolderEmpty(tree, dir.path))
}

export function renderItems(
  tree: TreeIndex,
  prefix: string,
  depth: number,
  ctx: RenderContext,
): string {
  const children = tree.children.get(prefix) ?? []
  const lineColor = LINE_COLORS[depth % LINE_COLORS.length]

  // Build display list: merge tree children with rawTree pending deletes.
  // Pending moves are NOT re-added here — applyPendingOps already removed the
  // source and added the destination, so re-adding the source would render the
  // same file at both locations.
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
      const label = pagesStore.getOrCreate(child.name).name
      return `
        <div class="nav-item${pendingClass(child.name, prefix, ctx.pendingSets)}" draggable="true" data-nav-path="${path}">
          <a href="${buildEditorUrl(ctx.basePath, path)}" class="nav-link ${active ? "active" : ""}${isHomePageFilename(child.name) && !prefix ? " nav-link-home" : ""}${pendingClass(child.name, prefix, ctx.pendingSets)}" data-action="click->sidebar#onNavigate">
            ${ctx.selectionMode ? `<span class="sidebar-checkbox"></span>` : fileIcon}${label}${pendingLabelSuffix(child.name, prefix, ctx.pendingSets, ctx.pendingOps)}
          </a>
           <button class="nav-more" data-action="click->sidebar#onShowMenu" tabindex="-1">${menuScale}</button>
        </div>`
    }

    // Directory
    if (ctx.hideEmptyFolders && isFolderEmpty(tree, child.path)) return ""

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
      fileWeights: tree.fileWeights,
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
    const fileCount = filteredDirChildren.filter((c) => !c.isDir).length
    const indexPage = hasIndex ? pagesStore.get(`${dirPath}/${HOME_FILENAME}`) : undefined
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
      ? `<span class="sidebar-icon sidebar-icon-folder-empty" style="opacity:0.6">${collapsed ? folderMinus : folderMinusOpen}</span>`
      : `<span class="sidebar-icon sidebar-icon-folder">${collapsed ? folder : folderOpen}</span>`
    const dirPendingDelete = isPendingDelete(dirPath, ctx.pendingSets)
    const dirPendingCreate = isDirPendingCreate(dirPath, ctx.pendingSets)
    const dirPendingMove = isDirPendingMove(dirPath, ctx.pendingSets)
    const dirBadges: string[] = []
    if (dirPendingDelete) {
      dirBadges.push('<span class="pending-badge pending-badge-delete">delete</span>')
    }
    if (dirPendingMove) {
      const fromOp = ctx.pendingOps?.find(
        (o) => (o.type === PendingOpType.Move || o.type === PendingOpType.Rename) && o.to === `${dirPath}/${HOME_PATH.replace(/\.md$/, "")}`,
      )
      if (fromOp && "from" in fromOp) {
        dirBadges.push(
          `<span class="pending-badge pending-badge-move">from ${fromOp.from.split("/").pop()}</span>`,
        )
      }
    } else if (dirPendingCreate) {
      dirBadges.push('<span class="pending-badge pending-badge-create">new</span>')
    }
    return `
      <div class="nav-section${collapsed ? " collapsed" : ""}${dirPendingDelete ? " pending-delete" : ""}" draggable="true" data-nav-path="${dirPath}">
        <span class="nav-section-title depth-${depth}">
          <a href="${buildEditorUrl(ctx.basePath, indexPagePath)}" class="${dirLinkClasses}" data-nav-path="${indexPagePath}" data-action="click->sidebar#onNavigate">
            ${ctx.selectionMode ? `<span class="sidebar-checkbox"></span>` : dirIcon}${label}${fileCount > 0 ? `<span class="sidebar-count">${fileCount}</span>` : ""}${dirBadges.join("")}
          </a>
          <span class="nav-section-toggle" data-action="click->sidebar#onToggleSection">
            ${navArrowDown}
          </span>
          <button class="nav-more" data-action="click->sidebar#onShowMenu" data-is-folder tabindex="-1">${menuScale}</button>
        </span>
        <div class="nav-section-children" style="--line-color: ${lineColor}">
          ${childrenHtml || '<span class="nav-empty">&lt;empty&gt;</span>'}
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

export { eye as liveIcon };
