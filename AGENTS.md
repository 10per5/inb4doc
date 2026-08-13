# Agent Notes — inb4doc (repo root)

This is the repo-wide AGENTS.md. **Each subdirectory should carry its own
AGENTS.md** with area-specific rules, conventions, and invariants; where one
exists you must read and follow it. Choose the AGENTS.md by where the current
work lands and refer to the matching one before writing or editing code.

## Layout

| Path | What it is | AGENTS.md |
|---|---|---|
| `editor/` | The WYSIWYG markdown editor — Bun + Milkdown (ProseMirror) + Stimulus + Eta. This is the app itself: `src/`, `templates/`, `lib/` (build), `public/` output. | ✅ `editor/AGENTS.md` — always read this first for editor work |
| `content/` | The markdown wiki — plain `.md` files, the shared source of truth for the editor and the SSG. No build step; edits are just file writes. | — |
| `hugo-view/` | SSG — Hugo + Book theme; renders `content/` into a static site (`hugo-view::build`). | — |
| `gui/` | Native desktop shell — Saucer + Qt6 WebEngine wrapping the editor (`gui::build`). | — |
| `scripts/` | Install / release helper scripts (`install.sh`, `install.cmd`). | — |
| `images/` | Branding / docs assets (favicon, app icons, opengraph). | — |
| `predep.toml` | Root predep manifest that links the subprojects; each subproject has its own `predep.toml` declaring its stages. | — |

## Rule of thumb

Pick the AGENTS.md by where the work lands:

- Editor code, CSS, templates, or build pipeline (`lib/`) → `editor/AGENTS.md`.
- Static-site generation or Hugo theme/layout work → `hugo-view/`.
- Native shell / Qt / Saucer → `gui/`.
- Plain markdown content → no AGENTS.md; just edit the files.
- Not sure which area a task belongs to → ask before diving in.

If a subdirectory doesn't have an AGENTS.md yet and you do substantial work
there, create one capturing its conventions and invariants so the next agent
doesn't have to rediscover them.
