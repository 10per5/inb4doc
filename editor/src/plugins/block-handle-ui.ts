/**
 * Block handle — floating "+" / drag grips beside the hovered block, built on
 * @prosekit/web's block-handle custom elements
 * (see https://prosekit.dev/components/block-handle/).
 *
 * Replaces the desktop BlockHandleView (hover-any-block visibility + drag
 * reorder of any block). The native "+" inserts a bare paragraph via its own
 * listener; a capture-phase interceptor on the root re-routes that tap into
 * OUR add-block menu (menuRegistry "add-block") anchored at the handle, with
 * insertion happening below the hovered block.
 */

import type { Editor } from "@prosekit/core";
import {
  BlockHandleRootElement,
  BlockHandlePositionerElement,
  BlockHandlePopupElement,
  BlockHandleAddElement,
  BlockHandleDraggableElement,
  registerBlockHandleRootElement,
  registerBlockHandlePositionerElement,
  registerBlockHandlePopupElement,
  registerBlockHandleAddElement,
  registerBlockHandleDraggableElement,
} from "@prosekit/web/block-handle";
import { DropIndicatorElement, registerDropIndicatorElement } from "@prosekit/web/drop-indicator";
import type { Node as PMNode } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";
import { Menu, MenuType, type MenuItem } from "@/components/ui/menu";
import { menuRegistry } from "@/config/menu-definitions";
import { plus, menuScale } from "@/eta/icons";

interface HoveredBlock {
  node: PMNode;
  pos: number;
}

// Custom elements can only be constructed with `new` after their tag has
// been defined; each register function is idempotent (module-level flag).
let registered = false;
function ensureRegistered(): void {
  if (registered) return;
  registered = true;
  registerBlockHandleRootElement();
  registerBlockHandlePositionerElement();
  registerBlockHandlePopupElement();
  registerBlockHandleAddElement();
  registerBlockHandleDraggableElement();
  registerDropIndicatorElement();
}

export function setupBlockHandleUI(editor: Editor): () => void {
  ensureRegistered();
  const parent = editor.view.dom.parentNode;
  if (!parent) return () => {};

  let hovered: HoveredBlock | null = null;
  let menu: Menu | null = null;
  let menuMountEl: HTMLElement | null = null;
  // Insert an empty paragraph directly AFTER the hovered node and put the
  // caret in it — never resolve a caret near/inside the hovered block (for
  // tables etc. TextSelection.near escapes into the NEXT block). The shared
  // insert flow treats a caret in an empty top-level paragraph as "transform
  // in place", so the chosen block type appears exactly here.
  const selectBelowHovered = () => {
    if (!hovered) return;
    const view = editor.view;
    if (!view.hasFocus()) view.focus();
    const { state } = view;
    const insertPos = Math.min(hovered.pos + hovered.node.nodeSize, state.doc.content.size);
    const tr = state.tr.insert(insertPos, state.schema.nodes.paragraph.create());
    tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos + 1)));
    view.dispatch(tr.scrollIntoView());
  };

  const wrapWithAnchor = (items: MenuItem[]): MenuItem[] =>
    items.map((item) => {
      if (item.type === MenuType.Submenu && item.items) {
        return { ...item, items: wrapWithAnchor(item.items) };
      }
      if (!item.onClick) return item;
      const original = item.onClick;
      return {
        ...item,
        onClick: () => {
          selectBelowHovered();
          original();
        },
      };
    });

  const openAddMenu = (anchorEl: HTMLElement) => {
    if (!menuRegistry.get("add-block")) return;
    if (!menu || !menuMountEl) {
      menuMountEl = document.createElement("div");
      menuMountEl.className = "block-handle-menu-anchor";
      document.body.appendChild(menuMountEl);
      menu = new Menu({
        mountEl: menuMountEl,
        triggerEl: anchorEl,
        label: "Add",
        items: () => wrapWithAnchor(menuRegistry.get("add-block") ?? []),
      });
    }
    const rect = anchorEl.getBoundingClientRect();
    if (menuMountEl) {
      menuMountEl.style.left = `${rect.left}px`;
      menuMountEl.style.top = `${rect.bottom}px`;
    }
    menu.openAndFocusFirst();
  };

  const root = new BlockHandleRootElement();
  root.editor = editor;

  root.addEventListener("stateChange", (e: Event) => {
    hovered = (e as CustomEvent<HoveredBlock | null>).detail ?? null;
  });

  // The native add element binds its own target-phase listener inserting a
  // bare paragraph; capture here first and open our menu instead.
  root.addEventListener(
    "pointerdown",
    (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest("prosekit-block-handle-add")) return;
      e.preventDefault();
      e.stopPropagation();
      openAddMenu(target.closest("prosekit-block-handle-add") as HTMLElement);
    },
    true,
  );

  const positioner = new BlockHandlePositionerElement();
  const popup = new BlockHandlePopupElement();

  const addButton = new BlockHandleAddElement();
  addButton.editor = editor;
  addButton.innerHTML = plus;
  addButton.title = "Add block";

  const draggable = new BlockHandleDraggableElement();
  draggable.editor = editor;
  draggable.innerHTML = menuScale;
  draggable.title = "Drag to move";

  popup.appendChild(addButton);
  popup.appendChild(draggable);
  positioner.appendChild(popup);
  root.appendChild(positioner);

  const dropIndicator = new DropIndicatorElement();
  dropIndicator.editor = editor;

  parent.appendChild(root);
  parent.appendChild(dropIndicator);

  return () => {
    menu?.destroy();
    menu = null;
    menuMountEl?.remove();
    menuMountEl = null;
    dropIndicator.remove();
    root.remove();
  };
}
