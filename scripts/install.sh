#!/usr/bin/env bash
#
# install.sh — installer for inb4doc-gui (Linux).
#
# Standalone downloader: pulls the release payload from GitHub and installs it
# per-user (no sudo, no build tools, no checkout). Eval it straight from a
# console:
#
#   curl -fsSL https://raw.githubusercontent.com/10per5/inb4doc/main/scripts/install.sh | bash
#
# Payload:  <releases>/latest/download/inb4doc-linux-x86_64.tar.gz
# Default:  $HOME/.local/share/inb4doc
#
# The install tree matches default_editor_root() (gui/src/platform.cpp):
#
#   <prefix>/inb4doc-gui   <- the GUI binary
#   <prefix>/icon.png      <- window/desktop icon
#   <prefix>/editor/       <- read-only thin-shell copy (editor/dist/)
#
# The installer NEVER creates or writes the writable data dir
# (~/.local/share/inb4doc/JsStaticFs, Browser/...); the app does that on first
# run. The release payload is the flat predep layout (inb4doc-gui + icon.png +
# dist/); the legacy canonical tree (bin/ + editor/) is also accepted; both are
# normalized to the flat tree above.
#
# Usage:
#   install.sh [--prefix DIR] [--editor-root DIR] [--version TAG] [--source SRC]
#              [--no-desktop] [--uninstall] [--verify] [--help]

set -eu

REPO="10per5/inb4doc"
ASSET="inb4doc-linux-x86_64.tar.gz"
BASE_URL="https://github.com/$REPO/releases"

usage() {
    cat <<EOF
Usage: $0 [--prefix DIR] [--editor-root DIR] [--version TAG] [--source SRC]
           [--no-desktop] [--uninstall] [--verify] [--help]

Installs inb4doc-gui into a per-user prefix (default \$HOME/.local/share/inb4doc).

By default the payload is downloaded from GitHub releases (latest):
  $BASE_URL/latest

Options:
  --prefix DIR       Install prefix (default: \$HOME/.local/share/inb4doc)
  --editor-root DIR  Default content directory. Baked into the .desktop Exec
                     line as the GUI's --content-root flag so the app opens
                     that folder on launch. Optional.
  --version TAG      Install a pinned release tag instead of latest
                     (e.g. --version v0.0.5). Optional.
  --source SRC       Payload source override: a URL, a local .tar.gz file, or a
                     directory already laid out with the payload. Useful for
                     testing and offline installs. Optional.
  --no-desktop       Skip .desktop / desktop-database integration.
  --uninstall        Remove prefix, symlink and .desktop file.
  --verify           Also launch 'inb4doc-gui --debug' after install to confirm
                     'editor_url = app://_/' and that JsStaticFs/ populates
                     under the data dir.
EOF
    exit 0
}

# --- paths -------------------------------------------------------------------

DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
BIN_LINK_DIR="$HOME/.local/bin"
DESKTOP_FILE="$DATA_HOME/applications/inb4doc.desktop"

# --- parse args --------------------------------------------------------------

PREFIX=""
EDITOR_ROOT=""
VERSION=""
SOURCE=""
NO_DESKTOP=0
UNINSTALL=0
VERIFY=0

while [ "$#" -gt 0 ]; do
    case "$1" in
        --prefix)
            [ "$#" -ge 2 ] || { echo "error: --prefix requires a value" >&2; usage; }
            PREFIX="$2"; shift 2 ;;
        --prefix=*) PREFIX="${1#*=}"; shift ;;
        --editor-root)
            [ "$#" -ge 2 ] || { echo "error: --editor-root requires a value" >&2; usage; }
            EDITOR_ROOT="$2"; shift 2 ;;
        --editor-root=*) EDITOR_ROOT="${1#*=}"; shift ;;
        --version)
            [ "$#" -ge 2 ] || { echo "error: --version requires a value" >&2; usage; }
            VERSION="$2"; shift 2 ;;
        --version=*) VERSION="${1#*=}"; shift ;;
        --source)
            [ "$#" -ge 2 ] || { echo "error: --source requires a value" >&2; usage; }
            SOURCE="$2"; shift 2 ;;
        --source=*) SOURCE="${1#*=}"; shift ;;
        --no-desktop) NO_DESKTOP=1; shift ;;
        --uninstall) UNINSTALL=1; shift ;;
        --verify) VERIFY=1; shift ;;
        -h|--help) usage ;;
        *) echo "error: unknown option: $1" >&2; usage ;;
    esac
done

if [ -z "$PREFIX" ]; then
    PREFIX="$HOME/.local/share/inb4doc"
fi
PREFIX="${PREFIX%/}"

case "$PREFIX" in
    ""|"/") echo "error: refusing to operate on '$PREFIX'" >&2; exit 1 ;;
esac

if [ -n "$EDITOR_ROOT" ]; then
    EDITOR_ROOT="${EDITOR_ROOT%/}"
    if [ ! -d "$EDITOR_ROOT" ]; then
        echo "error: --editor-root '$EDITOR_ROOT' is not a directory" >&2
        exit 1
    fi
fi

# --- payload acquisition ------------------------------------------------------

TMP_DIR=""
cleanup() { [ -n "$TMP_DIR" ] && rm -rf "$TMP_DIR"; return 0; }
trap cleanup EXIT

download() {
    # download <url> <out>
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL --retry 3 "$1" -o "$2"
    elif command -v wget >/dev/null 2>&1; then
        wget -qO "$2" "$1"
    else
        echo "error: need 'curl' or 'wget' to download the release payload" >&2
        exit 1
    fi
}

payload_url() {
    if [ -n "$VERSION" ]; then
        echo "$BASE_URL/download/$VERSION/$ASSET"
    else
        echo "$BASE_URL/latest/download/$ASSET"
    fi
}

# Resolve the payload inside a directory into PAYLOAD_BIN/PAYLOAD_EDITOR.
# Accepts the flat predep layout (inb4doc-gui + dist/) and the legacy canonical
# layout (bin/ + editor/), plus archives wrapped in a top-level directory.
PAYLOAD_BIN=""
PAYLOAD_EDITOR=""

resolve_payload() {
    local base="$1"
    if [ -f "$base/bin/inb4doc-gui" ] && [ -d "$base/editor" ]; then
        PAYLOAD_BIN="$base/bin"
        PAYLOAD_EDITOR="$base/editor"
        return 0
    fi
    if [ -f "$base/inb4doc-gui" ] && [ -d "$base/dist" ]; then
        PAYLOAD_BIN="$base"
        PAYLOAD_EDITOR="$base/dist"
        return 0
    fi
    local d
    for d in "$base"/*/; do
        [ -d "$d" ] || continue
        if resolve_payload "${d%/}"; then
            return 0
        fi
    done
    return 1
}

obtain_payload() {
    local src="$1"
    case "$src" in
        http://*|https://*)
            TMP_DIR="$(mktemp -d)"
            echo "Downloading $src ..."
            download "$src" "$TMP_DIR/payload.tar.gz"
            tar -xf "$TMP_DIR/payload.tar.gz" -C "$TMP_DIR"
            if ! resolve_payload "$TMP_DIR"; then
                echo "error: no usable payload in archive (expected bin/ + editor/)" >&2
                exit 1
            fi
            ;;
        *.tar.gz|*.tgz|*.tar)
            TMP_DIR="$(mktemp -d)"
            tar -xf "$src" -C "$TMP_DIR"
            if ! resolve_payload "$TMP_DIR"; then
                echo "error: no usable payload in archive '$src'" >&2
                exit 1
            fi
            ;;
        *)
            if ! resolve_payload "$src"; then
                echo "error: no usable payload in '$src' (expected bin/ + editor/)" >&2
                exit 1
            fi
            ;;
    esac
}

# --- desktop integration ------------------------------------------------------

install_desktop() {
    mkdir -p "$DATA_HOME/applications"

    local exec_line="\"$PREFIX/inb4doc-gui\""
    if [ -n "$EDITOR_ROOT" ]; then
        exec_line="$exec_line --content-root \"$EDITOR_ROOT\""
    fi

    {
        echo "[Desktop Entry]"
        echo "Type=Application"
        echo "Name=inb4doc"
        echo "Comment=Local-first Markdown editor"
        echo "Exec=$exec_line"
        echo "Icon=$PREFIX/icon.png"
        echo "Terminal=false"
        echo "Categories=Office;"
    } > "$DESKTOP_FILE"

    if command -v update-desktop-database >/dev/null 2>&1; then
        update-desktop-database "$DATA_HOME/applications" >/dev/null 2>&1 || true
    fi
    echo "Installed desktop entry: $DESKTOP_FILE"
}

# --- uninstall ----------------------------------------------------------------

uninstall() {
    echo "Uninstalling inb4doc from $PREFIX"
    rm -rf "$PREFIX"
    rm -f "$BIN_LINK_DIR/inb4doc"
    rm -f "$DESKTOP_FILE"
    if command -v update-desktop-database >/dev/null 2>&1; then
        update-desktop-database "$DATA_HOME/applications" >/dev/null 2>&1 || true
    fi
    echo "Done. Removed prefix, launcher symlink and desktop entry."
}

# `install` (coreutils) is preferred; fall back to cp+chmod in minimal envs.
if command -v install >/dev/null 2>&1; then
    put_file() { install -m "$1" "$2" "$3"; }
else
    put_file() { cp "$2" "$3" && chmod "$1" "$3"; }
fi

# --- install ------------------------------------------------------------------

install() {
    obtain_payload "${SOURCE:-$(payload_url)}"

    local label="latest"
    [ -n "$VERSION" ] && label="$VERSION"
    echo "Installing inb4doc ($label) into $PREFIX"

    rm -rf "${PREFIX:?}/bin" "${PREFIX:?}/editor"
    mkdir -p "$PREFIX"

    put_file 755 "$PAYLOAD_BIN/inb4doc-gui" "$PREFIX/inb4doc-gui"

    if [ -f "$PAYLOAD_BIN/icon.png" ]; then
        put_file 644 "$PAYLOAD_BIN/icon.png" "$PREFIX/icon.png"
    else
        echo "warning: no icon.png in payload; skipping icon" >&2
    fi

    mkdir -p "$PREFIX/editor"
    cp -r "$PAYLOAD_EDITOR/." "$PREFIX/editor/"
    echo "Copied thin-shell editor to $PREFIX/editor/"

    mkdir -p "$BIN_LINK_DIR"
    ln -sfn "$PREFIX/inb4doc-gui" "$BIN_LINK_DIR/inb4doc"
    echo "Linked $BIN_LINK_DIR/inb4doc -> $PREFIX/inb4doc-gui"

    case ":$PATH:" in
        *":$BIN_LINK_DIR:"*) : ;;
        *) echo "note: $BIN_LINK_DIR is not on PATH; add it to run 'inb4doc' from a terminal." ;;
    esac

    if [ "$NO_DESKTOP" = 1 ]; then
        echo "Skipped desktop integration (--no-desktop)."
    else
        install_desktop
    fi
}

# --- verify -------------------------------------------------------------------

verify() {
    echo "Verifying install at $PREFIX ..."
    [ -x "$PREFIX/inb4doc-gui" ] || { echo "FAIL: missing executable $PREFIX/inb4doc-gui" >&2; return 1; }
    [ -f "$PREFIX/editor/index.html" ] || { echo "FAIL: missing thin shell $PREFIX/editor/index.html" >&2; return 1; }
    echo "OK: binary and thin-shell editor present."
    echo "Launch with: $PREFIX/inb4doc-gui --debug"
    if [ "$VERIFY" = 1 ]; then
        echo "Running --debug (a window will open; Ctrl+C to quit)."
        echo "After ~30s, $DATA_HOME/inb4doc/JsStaticFs should populate."
        "$PREFIX/inb4doc-gui" --debug || true
    fi
}

# --- main ----------------------------------------------------------------------

if [ "$UNINSTALL" = 1 ]; then
    uninstall
else
    install
    verify
fi
