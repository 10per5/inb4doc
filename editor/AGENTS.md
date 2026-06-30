# Agent Notes — predoc editor

## Supported Formatting in WYSIWYG

- **CommonMark** — via `@milkdown/kit/preset/commonmark`
- **GFM** — via `@milkdown/kit/preset/gfm` (tables, strikethrough, task lists, auto-links)
- **Markdown alerts** (`> [!NOTE]`, `> [!WARNING]`, etc.) — custom `$remark` + `$nodeSchema` in `src/plugins/alert.ts`
  - Transforms MDAST blockquote nodes with `[!TYPE]` prefix into custom `alert` nodes
  - Renders as `<blockquote class="book-hint TYPE">` in the editor
  - Serializes back to `> [!TYPE] ...` syntax
  - Supported types: note, tip, important, warning, caution, info, success, danger

## Clipboard / Paste

- `@milkdown/plugin-clipboard` activated via `.use(clipboard)`
- Handles VS Code paste detection (code block with language)
- Handles Google Docs multi-table paste (strips `docs-internal-guid` wrapper)
- If rich paste formatting is still lost, add a `$prose` plugin with turndown HTML→Markdown conversion

## Hugo Shortcodes — Decoration + Text Handler Override

Shortcodes use `src/plugins/shortcode.ts`:

1. **`$prose` decoration plugin** (`shortcodeDecoration`): Styles `{{<...>}}` / `{{%...%}}` text patterns as styled badges. Uses a stack-based approach to match opening/closing shortcode pairs and adds `.shortcode-body` decoration to content between them. Uses a local regex instance to avoid `lastIndex` conflicts.

2. **Text handler override** in `editor_controller.ts` config: Overrides the `text` handler via `remarkStringifyOptionsCtx`. For text nodes containing `{{`, returns the raw value directly (skipping `state.safe()`), preventing `[` from being escaped to `\[`. This avoids `$remark` race condition issues since it's applied in the config callback.

Regex (decoration): `/\{\{(<|%)\s*\/?\s*(\w+(?:\.\w+)?)((?:\s+(?:"[^"]*"|\[[^\]]*\]|\S+))*)\s*[>%]\}\}/g`

Supported syntax:
| Part | Class | Style |
|---|---|---|
| Shortcode tag | `.shortcode-tag` | gray border, monospace |
| Content between paired tags | `.shortcode-body` | subtle blue background |
| `{{< param ... >}}` | `.shortcode-param` | teal border |
| `{{< details ... >}}` / `{{< /details >}}` | `.shortcode-detail-tag` | blue border, bold |
| `{{% ... %}}` | `.shortcode-percent` | purple border, italic |

## Backend Compatibility

Only backend: **Hugo + Hugo Book theme** (v0.14.0)

- Formatting table in `content/docs/backends.md`
- Hugo Book shortcode reference: https://book.alxs.dev/docs/content/shortcodes/
- Hugo shortcode reference: https://gohugo.io/content-management/shortcodes/

## Inline / Floating Element Patterns

When rendering popups, pickers, or floating UIs that must anchor to a ProseMirror position:

### SlashProvider (recommended for `/cmd` menus)

Uses `@milkdown/plugin-slash`'s `SlashProvider`. The provider positions itself via `posToDOMRect(view, from, to)` using the current text selection. The positioning happens inside `#onUpdate` which is called by `provider.update(view, prevState)` — debounced at 20ms by default.

**Key flow:**
1. Set a `#programmaticPos` before calling `provider.show()`
2. In the `shouldShow` callback, read `#programmaticPos`, validate the position node matches the selection node, then return true
3. The provider calls `posToDOMRect(view, from, to)` to compute position → `computePosition()` via Floating UI → sets `left`/`top` on the element

**Gotchas:**
- `provider.show()` only sets `data-show="true"` — it does NOT position the element. Positioning requires `provider.update()` → `#onUpdate` to fire (debounced).
- `shouldShow` returns false if `#programmaticPos` resolves to a different node than `selection.from` — important guard against stale positions.
- For immediate positioning without waiting for the debounce, manually compute coords:
  ```ts
  const coords = view.coordsAtPos(pos);
  element.style.left = `${coords.left}px`;
  element.style.top = `${coords.bottom + 4}px`;
  ```

### ProseMirror Plugin with `handleDOMEvents`

For user interactions on specific nodes (e.g., double-click on an image), use a `Plugin` with `props.handleDOMEvents`:

```ts
new Plugin({
  key: new PluginKey("my-handler"),
  props: {
    handleDOMEvents: {
      dblclick: (view, event) => {
        const target = event.target as HTMLElement;
        const el = target.closest("[data-my-attr]");
        if (!el) return false;
        const pos = view.posAtDOM(el, 0);
        // dispatch custom event or open a popup
        view.dom.dispatchEvent(new CustomEvent("my-custom-event", {
          bubbles: true, detail: { pos, ... }
        }));
        return true;
      },
    },
  },
})
```

Listen for the custom event on `view.dom` in the component that manages the popup. This decouples the ProseMirror plugin from the UI code.

### Avoiding Position Flash

When a floating element transitions from hidden to shown, it may briefly appear at (0,0) before `#onUpdate` repositions it. To prevent this:

1. Set CSS `left`/`top` BEFORE calling `provider.show()` using `view.coordsAtPos(pos)`
2. Set `data-show="false"` on the element until coordinates are computed, then set to `"true"`

### Pending Image Lifecycle

Pending images (unflushed) are tracked in `ImageRegistry` with `pendingByDir`. They appear in `getAllImages()` alongside known (committed) images. When discarded or deleted:

- **Discard All** must call `imageRegistry.removeAllForDir(dir)` (added in `CacheManagementService.onDiscardAll`)
- **Single delete** via Image Manager must call `imageRegistry.removePending(id)` (handled in `deleteImage()` for names starting with `pi-`)
- **Flush** calls `commitPending(dir)` which uploads the file, builds the URL map, then removes from registry
