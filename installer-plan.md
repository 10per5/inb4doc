# Installer Plan — .sh (Linux) / .cmd (Windows) for inb4doc-gui

Scope: package `gui/bin/inb4doc-gui` + `editor/dist/` (the thin shell) into
per-platform installers. No C++ changes — the layout below is what
`gui/src/platform.cpp` (`default_editor_root()`, `default_data_dir()`) already
expects.

## Install set (built before packaging)

| Item | Source | Notes |
|---|---|---|
| Binary | `gui/bin/inb4doc-gui` | built via `gui/` docker/predep (WebKitGTK) or native |
| Icon | `gui/bin/icon.png` | |
| Thin shell | `editor/dist/` | **must be `BUILD_MODE=gui-desktop` output** — dist is only written by ThinShell builds. Rebuild fresh for each package: `BUILD_MODE=gui-desktop bun lib/build.ts` (UPDATE_BASE now mode-aware → bakes `…/editor-live/desktop`). Never ship `public/` (full web build) as the install set. |

## Install layout (matches `default_editor_root()`)

`default_editor_root()` (`gui/src/platform.cpp:34-50`) finds the editor at
`<exe_dir>/../editor` or `<exe_dir>/editor`, else falls back to
`/opt/inb4doc/editor` (Linux) / `C:/Program Files/inb4doc/editor` (Win).

So the canonical tree is:

```
<prefix>/
├── bin/inb4doc-gui
├── bin/icon.png
└── editor/            ← copy of editor/dist/ (read-only thin shell)
```

On first run the app creates the writable data dir
(`~/.local/share/inb4doc`, `%APPDATA%\inb4doc`) and the updater downloads the
live editor into `JsStaticFs/` (`gui/src/bridge.cpp`). The installer must NOT
pre-create or write the data dir.

GUI flags (`gui/src/args.h`): `--editor-root`, `--content-root`,
`--live-port`, `--favicon`, `--disable-gpu`, `--no-ignore`, `--depth`,
`--debug`, `--host/--port`. A launcher should pass nothing by default (local
mode auto-detects `editor/` beside the binary); the optional content dir can be
set on first launch.

## Linux — `install.sh`

Per-user, no sudo (default `--prefix=$HOME/.local/share/inb4doc`).

Steps:
1. Parse args: `--prefix`, `--editor-root <path>` (optional default content dir
   to bake into the .desktop Exec line), `--no-desktop` (skip integration),
   `--uninstall`.
2. `rm -rf` + recreate `$prefix/{bin,editor}`; `install -m755` binary,
   `install -m644` icon, `cp -r` `editor/dist/.` → `$prefix/editor/`.
3. Symlink `$HOME/.local/bin/inb4doc` → `$prefix/bin/inb4doc-gui` (create dir
   if missing).
4. Install `.desktop` at `$XDG_DATA_HOME/applications/inb4doc.desktop`
   (`Exec=$prefix/bin/inb4doc-gui`, `Icon=$prefix/bin/icon.png`, `Categories=Office;`),
   then `update-desktop-database` (ignore if absent).
5. `--uninstall`: remove prefix, symlink, .desktop.
6. Verify: `$prefix/bin/inb4doc-gui --debug` shows `editor_url = app://_/` and
   the window opens; after ~30s `JsStaticFs/` is populated.

Self-contained option (later, optional): make the .sh self-extracting
(`cat payload | tail -n +N | tar xz`) so users get one file. Out of scope for
the first cut — ship a staged tarball + script.

## Windows — `install.cmd`

Default `%LOCALAPPDATA%\Programs\inb4doc` (no admin); if run elevated, use
`%ProgramFiles%\inb4doc` instead. `.cmd` for the installer + a `inb4doc.cmd`
launcher (robust to double-click path issues) + PowerShell for shortcut
creation.

Steps:
1. `%~dp0` → resolve script dir; `set PREFIX=%LOCALAPPDATA%\Programs\inb4doc`.
2. `robocopy`/`xcopy` the payload (bin + editor) into `%PREFIX%`, preserving
   `editor/` recursion.
3. Create launcher `%PREFIX%\inb4doc.cmd`: `start "" "%PREFIX%\bin\inb4doc-gui.exe" %*`.
4. PowerShell one-liner creates Start Menu + Desktop shortcuts pointing at the
   launcher, icon `%PREFIX%\bin\icon.png`.
5. `--uninstall`: remove prefix + shortcuts (prompt before `rmdir /s /q`).
6. Verify on a clean Win10/11: launch → window opens → data dir populates under
   `%APPDATA%\inb4doc`.

## Open questions / notes

- **Versioning**: installer embeds a version (bake `APP_VERSION` into the
  gui-desktop build so the meta `app-version` reflects the package).
- **macOS**: out of scope (no plan yet) — needs a `.app` bundle + `default_editor_root()`
  branch already exists (`exe_path` handles `_NSGetExecutablePath`).
- **Host deps (Linux)**: binary dynamically links WebKitGTK/Qt (see `gui/README.md`);
  the installer should note required packages, not bundle them.
- **Content default**: leaving `--content-root` unset defaults to cwd at launch;
  a future `--open <dir>` could be wired into the .desktop via `file association`.
