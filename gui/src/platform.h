#pragma once
#include <string>

/// Full path to the current executable.
std::string exe_path();

/// Best guess for the editor frontend directory.
///
/// Tries locations relative to the executable first, then falls back to a
/// platform-specific default (e.g. /opt/inb4doc/editor on Linux).
/// Returns empty if no candidate was found (caller must still validate).
std::string default_editor_root();

/// Platform-standard writable data directory for inb4doc (e.g. ~/.local/share/inb4doc).
std::string default_data_dir();

/// The writable copy of the editor maintained by the fetch updater:
/// default_data_dir()/JsStaticFs. Empty when there is no data directory.
/// scheme.cpp serves this before the read-only install shell; the updater
/// bridge writes the live editor here (Part C.1 W3).
std::string default_editor_data_dir();

/// Qt WebEngine's persistent storage + cache root: default_data_dir()/Browser.
/// Keeps the browser's profile files (Cache, GPUCache, Local Storage, Cookies)
/// out of the data-dir root so they can't be confused with the editor data or
/// other gui files. Empty when there is no data directory.
std::string default_browser_data_dir();
