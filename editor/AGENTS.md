# Agent Notes — inb4doc editor

## Rules

- **Never modify `node_modules/`** — use custom Milkdown plugins or project source files instead.
- **Never create postinstall/patch scripts** that modify node_modules at install time.

## Architecture — Stimulus + Eta

### Controller Hierarchy

```
ShellController (#app, data-controller="shell", data-shell-editor-outlet="#editor-area")
├── TopbarController (.app-toolbar, data-controller="topbar")
│   ├── FileMenuController (data-controller="file-menu")
│   └── ViewMenuController (data-controller="view-menu")
├── SidebarController (#sidebar-nav, data-controller="sidebar")
├── EditorController (#editor-area, data-controller="editor") ← outlet of ShellController
├── NavigationController (plain class, receives editor + cache + sidebarEl via constructor)
├── FileSyncController (plain class, no DOM)
└── ViewController (plain class, accesses editor targets for element visibility)
```

- **Stimulus controllers** own DOM elements and have `static targets` for child references. They are registered in `src/app.ts` via `app.register("name", ControllerClass)`.
- **Plain class controllers** receive Stimulus controllers as constructor args for cross-controller calls. They do NOT use `document.getElementById`.
- **ShellController** is the composition root: finds child Stimulus controllers via `this.application.getControllerForElementAndIdentifier()`, creates plain class sub-controllers, wires event subscriptions, and runs the async initialization lifecycle.
- **Event bus** (`appEvents`) is the primary decoupling mechanism. Controllers emit user-intents; other controllers subscribe.

### Stimulus Outlets

Outlets connect a parent controller to a child controller's element. The attribute goes on the **parent** controller element, and its value is a **CSS selector** for the child element (NOT the child's controller identifier):

```html
<!-- CORRECT: attribute on parent, value is CSS selector -->
<div data-controller="shell" data-shell-editor-outlet="#editor-area">
  <div id="editor-area" data-controller="editor"></div>
</div>

<!-- WRONG: attribute on child, value is identifier -->
<div data-controller="shell">
  <div data-controller="editor" data-shell-editor-outlet="editor"></div>
</div>
```

The callback is `{outletName}OutletConnected(outlet, element)` on the parent controller. It fires when both the parent and outlet controllers are connected and the outlet element matches the selector.

### Stimulus Initialization Order

Use `new Application()` → register all controllers → `await app.start()`. Do NOT use `Application.start()` which starts DOM observers before controllers are registered:

```ts
const app = new Application()
app.register("shell", ShellController)
app.register("editor", EditorController)
// ... register all controllers ...
await app.start()
```

`app.register()` immediately connects controllers if matching DOM elements exist. `app.start()` starts the MutationObserver for future DOM changes.

### TypeScript `declare` for Stimulus Targets/Values

With `target: "ESNext"` (or `useDefineForClassFields: true`), TypeScript compiles `foo!: HTMLElement` to `this.foo = undefined` in the constructor, which **shadows** the Stimulus prototype getter that queries the DOM. Always use `declare` for Stimulus-managed properties:

```ts
// CORRECT: declare emits no runtime code
declare readonly sidebarTarget: HTMLElement

// WRONG: shadows Stimulus getter with undefined
sidebarTarget!: HTMLElement
```

This applies to all `static targets`, `static values`, and `static outlets` blessed properties. Private fields assigned manually (e.g., `private editor!: EditorController`) are fine with `!` since they don't shadow Stimulus getters.

### DOM Element Access

- **Stimulus targets**: Use `static targets = ["name"]` + `this.nameTarget` to reference child elements. The controller's element is `this.element` (typed as `Element`, cast to `HTMLElement` when needed for DOM APIs).
- **Cross-controller access**: Use `this.application.getControllerForElementAndIdentifier(element, "controller-name")` to find another controller. Call this lazily in `connect()` body or `initialize()` — children connect after parent in Stimulus DOM order.
- **Never use `document.getElementById`** in controllers or view components. All element access goes through Stimulus targets or constructor-injected references.
- **Exception**: Global UI cleanup (e.g., `document.querySelectorAll(".toolbar-menu.open")` to close menus) is acceptable.

### Loading Overlay

The loading overlay markup is rendered server-side in `shell.eta`. It must be explicitly hidden after app initialization by calling `hideLoadingOverlay()` from `@/components/overlay/loading-overlay`. If the app stalls with the overlay visible, check that `hideLoadingOverlay()` is called at the end of the initialization lifecycle.

### Eta Templates

- **Build-time rendering**: `build.ts` renders `shell.eta` → `public/index.html`. Partials in `src/templates/partials/` are included via `<%~ include('partial-name', it) %>`.
- **Template context**: `build.ts` passes `it` with `BUILD_MODE`, enum prefixes (`TOOLBAR_ACTION_PREFIX`, `SIDEBAR_ACTION_PREFIX`, etc.), enum objects (`ToolbarAction`, `SidebarAction`, etc.), `icons`, `showMobileButtons`, etc.
- **Include paths**: Partials include other partials with just the filename (e.g., `include('source-editor', it)`), NOT with `partials/` prefix. The Eta `views` root is `src/templates/`.
- **Stimulus attributes in templates**: Use `<%= it.ENUM_PREFIX %><%= it.Enum.Value %>` for `data-action` values. Use `data-controller="name"` for Stimulus bindings. Use `data-name-target="target"` for targets.
- **Partials are compiled at build time** — the Eta compiler never ships to the browser. Compiled templates (`.eta.ts`) are used for runtime rendering (e.g., `mobile.eta`).
- **Icons**: Pass SVG icon strings via the template context (`it.icons.boldIcon`), not imported directly in templates.

### Int-Based Enum Pattern

- Each domain has a short prefix: `tb-` (toolbar), `sb-` (sidebar), `sc-` (slash), `img-` (image), `dlg-` (dialog), `prov-` (provider), `proj-` (project), `ed-` (editor).
- `data-action` attributes use `PREFIX${EnumInt}` format: `data-action="tb-0"`.
- Handler parsing: `Number(str.replace(PREFIX, "")) as EnumType`.
- CSS uses classes (`.ctx-action`, `.action-delete`) not `[data-action="value"]` selectors.
- Enum values are ints for HTML compactness; the enum exists for type safety and documentation.

### Build Commands

```bash
bun build.ts          # Full build: Eta render → CSS → Bun bundle → KaTeX assets
bun --bun tsc --noEmit # TypeScript check
```

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

## Bundle Analysis

To analyze bundle size and find bloat:

```bash
bun build src/app.ts --outdir /tmp/analyze --minify --metafile-md=/tmp/analyze/report.md
```

This generates an LLM-friendly markdown report with largest modules, dependency chains, and optimization opportunities. Use `--splitting` to see lazy chunk breakdowns. The JSON version (`--metafile=meta.json`) works with tools like `esbuild-visualizer`.

### Known size issues

| Asset | Size | Cause |
|-------|------|-------|
| `app.js` | 1.3 MB initial | Milkdown + ProseMirror + CM core |
| `app.css` | 1.5 MB | `katex/dist/katex.min.css` has `@font-face` blocks → Bun inlines all woff2/woff/ttf fonts as base64 data URIs (~60 font files, 1.2 MB) |

### Pending Image Lifecycle

Pending images (unflushed) are tracked in `ImageRegistry` with `pendingByDir`. They appear in `getAllImages()` alongside known (committed) images. When discarded or deleted:

- **Discard All** must call `imageRegistry.removeAllForDir(dir)` (added in `CacheManagementService.onDiscardAll`)
- **Single delete** via Image Manager must call `imageRegistry.removePending(id)` (handled in `deleteImage()` for names starting with `pi-`)
- **Flush** calls `commitPending(dir)` which uploads the file, builds the URL map, then removes from registry
