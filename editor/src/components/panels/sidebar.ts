import { html, render } from "lit-html";
import { editorSelfBase, liveUrlBase, isDev } from "@/config";
import { liveIcon } from "@/components/ui/icons";
import { confirmDialog } from "@/components/dialogs/dialog";
import { showNotification } from "@/components/notification/notification";
import { buildEditorUrl } from "@/utils/url";
import type { PendingOp } from "@/utils/tree";
import {
  collectPagePaths,
  searchContent,
  type SearchMatch,
} from "@/features/search/sidebar-search";

const fileIcon = html`<svg
  class="sidebar-icon sidebar-icon-file"
  viewBox="0 0 24 24"
  aria-hidden="true"
>
  <path
    fill="currentColor"
    d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"
  />
</svg>`;
const folderIcon = html`<svg
  class="sidebar-icon sidebar-icon-folder"
  viewBox="0 0 24 24"
  aria-hidden="true"
>
  <path
    fill="currentColor"
    d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"
  />
</svg>`;

export interface PageNode {
  weight?: number;
}

export interface TreeNode {
  [key: string]: TreeNode | PageNode | null;
}

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

const LINE_COLORS = [
  "#88c0d0",
  "#b48ead",
  "#a3be8c",
  "#ebcb8b",
  "#d08770",
  "#5e81ac",
  "#8fbcbb",
];

let menuTarget = "";
let menuTimer: ReturnType<typeof setTimeout> | null = null;
const collapsedSections = new Map<string, boolean>();

function closeMenu() {
  document.querySelectorAll(".ctx-menu").forEach((el) => el.remove());
  document.querySelectorAll(".ctx-backdrop").forEach((el) => el.remove());
  menuTarget = "";
}

export function mountSidebar(
  container: HTMLElement,
  tree: TreeNode,
  current: string,
  actions: SidebarActions,
  providerIcon?: string,
  providerLabel?: string,
  providerType?: string,
  pendingOps?: PendingOp[],
  dirtyPaths?: string[],
  rawTree?: TreeNode,
) {
  const basePath = editorSelfBase;
  const page = current === "_index" ? "" : `/${current}`;
  const baseUrl = liveUrlBase || (isDev ? "http://localhost:5000" : "");
  const liveUrl = baseUrl
    ? `${baseUrl}${providerType === "localStorage" ? "" : page}`
    : "";

  const pendingDeleteSet = new Set(
    pendingOps?.filter((o) => o.type === "delete").map((o) => o.path) ?? [],
  );
  const pendingRenameFromSet = new Set(
    pendingOps?.filter((o) => o.type === "rename").map((o) => o.from) ?? [],
  );
  const pendingRenameToMap = new Map(
    pendingOps?.filter((o) => o.type === "rename").map((o) => [o.from, o.to]) ??
      [],
  );
  const pendingCreateSet = new Set(
    pendingOps?.filter((o) => o.type === "create").map((o) => o.path) ?? [],
  );
  const pendingMoveToSet = new Set(
    pendingOps
      ?.filter((o) => o.type === "move" || o.type === "rename")
      .map((o) => o.to) ?? [],
  );
  const dirtySet = new Set(dirtyPaths ?? []);

  function pendingClass(name: string, prefix: string): string {
    const parts = prefix ? `${prefix}/${name}` : name;
    const pagePath = parts.replace(/\.md$/, "");
    const classes: string[] = [];
    if (pendingDeleteSet.has(pagePath)) classes.push("pending-delete");
    if (pendingRenameFromSet.has(pagePath)) classes.push("pending-rename");
    if (pendingCreateSet.has(pagePath)) classes.push("pending-create");
    if (pendingMoveToSet.has(pagePath)) classes.push("pending-move");
    if (dirtySet.has(pagePath)) classes.push("pending-unsaved");
    return classes.length > 0 ? " " + classes.join(" ") : "";
  }

  function pendingLabelSuffix(name: string, prefix: string): unknown {
    const parts = prefix ? `${prefix}/${name}` : name;
    const pagePath = parts.replace(/\.md$/, "");
    const result: unknown[] = [];
    if (pendingDeleteSet.has(pagePath)) {
      result.push(
        html`<span class="pending-badge pending-badge-delete">delete</span>`,
      );
    }
    if (pendingRenameFromSet.has(pagePath)) {
      const to = pendingRenameToMap.get(pagePath);
      if (to) {
        result.push(
          html`<span class="pending-badge pending-badge-rename"
            >→ ${to.split("/").pop()}</span
          >`,
        );
      }
    }
    if (pendingCreateSet.has(pagePath)) {
      result.push(
        html`<span class="pending-badge pending-badge-create">new</span>`,
      );
    }
    if (pendingMoveToSet.has(pagePath)) {
      const from = pendingOps?.find(
        (o) => (o.type === "move" || o.type === "rename") && o.to === pagePath,
      );
      if (from && "from" in from) {
        result.push(
          html`<span class="pending-badge pending-badge-move"
            >from ${from.from.split("/").pop()}</span
          >`,
        );
      }
    }
    if (dirtySet.has(pagePath)) {
      result.push(
        html`<span class="pending-badge pending-badge-unsaved">unsaved</span>`,
      );
    }
    return result;
  }

  function renderItems(
    items: TreeNode,
    prefix = "",
    depth = 0,
    rawSubtree?: TreeNode,
  ): unknown {
    // Merge raw tree items back in so pending deletes remain visible
    const display: TreeNode = { ...items };
    if (rawSubtree) {
      for (const [name, val] of Object.entries(rawSubtree)) {
        const full = prefix ? `${prefix}/${name}` : name;
        const pagePath = full.replace(/\.md$/, "");
        if (pendingDeleteSet.has(pagePath)) {
          if (!(name in display)) {
            display[name] = val;
          }
        }
      }
    }
    const entries = Object.entries(display).sort(
      ([nameA, valA], [nameB, valB]) => {
        if (nameA === "_index.md") return -1;
        if (nameB === "_index.md") return 1;

        const weightA =
          valA != null && typeof valA === "object" && "weight" in valA
            ? ((valA as PageNode).weight ?? Infinity)
            : valA != null && typeof valA === "object" && "_index.md" in valA
              ? ((valA as Record<string, unknown>)["_index.md"] as PageNode)
                  ?.weight ?? Infinity
              : Infinity;
        const weightB =
          valB != null && typeof valB === "object" && "weight" in valB
            ? ((valB as PageNode).weight ?? Infinity)
            : valB != null && typeof valB === "object" && "_index.md" in valB
              ? ((valB as Record<string, unknown>)["_index.md"] as PageNode)
                  ?.weight ?? Infinity
              : Infinity;

        if (weightA !== weightB) return weightA - weightB;
        return nameA.localeCompare(nameB);
      },
    );

    const lineColor = LINE_COLORS[depth % LINE_COLORS.length];

    return entries.map(([name, val]) => {
      const path = prefix ? `${prefix}/${name}` : name;
      const isPage =
        val === null || (typeof val === "object" && "weight" in val);

      if (isPage) {
        const pagePath = path.replace(/\.md$/, "");
        const active = pagePath === current;
        let label: string;
        if (name === "_index.md") {
          label = !prefix ? "Home" : "Index";
        } else {
          label = name
            .replace(/\.md$/, "")
            .replace(/-/g, " ")
            .replace(/^\w/, (c) => c.toUpperCase());
        }
        return html` <div
          class="nav-item${pendingClass(name, prefix)}"
          draggable="true"
          data-nav-path="${pagePath}"
          @dragstart=${(e: DragEvent) => {
            e.dataTransfer?.setData("text/plain", "file:" + pagePath);
          }}
        >
          <a
            href="${buildEditorUrl(basePath, pagePath)}"
            class="nav-link ${active ? "active" : ""}${name === "_index.md" &&
            !prefix
              ? " nav-link-home"
              : ""}${pendingClass(name, prefix)}"
            @click=${(e: Event) => {
              e.preventDefault();
              actions.onNavigate(pagePath);
            }}
          >
            ${fileIcon}${label}${pendingLabelSuffix(name, prefix)}
          </a>
          <button
            class="nav-more"
            tabindex="-1"
            @click=${(e: Event) => {
              e.stopPropagation();
              showMenu(e.target as HTMLElement, pagePath, actions, false);
            }}
          >
            ⋮
          </button>
        </div>`;
      }
      const childrenDepth = depth + 1;
      const rawEntry = rawSubtree?.[name];
      const rawChild =
        rawEntry && typeof rawEntry === "object" && !("weight" in rawEntry)
          ? (rawEntry as TreeNode)
          : undefined;
      const children = renderItems(
        val as TreeNode,
        path,
        childrenDepth,
        rawChild,
      );
      const label = name
        .replace(/-/g, " ")
        .replace(/^\w/, (c) => c.toUpperCase());
      const collapsed = collapsedSections.get(path) ?? false;
      return html` <div
        class="nav-section${collapsed ? " collapsed" : ""}"
        draggable="true"
        data-nav-path="${path}"
        @dragstart=${(e: DragEvent) => {
          if (e.target !== e.currentTarget) return;
          e.dataTransfer?.setData("text/plain", "dir:" + path);
        }}
        @dragenter=${(e: DragEvent) => {
          e.stopPropagation();
          e.preventDefault();
          (e.currentTarget as HTMLElement).classList.add("drag-over");
        }}
        @dragleave=${(e: DragEvent) => {
          e.stopPropagation();
          const el = e.currentTarget as HTMLElement;
          const rt = e.relatedTarget;
          if (rt !== null && !el.contains(rt as Node)) {
            el.classList.remove("drag-over");
          }
        }}
        @dragover=${(e: DragEvent) => {
          e.stopPropagation();
          e.preventDefault();
        }}
        @drop=${async (e: DragEvent) => {
          e.stopPropagation();
          e.preventDefault();
          const el = e.currentTarget as HTMLElement;
          el.classList.remove("drag-over");
          const from = e.dataTransfer?.getData("text/plain");
          if (from) {
            const fromIsDir = from.startsWith("dir:");
            const fromPath = from.replace(/^(?:dir|file):/, "");
            const to = path + "/" + fromPath.split("/").pop();
            if (fromPath === to) return;
            if (fromIsDir && (path === fromPath || path.startsWith(fromPath + "/"))) {
              if (path.startsWith(fromPath + "/")) {
                showNotification(
                  "Cannot move a folder into itself or its own child.",
                  { title: "Sorry, not possible", type: "warning" },
                );
              }
              return;
            }
            const parts = to.split("/");
            let node: unknown = tree;
            let exists = true;
            for (let i = 0; i < parts.length; i++) {
              if (!node || typeof node !== "object") {
                exists = false;
                break;
              }
              const key = i === parts.length - 1 ? parts[i] + ".md" : parts[i];
              node = (node as Record<string, unknown>)[key];
              if (node === undefined) {
                exists = false;
                break;
              }
            }
            if (exists) {
              const confirmed = await confirmDialog({
                title: "Replace file?",
                message: `"${to}" already exists. Do you want to replace it?`,
                confirmLabel: "Replace",
              });
              if (!confirmed) return;
            }
            actions.onMove(fromPath, to);
          }
        }}
      >
          <span
            class="nav-section-title depth-${depth}"
            @dblclick=${(e: Event) => {
              const section = (e.currentTarget as HTMLElement).closest(
                ".nav-section",
              ) as HTMLElement;
              if (section) {
                const p = section.getAttribute("data-nav-path") || "";
                const wasCollapsed = collapsedSections.get(p) ?? false;
                collapsedSections.set(p, !wasCollapsed);
                section.classList.toggle("collapsed");
              }
            }}
          >
          <span
            class="nav-section-toggle"
            @click=${(e: Event) => {
              e.stopPropagation();
              const section = (e.currentTarget as HTMLElement).closest(
                ".nav-section",
              ) as HTMLElement;
              if (section) {
                const path = section.getAttribute("data-nav-path") || "";
                const wasCollapsed = collapsedSections.get(path) ?? false;
                collapsedSections.set(path, !wasCollapsed);
                section.classList.toggle("collapsed");
              }
            }}
          >
            <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
              <path
                fill="currentColor"
                d="M7 10l5 5 5-5z"
              />
            </svg>
          </span>
          ${folderIcon}${label}
          <button
            class="nav-more"
            tabindex="-1"
            @click=${(e: Event) => {
              e.stopPropagation();
              showMenu(e.target as HTMLElement, path, actions, true);
            }}
          >
            ⋮
          </button></span
        >
        <div class="nav-section-children" style="--line-color: ${lineColor}">
          ${children}
        </div>
      </div>`;
    });
  }

  const treeEmpty = Object.keys(tree).length === 0;
  const allPaths = treeEmpty ? [] : collectPagePaths(tree);

  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let currentQuery = "";

  function highlightText(
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

  function applyResults(
    q: string,
    filenameMatches: Set<string>,
    contentMatches: Map<string, string[]>,
  ): void {
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

  function updateSearchResults(query: string): void {
    if (searchTimer) clearTimeout(searchTimer);

    const q = query.toLowerCase().trim();
    currentQuery = q;
    if (!q) {
      applyResults("", new Set(), new Map());
      return;
    }

    // Step 1: filename match (instant, sync)
    const items = container.querySelectorAll<HTMLElement>(".nav-item");
    const filenameMatches = new Set<string>();
    for (const item of items) {
      const path = item.getAttribute("data-nav-path") || "";
      const label =
        item.querySelector(".nav-link")?.textContent?.toLowerCase() || "";
      if (label.includes(q)) filenameMatches.add(path);
    }
    applyResults(q, filenameMatches, new Map());

    // Step 2: content search (debounced, async — includes cache + provider)
    searchTimer = setTimeout(async () => {
      const matches = await searchContent(allPaths, q);
      const contentMatches = new Map<string, string[]>();
      for (const m of matches) {
        contentMatches.set(m.path, m.snippets);
      }
      applyResults(q, filenameMatches, contentMatches);
    }, 200);
  }

  function getVisibleItems(): HTMLAnchorElement[] {
    const items = container.querySelectorAll<HTMLAnchorElement>(".nav-link");
    return Array.from(items).filter(
      (a) => a.offsetParent !== null && a.closest(".nav-item")?.style.display !== "none"
    );
  }

  function handleSidebarKeydown(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;

    const items = getVisibleItems();
    if (items.length === 0) return;

    const current = document.activeElement as HTMLElement;
    let idx = items.indexOf(current as HTMLAnchorElement);

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (idx < 0) idx = -1;
        items[(idx + 1) % items.length].focus();
        break;
      case "ArrowUp":
        e.preventDefault();
        if (idx < 0) idx = 0;
        items[(idx - 1 + items.length) % items.length].focus();
        break;
      case "Home":
        e.preventDefault();
        items[0].focus();
        break;
      case "End":
        e.preventDefault();
        items[items.length - 1].focus();
        break;
      case "Enter":
        if (idx >= 0) { e.preventDefault(); items[idx].click(); }
        break;
    }
  }

  render(
    html`
      <div
        class="sidebar-wrapper"
        @dragend=${() => {
          container
            .querySelectorAll(".drag-over")
            .forEach((el) => el.classList.remove("drag-over"));
        }}
        @keydown=${handleSidebarKeydown}
      >
        ${treeEmpty
          ? html`
              <div class="sidebar-provider-bar">
                <span class="provider-label"
                  >${providerIcon ?? ""} ${providerLabel ?? "No provider"}</span
                >
                <button
                  class="provider-change-btn"
                  @click=${() => actions.onChangeProvider()}
                >
                  Change
                </button>
              </div>
            `
          : html``}
        ${treeEmpty
          ? html``
          : html`
              <div class="sidebar-search-wrapper">
                <input
                  class="sidebar-search"
                  type="text"
                  placeholder="Find file…"
                  @input=${(e: InputEvent) => {
                    const q = (e.target as HTMLInputElement).value;
                    updateSearchResults(q);
                    (e.target as HTMLElement).parentElement!.classList.toggle(
                      "has-value",
                      !!q,
                    );
                  }}
                  @keydown=${(e: KeyboardEvent) => {
                    if (e.key === "Escape") {
                      const input = e.target as HTMLInputElement;
                      input.value = "";
                      updateSearchResults("");
                      input.parentElement!.classList.remove("has-value");
                      input.blur();
                    }
                  }}
                />
                <button
                  class="search-clear"
                  @click=${(e: Event) => {
                    const input = (
                      e.target as HTMLElement
                    ).parentElement!.querySelector<HTMLInputElement>(
                      ".sidebar-search",
                    )!;
                    input.value = "";
                    updateSearchResults("");
                    input.parentElement!.classList.remove("has-value");
                    input.focus();
                  }}
                ></button>
              </div>
            `}
        <div class="sidebar-inner">
          ${treeEmpty
            ? html`<div class="sidebar-empty">No files</div>`
            : renderItems(tree, "", 0, rawTree)}
          <button
            class="nav-new-page"
            @click=${() => actions.onNewItem("docs")}
          >
            + New
          </button>
        </div>
        <div class="sidebar-footer">
          ${liveUrl
            ? html`
                <a
                  href="${liveUrl}"
                  rel="noopener noreferrer"
                  class="nav-live-link"
                >
                  ${liveIcon}
                  <span>View live version</span>
                </a>
              `
            : html``}
        </div>
      </div>
    `,
    container,
  );
}

function showMenu(
  anchor: HTMLElement,
  pagePath: string,
  actions: SidebarActions,
  isFolder?: boolean,
) {
  closeMenu();

  const rect = anchor.getBoundingClientRect();
  const backdrop = document.createElement("div");
  backdrop.className = "ctx-backdrop";
  backdrop.addEventListener("click", closeMenu);
  document.body.appendChild(backdrop);

  const menu = document.createElement("div");
  menu.className = "ctx-menu";
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.left = `${rect.left}px`;
  menu.innerHTML = `
    <div data-action="new">New…</div>
    <div data-action="rename">Rename</div>
    <div data-action="delete">Delete</div>
  `;
  menu.addEventListener("click", (e) => {
    const item = (e.target as HTMLElement).closest(
      "[data-action]",
    ) as HTMLElement;
    if (!item) return;
    closeMenu();
    switch (item.dataset.action) {
      case "new":
        actions.onNewItem(pagePath, isFolder);
        break;
      case "rename":
        actions.onRename(pagePath);
        break;
      case "delete":
        actions.onDelete(pagePath);
        break;
    }
  });
  document.body.appendChild(menu);
}
